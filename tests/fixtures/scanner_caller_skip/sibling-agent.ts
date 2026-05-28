import { z } from "zod";
import { agent } from "../../../src/agent.ts";
import { tool, ToolHandler } from "../../../src/tool.ts";
import type { ToolContext } from "../../../src/tool.ts";

@agent({ key: "skip_fixture.demo", name: "Skip Demo", model: "openai:gpt-4o" })
export class SkipDemoAgent {}

@tool({ key: "skip_fixture.demo.ping", description: "Ping." })
export class SkipDemoPing extends ToolHandler {
  static args = z.object({ msg: z.string() });
  async handle(args: { msg: string }, _ctx: ToolContext) {
    return { echoed: args.msg };
  }
}
