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

  /**
   * True when the platform forwarded a sealed credential for this caller.
   * False for a connector that declares no credential schema.
   */
  hasCredential(): boolean;

  /**
   * The calling user's credentials for this integration, decrypted.
   *
   * The envelope is opened and its identity binding verified inside the SDK,
   * so a connector author cannot skip the check that makes per-user auth mean
   * anything: an envelope sealed for another user throws rather than returning
   * someone else's secrets.
   *
   * Throws CredentialUnavailableError when none was forwarded, and
   * CredentialError when the envelope is not ours to open or is corrupt.
   */
  credential(): Record<string, string>;
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
  /**
   * Agent keys this tool is bound to. Omitted (the default) keeps the
   * historical rule: the tool binds to the agent its key is namespaced under,
   * and nothing changes for a connector that never sets this.
   *
   * A NON-EMPTY list is AUTHORITATIVE, not additive — the key's prefix confers
   * nothing once a list is present, so a tool may live in one namespace and be
   * callable only from another. Sharing one declaration across agents is the
   * point: without it, the same behaviour needs a duplicate handler class per
   * namespace.
   *
   * `["*"]` means every agent this connector declares, resolved at Register
   * time, so an agent added later picks the tool up with no further change. It
   * cannot be combined with explicit keys.
   *
   * Validated at `build()`, before the worker dials the hub: an agent key this
   * connector does not declare is refused, because it would otherwise bind the
   * tool to nothing at all, silently.
   *
   * @example
   * ```ts
   * @tool({ key: "erp.data.run_sql", description: "…",
   *         agents: ["erp.data", "erp.retail"] })
   * ```
   */
  agents?: string[];
}

export interface ToolDeclaration
  extends Required<Omit<ToolDecl, "name" | "sensitivity" | "agents">> {
  name: string;
  sensitivity: string;
  agents: string[];
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
      agents: decl.agents ?? [],
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
