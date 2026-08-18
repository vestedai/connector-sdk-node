import { describe, expect, it } from "vitest";
import { resolveBindings, validateBindings, validateHubLimits } from "../src/tool-binding.ts";
import type { AgentDeclaration } from "../src/agent.ts";
import type { ToolDeclaration, ToolHandler } from "../src/tool.ts";

const agent = (key: string): AgentDeclaration => ({
  key,
  name: key,
  model: "openai:gpt-4o",
  modelConfig: {},
  description: "d",
  status: "active",
  instructions: [],
});

const tool = (key: string, agents: string[] = []): ToolDeclaration => ({
  key,
  name: key,
  description: "d",
  sensitivity: "read",
  agents,
  defaultDeadlineMs: 30_000,
  maxResultBytes: 1_048_576,
  inputSchema: {},
  outputSchema: null,
  handlerCtor: class {} as unknown as new () => ToolHandler,
});

const map = (...tools: ToolDeclaration[]) =>
  new Map(tools.map((t) => [t.key, t]));

describe("tool binding", () => {
  it("falls back to the namespace prefix when agents is omitted", () => {
    const bound = resolveBindings(
      [agent("erp.data"), agent("erp.retail")],
      map(tool("erp.data.run_sql")),
    );
    expect(bound.get("erp.data")!.map((t) => t.key)).toEqual(["erp.data.run_sql"]);
    expect(bound.get("erp.retail")).toEqual([]);
  });

  it("binds to each named agent", () => {
    const bound = resolveBindings(
      [agent("erp.data"), agent("erp.retail")],
      map(tool("erp.data.run_sql", ["erp.data", "erp.retail"])),
    );
    expect(bound.get("erp.data")).toHaveLength(1);
    expect(bound.get("erp.retail")).toHaveLength(1);
  });

  // The key names erp.data; the list names only erp.retail. The list wins.
  it("treats a present list as authoritative, not additive", () => {
    const bound = resolveBindings(
      [agent("erp.data"), agent("erp.retail")],
      map(tool("erp.data.run_sql", ["erp.retail"])),
    );
    expect(bound.get("erp.data")).toEqual([]);
    expect(bound.get("erp.retail")).toHaveLength(1);
  });

  it('binds "*" to every declared agent', () => {
    const bound = resolveBindings(
      [agent("erp.data"), agent("erp.retail"), agent("erp.sales")],
      map(tool("erp.shared.ping", ["*"])),
    );
    for (const list of bound.values()) expect(list).toHaveLength(1);
  });

  it("treats an empty list as omitted", () => {
    const bound = resolveBindings([agent("erp.data")], map(tool("erp.data.run_sql", [])));
    expect(bound.get("erp.data")).toHaveLength(1);
  });

  it("sorts each agent's tools ordinally", () => {
    const bound = resolveBindings(
      [agent("erp.data")],
      map(
        tool("erp.data.b", ["erp.data"]),
        tool("erp.data.A", ["erp.data"]),
        tool("erp.data.a", ["erp.data"]),
      ),
    );
    expect(bound.get("erp.data")!.map((t) => t.key)).toEqual([
      "erp.data.A",
      "erp.data.a",
      "erp.data.b",
    ]);
  });

  it("throws on an unknown agent key", () => {
    expect(() =>
      validateBindings(
        [agent("erp.data")],
        map(tool("erp.data.run_sql", ["erp.nope"])),
        () => {},
      ),
    ).toThrow(/erp\.nope/);
  });

  it('throws when "*" is mixed with explicit keys', () => {
    expect(() =>
      validateBindings(
        [agent("erp.data")],
        map(tool("erp.data.run_sql", ["*", "erp.data"])),
        () => {},
      ),
    ).toThrow();
  });

  it("warns when the key prefix names an agent absent from the list", () => {
    const warnings: string[] = [];
    validateBindings(
      [agent("erp.data"), agent("erp.retail")],
      map(tool("erp.data.run_sql", ["erp.retail"])),
      (m) => warnings.push(m),
    );
    expect(
      warnings.some((w) => w.includes("erp.data.run_sql") && w.includes("erp.data")),
    ).toBe(true);
  });

  // A shared tool named outside every agent namespace is legal PRECISELY
  // because it names its agents.
  it("allows a tool outside every agent namespace when it names agents", () => {
    const agents = [agent("erp.data"), agent("erp.retail")];
    const tools = map(tool("erp.shared.run_sql", ["erp.data", "erp.retail"]));

    expect(() => validateBindings(agents, tools, () => {})).not.toThrow();

    const bound = resolveBindings(agents, tools);
    expect(bound.get("erp.data")).toHaveLength(1);
    expect(bound.get("erp.retail")).toHaveLength(1);
  });

  // …and still refuses it when it names none, because then nothing could ever
  // call it and that is never intentional.
  it("throws for a tool matching no agent that also names none", () => {
    expect(() =>
      validateBindings([agent("erp.data")], map(tool("erp.shared.orphan")), () => {}),
    ).toThrow(/erp\.shared\.orphan/);
  });
});

// Learned the hard way on 2026-08-18: `agents: ["*"]` on erp_bc's run_sql
// pushed ONE agent from 30 tools to 31, one over that connector's limit, so the
// hub rejected the whole Register — and with no declaration, BOTH the schema
// gate and the credential gate refused every call for ~1 hour.
describe("hub limits", () => {
  const bind = (agents: string[], tools: ToolDeclaration[]) =>
    resolveBindings(agents.map(agent), new Map(tools.map((t) => [t.key, t])));

  it("does not throw under or exactly at the limit", () => {
    const bound = bind(["erp.data"], [tool("erp.data.a"), tool("erp.data.b")]);
    expect(() => validateHubLimits(bound, 3)).not.toThrow();
    // The hub refuses 31 against 30, so the limit itself is allowed. Off-by-one
    // here would ground a connector the hub accepts.
    expect(() => validateHubLimits(bound, 2)).not.toThrow();
  });

  it("throws over the limit, naming the agent and both counts", () => {
    const bound = bind(["erp.data"], [tool("erp.data.a"), tool("erp.data.b"), tool("erp.data.c")]);
    expect(() => validateHubLimits(bound, 2)).toThrow(/erp\.data.*3 tools.*limit is 2/s);
  });

  it("names the shared tool when one contributed", () => {
    const bound = bind(
      ["erp.data", "erp.retail"],
      [tool("erp.retail.a"), tool("erp.retail.b"), tool("erp.shared.run_sql", ["*"])],
    );
    expect(() => validateHubLimits(bound, 2)).toThrow(/erp\.shared\.run_sql/);
  });

  it("treats 0 as unknown and does not throw", () => {
    // proto3 defaults uint32 to 0 and an older hub sends nothing; reading that
    // as a real ceiling would ground every connector — this check inverted.
    const bound = bind(["erp.data"], [tool("erp.data.a"), tool("erp.data.b")]);
    expect(() => validateHubLimits(bound, 0)).not.toThrow();
  });
});
