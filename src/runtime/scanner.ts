/**
 * Walk a directory and collect every @agent / @tool decorated class.
 *
 * Port of vested_connect/runtime/scanner.py.
 *
 * IMPORTANT: `.ts` is included in EXTS so that vitest tests can scan a
 * fixture directory of TypeScript source files (vitest's transformer handles
 * the dynamic import). At customer runtime, the bootstrap directory would
 * normally contain `.js` files only.
 */

import { readdir, stat } from "node:fs/promises";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentDeclaration } from "../agent.ts";
import type { ToolDeclaration } from "../tool.ts";
import { readAgentDeclaration } from "../agent.ts";
import { readToolDeclaration } from "../tool.ts";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXTS = new Set([".ts", ".js", ".mjs"]);

export interface ScanResult {
  agents: AgentDeclaration[];
  tools: Map<string, ToolDeclaration>;
}

/**
 * Resolve the directory that contains `importUrl` (or the URL itself if
 * it already points at a directory), walk every `.ts`/`.js`/`.mjs` file,
 * dynamic-import each, and collect decorated agents + tools.
 *
 * The caller's file (typically `bootstrap.ts`) is excluded from the walk
 * to avoid a re-entrant import while its top-level `await scanModule(...)`
 * is still pending — that deadlocks the entire module graph.
 *
 * @param importUrl - A file:// URL. Accepts either a file URL
 *   (`import.meta.url` of the bootstrap is the common case) or a directory
 *   URL (`new URL("./agents/", import.meta.url)`); in the directory form
 *   we walk that directory directly instead of climbing to its parent.
 */
export async function scanModule(importUrl: string): Promise<ScanResult> {
  const path = fileURLToPath(importUrl);
  const isDir = await isDirectoryPath(path);
  const dir = isDir ? path : dirname(path);
  // When the caller passed their own file URL, exclude that file from the
  // walk so dynamic-importing it doesn't deadlock against its own pending
  // top-level await.
  const callerFile = isDir ? null : resolve(path);

  const files = (await collectFiles(dir)).filter((f) => f !== callerFile);

  const agents: AgentDeclaration[] = [];
  const tools = new Map<string, ToolDeclaration>();

  for (const file of files) {
    const url = pathToFileURL(file).href;
    const mod: Record<string, unknown> = await import(url);
    for (const value of Object.values(mod)) {
      const agentDecl = readAgentDeclaration(value);
      if (agentDecl) {
        // Avoid duplicates when the same declaration is re-exported
        if (!agents.some((a) => a.key === agentDecl.key)) {
          agents.push(agentDecl);
        }
      }

      const toolDecl = readToolDeclaration(value);
      if (toolDecl) {
        const existing = tools.get(toolDecl.key);
        if (existing && existing !== toolDecl) {
          throw new Error(
            `duplicate tool key ${toolDecl.key} (handlers: ${existing.name} and ${toolDecl.name})`,
          );
        }
        tools.set(toolDecl.key, toolDecl);
      }
    }
  }

  return { agents, tools };
}

async function isDirectoryPath(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (EXTS.has(ext)) out.push(full);
    }
  }

  return out;
}
