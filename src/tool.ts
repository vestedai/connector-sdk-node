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
  /** Caller's employee number in the org's ERP/HR system. Empty string when unset. */
  readonly employeeNo: string;
  /** Caller's primary ERP identifier. Empty string when unset. */
  readonly erpIdentifier: string;
  /** ERP identifiers of every department the caller belongs to in this org. Empty array when unset. */
  readonly erpDepartmentIdentifiers: string[];
}

export abstract class ToolHandler<TArgs = unknown, TResult = unknown> {
  static args: ZodType;
  static result?: ZodType;
  abstract handle(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

export const TOOL_SENSITIVITIES = ["read", "write", "destructive", "external_call", "medium"] as const;
export type ToolSensitivity = typeof TOOL_SENSITIVITIES[number];

export interface ToolDecl {
  key: string;
  description: string;
  name?: string;
  defaultDeadlineMs?: number;
  maxResultBytes?: number;
  sensitivity?: string;
}

export interface ToolDeclaration extends Required<Omit<ToolDecl, "name" | "sensitivity">> {
  name: string;
  sensitivity: string;
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
    if (decl.sensitivity && !(TOOL_SENSITIVITIES as readonly string[]).includes(decl.sensitivity)) {
      throw new Error(
        `@tool("${decl.key}") sensitivity must be one of ${TOOL_SENSITIVITIES.join(", ")}; got "${decl.sensitivity}"`
      );
    }
    const resultSchema = (target as unknown as { result?: ZodType }).result;
    const normalized: ToolDeclaration = {
      key: decl.key,
      name: decl.name ?? decl.key,
      description: decl.description,
      defaultDeadlineMs: decl.defaultDeadlineMs ?? 30_000,
      maxResultBytes: decl.maxResultBytes ?? 1_048_576,
      sensitivity: decl.sensitivity ?? "",
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
