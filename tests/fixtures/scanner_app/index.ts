/**
 * Fixture: a module that declares one @agent and two @tool classes.
 * Used by scanner.test.ts to verify scanModule() collects them correctly.
 */

import { z } from "zod";
import { agent } from "../../../src/agent.ts";
import { tool, ToolHandler } from "../../../src/tool.ts";
import type { ToolContext } from "../../../src/tool.ts";

@agent({ key: "fixture.agent", name: "Fixture Agent", model: "openai:gpt-4o" })
export class FixtureAgent {}

@tool({ key: "fixture.agent.ping", description: "Ping tool" })
export class PingTool extends ToolHandler {
  static args = z.object({ message: z.string() });
  async handle(args: { message: string }, _ctx: ToolContext) {
    return { reply: args.message };
  }
}

@tool({ key: "fixture.agent.pong", description: "Pong tool" })
export class PongTool extends ToolHandler {
  static args = z.object({ value: z.number() });
  async handle(args: { value: number }, _ctx: ToolContext) {
    return { doubled: args.value * 2 };
  }
}

/** A plain class with no decorators — should be ignored by the scanner. */
export class PlainClass {
  doNothing() {}
}
