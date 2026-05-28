import { type ZodType } from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { ToolValidationError } from "./errors.ts";

export interface ToolContext {
  readonly orgId: number;
  readonly agentKey: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly userEmail?: string;
  readonly userId?: number;
}

export abstract class ToolHandler<TArgs = unknown, TResult = unknown> {
  static args: ZodType;
  static result?: ZodType;
  abstract handle(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

export interface ToolDecl {
  key: string;
  description: string;
  name?: string;
  defaultDeadlineMs?: number;
  maxResultBytes?: number;
}

export interface ToolDeclaration extends Required<Omit<ToolDecl, "name">> {
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  handlerCtor: new () => ToolHandler;
}

const TOOL_SENTINEL = Symbol.for("__vested_tool__");

export function tool(decl: ToolDecl) {
  return function <T extends typeof ToolHandler>(
    target: T,
    _context: ClassDecoratorContext<T>
  ): T {
    const argsSchema = (target as unknown as { args?: ZodType }).args;
    if (!argsSchema) {
      throw new Error(`@tool("${decl.key}") class must declare static args = z.object(...)`);
    }
    const resultSchema = (target as unknown as { result?: ZodType }).result;
    const normalized: ToolDeclaration = {
      key: decl.key,
      name: decl.name ?? decl.key,
      description: decl.description,
      defaultDeadlineMs: decl.defaultDeadlineMs ?? 30_000,
      maxResultBytes: decl.maxResultBytes ?? 1_048_576,
      inputSchema: zodToJsonSchema(argsSchema) as Record<string, unknown>,
      outputSchema: resultSchema
        ? (zodToJsonSchema(resultSchema) as Record<string, unknown>)
        : null,
      handlerCtor: target as unknown as new () => ToolHandler,
    };
    (target as unknown as Record<symbol, ToolDeclaration>)[TOOL_SENTINEL] = normalized;
    return target;
  };
}

export function readToolDeclaration(target: unknown): ToolDeclaration | undefined {
  return (target as Record<symbol, ToolDeclaration | undefined>)[TOOL_SENTINEL];
}

export function validateArgs(decl: ToolDeclaration, raw: Buffer | string): unknown {
  const text = typeof raw === "string" ? raw : raw.toString("utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ToolValidationError(decl.key, `args is not valid JSON: ${String(e)}`);
  }
  const handlerCls = decl.handlerCtor as unknown as { args: ZodType };
  const result = handlerCls.args.safeParse(parsed);
  if (!result.success) {
    throw new ToolValidationError(decl.key, result.error.message);
  }
  return result.data;
}
