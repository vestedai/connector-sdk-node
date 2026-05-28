/**
 * Fixture: minimal agent + echo tool used by integration.test.ts.
 *
 * These classes are loaded via app.scanModule() so they must live in their
 * own module file (scanModule walks the directory of the given URL).
 */

import { z } from "zod";
import { agent } from "../../../src/agent.ts";
import { tool, ToolHandler } from "../../../src/tool.ts";
import type { ToolContext } from "../../../src/tool.ts";

@agent({ key: "t.test", name: "Test", model: "openai:gpt-4o" })
export class _Agent {}

@tool({ key: "t.test.echo", description: "echo" })
export class _Echo extends ToolHandler {
  static args = z.object({ text: z.string().describe("echo me") });
  static result = z.object({ echoed: z.string() });

  async handle(args: z.infer<typeof _Echo.args>, _ctx: ToolContext) {
    return { echoed: args.text };
  }
}
