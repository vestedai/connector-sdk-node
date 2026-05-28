export interface Instruction {
  readonly type: string;
  readonly position: number;
  readonly body: string;
  readonly format?: "markdown" | "text";
}

export interface AgentDecl {
  key: string;
  name: string;
  model: string;
  description?: string;
  status?: "active" | "draft";
  instructions?: readonly Instruction[];
  modelConfig?: Record<string, unknown>;
}

export interface AgentDeclaration extends Required<Omit<AgentDecl, "modelConfig">> {
  modelConfig: Record<string, unknown>;
}

const AGENT_SENTINEL = Symbol.for("__vested_agent__");

type ClassCtor = new (...args: unknown[]) => unknown;

export function agent(decl: AgentDecl) {
  return function <T extends ClassCtor>(
    target: T,
    _context: ClassDecoratorContext<T>
  ): T {
    const normalized: AgentDeclaration = {
      key: decl.key,
      name: decl.name,
      model: decl.model,
      description: decl.description ?? "",
      status: decl.status ?? "active",
      instructions: decl.instructions ?? [],
      modelConfig: decl.modelConfig ?? {},
    };
    (target as unknown as Record<symbol, AgentDeclaration>)[AGENT_SENTINEL] = normalized;
    return target;
  };
}

export function readAgentDeclaration(target: unknown): AgentDeclaration | undefined {
  return (target as Record<symbol, AgentDeclaration | undefined>)[AGENT_SENTINEL];
}
