#!/usr/bin/env node
/**
 * vested-connect CLI entry point.
 *
 * main() is exported so tests can drive it with explicit argv + env without
 * touching process.argv or calling process.exit. This is the Node analogue
 * of Python's `if __name__ == "__main__"` guard.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ConnectorApp, isConnectorApp } from "./app.ts";

export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const command = argv[0];
  if (command !== "worker") {
    console.error(`unknown command: ${command}`);
    printHelp();
    return 1;
  }

  const bootstrap = flagValue(argv, "--bootstrap");
  if (!bootstrap) {
    console.error("--bootstrap=<path> required");
    return 1;
  }

  const hub = flagValue(argv, "--hub-addr") ?? env["VESTED_CONNECTOR_HUB"];
  const insecure = argv.includes("--insecure");
  const tokenStdin = argv.includes("--token-stdin");

  let token: string;
  if (tokenStdin) {
    token = (await readStdin()).trim();
  } else {
    token = env["VESTED_CONNECTOR_TOKEN"] ?? "";
  }

  if (!token) {
    console.error(
      "VESTED_CONNECTOR_TOKEN env (or --token-stdin) required",
    );
    return 78;
  }
  if (!hub) {
    console.error(
      "VESTED_CONNECTOR_HUB env (or --hub-addr) required",
    );
    return 78;
  }

  const bootstrapPath = resolve(process.cwd(), bootstrap);
  if (!existsSync(bootstrapPath)) {
    console.error(`bootstrap not found: ${bootstrapPath}`);
    return 1;
  }

  const url = pathToFileURL(bootstrapPath).href;
  let mod: { default?: unknown };
  try {
    mod = (await import(url)) as { default?: unknown };
  } catch (e) {
    console.error(`failed to import bootstrap ${bootstrapPath}: ${e}`);
    return 1;
  }

  const app = mod.default;
  // isConnectorApp brand-checks the value so we survive module duplication
  // (e.g. cli.js loaded as JS, bootstrap.ts loaded via tsx — they end up with
  // separate ConnectorApp class references, but the global Symbol.for brand
  // is identical across copies).
  if (!isConnectorApp(app)) {
    console.error(
      `bootstrap ${bootstrapPath} must default-export a ConnectorApp instance`,
    );
    return 1;
  }

  return await (app as ConnectorApp).run({ token, hub, insecure });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flagValue(argv: string[], flag: string): string | undefined {
  // --flag=value form
  const eqIndex = argv.findIndex((a) => a.startsWith(`${flag}=`));
  if (eqIndex >= 0) return argv[eqIndex]!.slice(flag.length + 1);
  // --flag value form
  const spaceIndex = argv.indexOf(flag);
  if (spaceIndex >= 0 && spaceIndex + 1 < argv.length)
    return argv[spaceIndex + 1];
  return undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function printHelp(): void {
  console.log(`vested-connect — Vested AI Connector SDK CLI

Usage:
  vested-connect worker --bootstrap=<path> [--hub-addr=<host:port>] [--insecure] [--token-stdin]

Flags:
  --bootstrap=<path>       Path to bootstrap.ts/js that default-exports a ConnectorApp
  --hub-addr=<host:port>   Hub address (or env VESTED_CONNECTOR_HUB)
  --insecure               Use plaintext gRPC (local dev only)
  --token-stdin            Read token from stdin (or env VESTED_CONNECTOR_TOKEN)`);
}

// ---------------------------------------------------------------------------
// Script entry point — only runs when invoked directly (not on import).
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
