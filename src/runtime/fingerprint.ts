/**
 * SHA256 over the canonical agent + tool declaration shape.
 *
 * The hub uses the fingerprint to short-circuit re-registration: if a
 * connector reconnects with the same fingerprint it had last time the hub
 * skips the round-trip to Laravel and replies "accepted" immediately.
 *
 * CRITICAL: an empty fingerprint trivially matches the hub's empty initial
 * store value so it short-circuits _without_ reconciling. This function must
 * NEVER return "". See Python v0.2.1 fix in runtime/fingerprint.py.
 *
 * Port of vested_connect/runtime/fingerprint.py.
 */

import { createHash } from "node:crypto";
import type { AgentDeclaration } from "../agent.ts";
import type { ToolDeclaration } from "../tool.ts";

export function computeFingerprint(
  agents: readonly AgentDeclaration[],
  tools: ReadonlyMap<string, ToolDeclaration>,
): string {
  const canonical = {
    agents: [...agents]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((a) => ({
        key: a.key,
        name: a.name || a.key,
        description: a.description,
        status: a.status,
        model: a.model,
        model_config: a.modelConfig,
        instructions: [...a.instructions]
          .sort((x, y) => x.position - y.position)
          .map((i) => ({
            type: i.type,
            position: i.position,
            body: i.body,
            format: i.format ?? "markdown",
          })),
      })),
    tools: [...tools.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, t]) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        output_schema: t.outputSchema,
        default_deadline_ms: t.defaultDeadlineMs,
        max_result_bytes: t.maxResultBytes,
        sensitivity: t.sensitivity,
      })),
  };

  const encoded = canonicalJsonStringify(canonical);
  return createHash("sha256").update(encoded, "utf-8").digest("hex");
}

/**
 * Matches Python's json.dumps(sort_keys=True, separators=(",", ":")).
 * Keys are sorted at every object level; no extra whitespace.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalJsonStringify((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
