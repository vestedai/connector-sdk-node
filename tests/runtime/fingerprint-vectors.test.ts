/**
 * The baseline fingerprint is a CROSS-SDK contract.
 *
 * dotnet, node and python canonicalise the same structure and the hub uses the
 * result to decide whether a connector changed. Nothing checked they agreed,
 * and two things did not: the sort comparer (locale vs culture vs ordinal) and
 * `model_config` (dotnet emitted null where these two emit {}).
 *
 * This fixture is the check. `vested-ai-sdks/testdata` is canonical and each
 * SDK carries a generated copy, which scripts/verify-fingerprint-vectors.sh
 * guards against drift.
 *
 * php is deliberately NOT in this set: its canonical form nests tools inside
 * agent declarations and has never been comparable with these three.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../../src/runtime/fingerprint.ts";
import type { AgentDeclaration } from "../../src/agent.ts";
import type { ToolDeclaration, ToolHandler } from "../../src/tool.ts";

interface Vector {
  name: string;
  agents: readonly Record<string, unknown>[];
  tools: readonly Record<string, unknown>[];
  expected_sha256: string;
}

const vectorsUrl = new URL("../../testdata/fingerprint-vectors.json", import.meta.url);
const vectors: Vector[] = JSON.parse(
  readFileSync(fileURLToPath(vectorsUrl), "utf-8"),
).vectors;

function toAgent(a: Record<string, any>): AgentDeclaration {
  return {
    key: a.key,
    name: a.name,
    model: a.model,
    modelConfig: a.model_config,
    description: a.description,
    status: a.status,
    instructions: a.instructions.map((i: Record<string, any>) => ({
      type: i.type,
      position: i.position,
      body: i.body,
      format: i.format,
    })),
  };
}

function toTool(t: Record<string, any>): ToolDeclaration {
  return {
    key: t.key,
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
    outputSchema: t.output_schema,
    defaultDeadlineMs: t.default_deadline_ms,
    maxResultBytes: t.max_result_bytes,
    sensitivity: t.sensitivity,
    agents: t.agents ?? [],
    handlerCtor: class {} as unknown as new () => ToolHandler,
  };
}

describe("cross-SDK fingerprint vectors", () => {
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const agents = vector.agents.map(toAgent);
    const tools = new Map(vector.tools.map((t) => [t.key as string, toTool(t)]));

    expect(
      computeFingerprint(agents, tools),
      `vector "${vector.name}" drifted — this SDK now disagrees with the others ` +
        `about whether a connector changed`,
    ).toBe(vector.expected_sha256);
  });
});
