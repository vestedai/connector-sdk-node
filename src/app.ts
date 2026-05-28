/**
 * ConnectorApp — customer-facing container.
 *
 * Customers build one in bootstrap.ts/.js and the `vested-connect worker`
 * CLI runs it.
 *
 * Example bootstrap.ts:
 *
 *   import { ConnectorApp } from "@vested-ai/connector-sdk";
 *
 *   export default await ConnectorApp.create()
 *     .scanModule(import.meta.url)
 *     .build();
 */

import type { AgentDeclaration } from "./agent.ts";
import type { ToolDeclaration } from "./tool.ts";
import { scanModule as runtimeScanModule } from "./runtime/scanner.ts";
import { runSupervised } from "./runtime/supervisor.ts";

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const defaultLogger: Logger = {
  debug: (m, ...a) =>
    process.env["LOG_LEVEL"] === "debug" &&
    console.debug(`[vested] ${m}`, ...a),
  info: (m, ...a) => console.log(`[vested] ${m}`, ...a),
  warn: (m, ...a) => console.warn(`[vested] ${m}`, ...a),
  error: (m, ...a) => console.error(`[vested] ${m}`, ...a),
};

/**
 * Cross-realm brand. Survives module duplication that breaks `instanceof`
 * (e.g. when the CLI is loaded as JS and bootstrap.ts is loaded via a
 * transpiler that resolves @vested-ai/connector-sdk to a separate copy).
 * Use `isConnectorApp(x)` to recognise an app regardless of which copy of
 * the SDK constructed it.
 */
export const CONNECTOR_APP_BRAND = Symbol.for("vested-ai.connector-sdk.ConnectorApp");

export function isConnectorApp(value: unknown): value is ConnectorApp {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [CONNECTOR_APP_BRAND]?: true })[CONNECTOR_APP_BRAND] === true &&
    typeof (value as { run?: unknown }).run === "function"
  );
}

export class ConnectorApp {
  /** Brand marker for cross-realm identification. */
  readonly [CONNECTOR_APP_BRAND] = true as const;
  /** @internal — satisfies AppLike */
  agents: AgentDeclaration[] = [];
  /** @internal — satisfies AppLike */
  tools: Map<string, ToolDeclaration> = new Map();
  private _logger: Logger = defaultLogger;

  static create(): ConnectorApp {
    return new ConnectorApp();
  }

  withLogger(logger: Logger): this {
    this._logger = logger;
    return this;
  }

  async scanModule(importUrl: string): Promise<this> {
    const { agents, tools } = await runtimeScanModule(importUrl);
    for (const a of agents) {
      if (this.agents.some((x) => x.key === a.key)) {
        throw new Error(`duplicate agent key ${a.key}`);
      }
      this.agents.push(a);
    }
    for (const [k, v] of tools) {
      if (this.tools.has(k)) {
        throw new Error(`duplicate tool key ${k}`);
      }
      this.tools.set(k, v);
    }
    return this;
  }

  build(): this {
    // Optional: validate tool key prefixes match agent keys (namespace_violation catch).
    return this;
  }

  get logger(): Logger {
    return this._logger;
  }

  async run(opts: {
    token: string;
    hub: string;
    insecure?: boolean;
  }): Promise<number> {
    const [host, portStr] = opts.hub.split(":");
    if (!host) throw new Error(`invalid hub address: ${opts.hub}`);
    const port = parseInt(portStr ?? "4443", 10);
    return runSupervised(this, opts.token, host, port, opts.insecure ?? false);
  }
}
