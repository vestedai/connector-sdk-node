import { describe, expect, it } from "vitest";
import { resolveBindings, validateBindings } from "../src/tool-binding.ts";
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
