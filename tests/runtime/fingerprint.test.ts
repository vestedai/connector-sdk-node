import { describe, it, expect } from "vitest";
import { computeFingerprint } from "../../src/runtime/fingerprint.ts";
import type { AgentDeclaration } from "../../src/agent.ts";
import type { ToolDeclaration } from "../../src/tool.ts";
import type { ToolHandler } from "../../src/tool.ts";

function makeAgent(key: string): AgentDeclaration {
  return {
    key,
    name: key,
    model: "openai:gpt-4o",
    description: "test agent",
    status: "active",
    instructions: [],
    modelConfig: {},
  };
}

function makeTool(key: string, sensitivity = ""): ToolDeclaration {
  return {
    key,
    name: key,
    description: "test tool",
    inputSchema: { type: "object", properties: {} },
    outputSchema: null,
    defaultDeadlineMs: 30_000,
    maxResultBytes: 1_048_576,
    sensitivity,
    handlerCtor: class extends (null as unknown as typeof ToolHandler) {
      async handle() {
        return {};
      }
    } as unknown as new () => ToolHandler,
  };
}

describe("computeFingerprint", () => {
  it("returns a non-empty 64-char hex string", () => {
    const agents = [makeAgent("a.agent")];
    const tools = new Map([["a.agent.tool1", makeTool("a.agent.tool1")]]);
    const fp = computeFingerprint(agents, tools);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.length).toBe(64);
  });

  it("is stable — same inputs produce the same hash", () => {
    const agents = [makeAgent("a.agent")];
    const tools = new Map([["a.agent.tool1", makeTool("a.agent.tool1")]]);
    const fp1 = computeFingerprint(agents, tools);
    const fp2 = computeFingerprint(agents, tools);
    expect(fp1).toBe(fp2);
  });

  it("differs when a tool is removed", () => {
    const agents = [makeAgent("a.agent")];
    const toolsA = new Map([
      ["a.agent.tool1", makeTool("a.agent.tool1")],
      ["a.agent.tool2", makeTool("a.agent.tool2")],
    ]);
    const toolsB = new Map([["a.agent.tool1", makeTool("a.agent.tool1")]]);
    const fp1 = computeFingerprint(agents, toolsA);
    const fp2 = computeFingerprint(agents, toolsB);
    expect(fp1).not.toBe(fp2);
  });

  it("differs when an agent is removed", () => {
    const agentsA = [makeAgent("a.agent"), makeAgent("b.agent")];
    const agentsB = [makeAgent("a.agent")];
    const tools = new Map<string, ToolDeclaration>();
    const fp1 = computeFingerprint(agentsA, tools);
    const fp2 = computeFingerprint(agentsB, tools);
    expect(fp1).not.toBe(fp2);
  });

  it("does not produce empty string even with empty inputs", () => {
    // Guards against the Python v0.2.0 empty-fingerprint bug repeating.
    const fp = computeFingerprint([], new Map());
    expect(fp).not.toBe("");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when tools have different sensitivity values", () => {
    const agents = [makeAgent("a.agent")];
    const toolsA = new Map([["a.agent.tool1", makeTool("a.agent.tool1", "read")]]);
    const toolsB = new Map([["a.agent.tool1", makeTool("a.agent.tool1", "destructive")]]);
    const fp1 = computeFingerprint(agents, toolsA);
    const fp2 = computeFingerprint(agents, toolsB);
    expect(fp1).not.toBe(fp2);
  });
});
