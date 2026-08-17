/**
 * Resolves which tools each agent gets.
 *
 * THE ONLY PLACE THIS IS DECIDED. Both the Register frame (runtime/daemon.ts)
 * and the baseline fingerprint (runtime/fingerprint.ts) call resolveBindings().
 * Deriving binding separately in each is how a fingerprint comes to disagree
 * with the frame it summarises — and the hub trusts the fingerprint to decide
 * whether to reconcile at all, so a disagreement means a registration whose
 * content changed gets short-circuited as unchanged. Nothing errors; the change
 * simply never happens.
 *
 * The rule: an empty `agents` means the historical namespace-prefix binding. A
 * non-empty one is AUTHORITATIVE — the prefix confers nothing once a list is
 * present.
 */

import type { AgentDeclaration } from "./agent.ts";
import type { ToolDeclaration } from "./tool.ts";

/** Binds to every agent this connector declares. */
export const ALL_AGENTS = "*";

/** Ordinal (codepoint) comparison — the only ordering the other SDKs agree on. */
const byCodepoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * agent key -> its tools, each list ordinally sorted, because the fingerprint
 * hashes the result.
 */
export function resolveBindings(
  agents: readonly AgentDeclaration[],
  tools: ReadonlyMap<string, ToolDeclaration>,
): Map<string, ToolDeclaration[]> {
  const bound = new Map<string, ToolDeclaration[]>();
  for (const a of agents) bound.set(a.key, []);

  for (const tool of tools.values()) {
    for (const agentKey of targetsFor(tool, agents)) {
      bound.get(agentKey)?.push(tool);
    }
  }

  for (const list of bound.values()) {
    list.sort((x, y) => byCodepoint(x.key, y.key));
  }
  return bound;
}

/**
 * Which agents one tool targets: the prefix rule when it names none, every
 * declared agent for "*", otherwise the list verbatim.
 */
function targetsFor(
  tool: ToolDeclaration,
  agents: readonly AgentDeclaration[],
): string[] {
  const declared = tool.agents ?? [];

  if (declared.length === 0) {
    return agents
      .filter((a) => tool.key.startsWith(a.key + "."))
      .map((a) => a.key);
  }
  if (declared.includes(ALL_AGENTS)) return agents.map((a) => a.key);
  return [...declared];
}

/**
 * Refuses what cannot be meant; warns about what is legal but surprising.
 * Called from build(), before the worker dials the hub.
 *
 * `warn` is separate from throwing so the caller routes messages to its own
 * logger, and so tests can assert on them.
 */
export function validateBindings(
  agents: readonly AgentDeclaration[],
  tools: ReadonlyMap<string, ToolDeclaration>,
  warn: (message: string) => void,
): void {
  const declared = new Set(agents.map((a) => a.key));
  const known = [...declared].sort(byCodepoint).join(", ");

  for (const tool of tools.values()) {
    const listed = tool.agents ?? [];

    if (listed.length === 0) {
      // No list, so the prefix must find an agent — otherwise nothing could
      // ever call this tool, which is never intentional. This rule used to
      // apply to EVERY tool; it now applies only to those naming no agents,
      // because a tool that names its agents is legitimately allowed to sit
      // outside all of their namespaces.
      const prefixed = agents.some((a) => tool.key.startsWith(a.key + "."));
      if (!prefixed) {
        throw new Error(
          `tool '${tool.key}' has no matching agent (key must start with ` +
            `'<agentKey>.'), and declares no agents to bind it explicitly. ` +
            `Declared agents: ${known}.`,
        );
      }
      continue;
    }

    const hasStar = listed.includes(ALL_AGENTS);
    if (hasStar && listed.length > 1) {
      const explicitKeys = listed.filter((a) => a !== ALL_AGENTS).join(", ");
      throw new Error(
        `@tool("${tool.key}") combines "${ALL_AGENTS}" with explicit agent ` +
          `keys (${explicitKeys}). "${ALL_AGENTS}" already means every agent; ` +
          `drop one or the other.`,
      );
    }
    if (hasStar) continue;

    for (const key of listed) {
      if (!declared.has(key)) {
        throw new Error(
          `@tool("${tool.key}") names agent "${key}", which this connector ` +
            `does not declare. Declared agents: ${known}.`,
        );
      }
    }

    // Legal, and easy to reach by accident: the key says one agent owns the
    // tool while the list says that agent cannot call it. Warn rather than
    // throw — it is exactly how you express "lives here, callable from there".
    for (const a of agents) {
      if (tool.key.startsWith(a.key + ".") && !listed.includes(a.key)) {
        warn(
          `${tool.key} declares agents [${listed.join(", ")}] and is therefore ` +
            `NOT available to ${a.key}; rename the key or add it to the list.`,
        );
      }
    }
  }
}
