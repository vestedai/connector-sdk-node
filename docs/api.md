# API Reference

## ConnectorApp

The top-level facade. Build one in `bootstrap.ts`; the CLI loads and runs it.

Source: `src/app.ts`

**`ConnectorApp.create() -> ConnectorApp`**
Static constructor. All configuration follows via chained calls.

```typescript
const app = ConnectorApp.create();
```

**`.withLogger(logger: Logger) -> ConnectorApp`**
Plug in any `Logger`-compatible object. The SDK binds per-call fields (`invocation_id`, `agent_key`, `tool_key`) before passing the logger to each handler. Default: a `console`-backed logger at `INFO` level.

```typescript
import { pino } from "pino";
app.withLogger(pino({ name: "myapp.connector" }));
```

**`.scanModule(importUrl: string) -> Promise<ConnectorApp>`**
Discover `@agent`- and `@tool`-decorated classes in the module at the given file URL. Pass `import.meta.url` to scan the current module's directory tree.

```typescript
await app.scanModule(import.meta.url);
```

**`.agents -> AgentDeclaration[]`**
Read-only array of all declared agents after `scanModule()` has run.

**`.tools -> Map<string, ToolDeclaration>`**
Read-only map of all declared tools after `scanModule()` has run.

**`.logger -> Logger`**
The currently configured logger instance.

**`.build() -> ConnectorApp`**
Validates the collected declarations (optional pre-run check). Returns `this` for chaining.

**`.run(opts: { token: string; hub: string; insecure?: boolean }) -> Promise<number>`**
Run the supervisor loop. Connects to the hub, sends Hello+Register, then enters steady-state. On disconnect, backs off and reconnects. Returns `0` on clean shutdown (SIGTERM/SIGINT), `78` on token rejection (`EX_CONFIG`). `insecure: true` uses plaintext gRPC — for local dev only.

```typescript
const code = await app.run({
  token: process.env.VESTED_CONNECTOR_TOKEN!,
  hub:   process.env.VESTED_CONNECTOR_HUB!,
});
process.exit(code);
```

The CLI wraps this call. In your own entry point you may call `run()` directly.

---

## `@agent` decorator

Declare an agent. Applied to a class — the class body is unused; it is a declaration container only.

```typescript
import { agent, type Instruction } from "@vested-ai/connector-sdk";

@agent({
  key: "myns.orders",
  name: "Orders",
  description: "Manages order data",          // optional
  status: "active",                            // default
  model: "openai:gpt-4o",                      // required: "provider:model-name"
  modelConfig: { temperature: 0.2 },           // optional
  instructions: [
    { type: "system",  position: 0, body: "You manage order data." },
    { type: "persona", position: 1, body: "Professional, concise." },
  ],
})
class OrdersAgent {}
```

`key`, `name`, and `model` are required. All other fields are optional.

### `Instruction` interface

```typescript
interface Instruction {
  readonly type: string;      // "system" | "task" | "persona" | "safety"
  readonly position: number;  // ascending sort order
  readonly body: string;      // prompt text
  readonly format?: "markdown" | "text";  // default "markdown"
}
```

---

## `@tool` decorator

Declare a tool and bind it to a handler class. The class must extend `ToolHandler`.

```typescript
import { tool, ToolHandler, type ToolContext } from "@vested-ai/connector-sdk";
import { z } from "zod";

@tool({
  key: "myns.orders.get",
  name: "Get order",                   // optional; defaults to key
  description: "Returns a single order by ID.",
  defaultDeadlineMs: 5000,             // optional; default 30 000
  maxResultBytes: 65536,               // optional; default 1 MiB
  sensitivity: "read",                 // optional; see below
})
class GetOrder extends ToolHandler {
  static args = z.object({
    id: z.string().describe("Order ID"),
  });

  static result = z.object({ status: z.string() }); // optional output schema

  async handle(args: z.infer<typeof GetOrder.args>, ctx: ToolContext) {
    return { status: "shipped" };
  }
}
```

The input JSON Schema is auto-generated from `static args` via `zod-to-json-schema`. If you need fine-grained control, set `inputSchema` directly on the decorator options instead. Output schema is inferred from `static result` if declared.

### `sensitivity` field

Controls how the hub's policy engine classifies this tool's side-effects.

| Value | Meaning |
|---|---|
| `"read"` | Read-only; never mutates data. |
| `"write"` | Creates or updates data. |
| `"destructive"` | Irreversibly deletes or overwrites data. |
| `"external_call"` | Makes a network call to a third-party system. |
| `"medium"` | General-purpose intermediate severity. |

`sensitivity` is optional. If omitted or empty (`""`), the hub defaults it to `"external_call"`. Admins can override the effective value later from the admin UI regardless of what the connector declares.

A non-empty value that is not in the list above throws an `Error` at decoration time (startup), not at runtime.

```typescript
import { TOOL_SENSITIVITIES } from "@vested-ai/connector-sdk";
// TOOL_SENSITIVITIES = ["read", "write", "destructive", "external_call", "medium"]
```

---

## `ToolHandler` base class

Source: `src/tool.ts`

```typescript
abstract class ToolHandler<TArgs = unknown, TResult = unknown> {
  static args: ZodType;           // required — declare on each subclass
  static result?: ZodType;        // optional — declare for output schema
  abstract handle(args: TArgs, ctx: ToolContext): Promise<TResult>;
}
```

`args` — already validated against the tool's input schema; typed to the Zod inference of `static args`.
Return value — any JSON-serializable value; validated against `static result` if declared.

Raise any exception to signal a handler error. The hub converts it to a `ToolCallResponse{error: ...}` and surfaces it in the run timeline.

---

## `ToolContext` interface

Source: `src/tool.ts`

Read-only value object passed to every handler.

| Field | Type | Description |
|---|---|---|
| `runId` | `string` | Hub-minted UUIDv7. Stable across logs and traces. |
| `orgId` | `number` | Org that owns this run. |
| `userId` | `number \| undefined` | User who triggered the run. Absent for system/scheduled runs. |
| `userEmail` | `string \| undefined` | Caller's email. Absent for system runs. **PII — do not log or persist.** |
| `conversationId` | `string` | Conversation this run belongs to. |
| `agentKey` | `string` | Key of the agent being run. |

---

## Error classes

Source: `src/errors.ts`

| Class | Raised when |
|---|---|
| `ConnectorError` | Base class for all SDK errors. |
| `TokenError` | Token rejected by the hub (`GoAway{token_rotated}` or `GoAway{revoked}`). Causes exit 78. |
| `ToolValidationError(toolKey, message)` | Input schema validation failed at the connector side. |

---

## `vested-connect` CLI

Installed as a bin entry by the package. Invoked as `vested-connect worker`.

**`vested-connect worker`**

Run a connector worker.

| Flag | Default | Description |
|---|---|---|
| `--bootstrap=PATH` | required | Path to the TypeScript or JavaScript bootstrap file. The file is imported; its default export must be a `ConnectorApp` instance. |
| `--hub-addr=HOST:PORT` | `$VESTED_CONNECTOR_HUB` | Hub address. |
| `--insecure` | — | Use plaintext gRPC (no TLS). Local dev only. |
| `--token-stdin` | — | Read the token from stdin instead of `$VESTED_CONNECTOR_TOKEN`. |

```bash
vested-connect worker --bootstrap=./bootstrap.ts
```

## Next

[Operations](operations.md)
