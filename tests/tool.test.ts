import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tool, ToolHandler, readToolDeclaration, validateArgs } from "../src/tool.ts";
import type { ToolContext } from "../src/tool.ts";
import { ToolValidationError } from "../src/errors.ts";

describe("@tool", () => {
  @tool({ key: "x.y.echo", description: "echo" })
  class Echo extends ToolHandler {
    static args = z.object({ text: z.string().describe("Echo me.") });
    static result = z.object({ echoed: z.string() });
    async handle(args: z.infer<typeof Echo.args>, _ctx: ToolContext) {
      return { echoed: args.text };
    }
  }

  it("stamps the declaration", () => {
    const decl = readToolDeclaration(Echo);
    expect(decl?.key).toBe("x.y.echo");
    expect(decl?.inputSchema).toBeDefined();
  });

  it("description flows into JSON Schema", () => {
    const decl = readToolDeclaration(Echo);
    const schema = decl?.inputSchema as { properties?: { text?: { description?: string } } };
    expect(schema.properties?.text?.description).toBe("Echo me.");
  });

  it("rejects classes without static args", () => {
    expect(() => {
      @tool({ key: "x.y.bare", description: "" })
      // @ts-expect-error: missing args
      class _Bare extends ToolHandler {
        async handle() { return {}; }
      }
    }).toThrow(/must declare static args/);
  });

  it("validateArgs returns parsed object on success", () => {
    const decl = readToolDeclaration(Echo)!;
    const args = validateArgs(decl, '{"text":"hi"}') as { text: string };
    expect(args.text).toBe("hi");
  });

  it("validateArgs throws ToolValidationError on bad input", () => {
    const decl = readToolDeclaration(Echo)!;
    expect(() => validateArgs(decl, "{}")).toThrow(ToolValidationError);
  });

  it("sensitivity defaults to empty string when not provided", () => {
    const decl = readToolDeclaration(Echo)!;
    expect(decl.sensitivity).toBe("");
  });

  it("stamps sensitivity when provided", () => {
    @tool({ key: "x.y.destructive_op", description: "destructive", sensitivity: "destructive" })
    class DestructiveOp extends ToolHandler {
      static args = z.object({ id: z.string() });
      async handle(_args: z.infer<typeof DestructiveOp.args>, _ctx: ToolContext) {
        return {};
      }
    }
    const decl = readToolDeclaration(DestructiveOp)!;
    expect(decl.sensitivity).toBe("destructive");
  });

  it("throws at decoration time when sensitivity is invalid", () => {
    expect(() => {
      @tool({ key: "x.y.bad_sens", description: "bad sensitivity", sensitivity: "super_dangerous" })
      class _BadSens extends ToolHandler {
        static args = z.object({ x: z.string() });
        async handle() { return {}; }
      }
    }).toThrow(/sensitivity must be one of/);
    expect(() => {
      @tool({ key: "x.y.bad_sens2", description: "bad sensitivity 2", sensitivity: "super_dangerous" })
      class _BadSens2 extends ToolHandler {
        static args = z.object({ x: z.string() });
        async handle() { return {}; }
      }
    }).toThrow(/"super_dangerous"/);
  });
});
