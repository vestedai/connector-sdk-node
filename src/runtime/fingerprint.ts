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
import { resolveBindings } from "../tool-binding.ts";

/**
 * Ordinal (codepoint) comparison — never localeCompare.
 *
 * localeCompare collates: it reorders keys differing by case, or by '_'
 * against a letter. dotnet and python canonicalise this same structure, so a
 * locale sort makes identical declarations hash differently per SDK —
 * measured, two independent swaps on realistic agent keys.
 */
const byCodepoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function computeFingerprint(
  agents: readonly AgentDeclaration[],
  tools: ReadonlyMap<string, ToolDeclaration>,
): string {
  return createHash("sha256")
    .update(canonicalJsonFor(agents, tools), "utf-8")
    .digest("hex");
}

/**
 * The canonical JSON that computeFingerprint hashes. Exported so tests can
 * assert ORDERING directly: a hash tells you only that something differs,
 * never what, and ordering is exactly what diverged between the SDKs.
 */
export function canonicalJsonFor(
  agents: readonly AgentDeclaration[],
  tools: ReadonlyMap<string, ToolDeclaration>,
): string {
  // Binding must come from resolveBindings, NOT be re-derived here. The
  // Register frame uses the same call, and a fingerprint that disagrees with
  // the frame it summarises would let the hub short-circuit a registration
  // whose content had in fact changed.
  const bound = resolveBindings(agents, tools);

  const canonical = {
    agents: [...agents]
      .sort((a, b) => byCodepoint(a.key, b.key))
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
        // Which tools this agent is BOUND to. Without it, re-pointing a tool at
        // different agents leaves the fingerprint unchanged and the hub never
        // reconciles the new binding. Safe to omit only while binding was
        // derived from the tool key — it no longer is.
        tools: (bound.get(a.key) ?? []).map((t) => t.key),
      })),
    tools: [...tools.entries()]
      .sort(([a], [b]) => byCodepoint(a, b))
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

  return canonicalJsonStringify(canonical);
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
