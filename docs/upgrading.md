# Upgrading

> **Other language SDKs:** the connector SDK also ships for [PHP](https://packagist.org/packages/vested-ai/connector-sdk-php) (`vested-ai/connector-sdk-php`), [Python](https://pypi.org/project/vested-connect-sdk/) (`vested-connect-sdk`), and [C# / .NET](https://www.nuget.org/packages/VestedAI.ConnectorSdk) (`VestedAI.ConnectorSdk`) — all at wire parity, including connector-declared tool sensitivity. See the [SDK index](../../README.md).

## Coming from the PHP or Python SDK

This section maps PHP and Python SDK concepts to their Node.js equivalents for customers evaluating or migrating between the SDKs.

### Install

| PHP | Python | Node.js |
|---|---|---|
| `composer require vested-ai/connector-sdk-php` | `pip install vested-connect-sdk` | `npm install @vested-ai/connector-sdk` |
| `vendor/bin/vested-connect worker --bootstrap=./bootstrap.php` | `vested-connect worker --bootstrap=./bootstrap.py` | `vested-connect worker --bootstrap=./bootstrap.ts` |

### Declaring Agents

| PHP / Python | Node.js |
|---|---|
| PHP `#[Agent(key: '...')]` attribute on a class | `@agent({ key: "..." })` decorator on a class |
| PHP `AgentBuilder` fluent chain | `@agent({ key, name, model, instructions: [...] })` decorator options |
| Python `@agent(key="...", model_provider="...", model_name="...")` | `@agent({ key, name, model: "openai:gpt-4o" })` — single `"provider:model"` string |
| Python `Instruction(type="system", position=0, body="...")` dataclass | `{ type: "system", position: 0, body: "..." }` plain object matching `Instruction` interface |

### Declaring Tools

| PHP / Python | Node.js |
|---|---|
| PHP `#[Tool(agentKey: '...', inputSchema: [...])]` + hand-written JSON Schema | `@tool({ key, description })` on class extending `ToolHandler`; `static args = z.object(...)` |
| Python `class Args(BaseModel): id: str = Field(...)` — Pydantic model, schema auto-generated | `static args = z.object({ id: z.string().describe("...") })` — Zod schema, JSON Schema auto-generated |
| Python `async def handle(self, args: Args, ctx: ToolContext)` | `async handle(args: z.infer<typeof MyTool.args>, ctx: ToolContext)` |
| Pydantic `BaseModel` / PHP array schema | Zod schema (`z.object`, `z.string`, `z.number`, etc.) — no separate import needed beyond `zod` |

### Bootstrap File

| PHP | Python | Node.js |
|---|---|---|
| `bootstrap.php` returns a `ConnectorApp` instance | `bootstrap.py` imports modules then `ConnectorApp.create().scan_module(...)` | `bootstrap.ts` imports modules then `export default await ConnectorApp.create().scanModule(import.meta.url)` |
| `Vested\Connect\Sdk` namespace | `vested_connect` package | `@vested-ai/connector-sdk` package |
| PSR-11 container for DI | `__init__` constructor injection | Constructor injection; use Node.js module scope for shared resources |

### Concurrency Model

| PHP | Python | Node.js |
|---|---|---|
| Swoole coroutines (`ext-swoole` required) | asyncio (`async def` handlers) | Node.js event loop (`async` handlers) |
| `Coroutine::defer` for cleanup | `async with` / `asyncio.to_thread()` | `try/finally`; `worker_threads` for CPU-bound work |
| `$pool = new MyPdoPool(size: 8)` | `asyncpg.create_pool(...)` | `pg.Pool` / `knex` pool; keep at module scope |

### Env Vars and CLI

Env var names are identical (`VESTED_CONNECTOR_TOKEN`, `VESTED_CONNECTOR_HUB`). Exit codes are identical (0/78). Reconnect backoff schedule is identical (1 s → 30 s cap, ±20% jitter).

### Items Exclusive to Other SDKs (not applicable to Node.js)

The following are PHP- or Python-specific implementation details. They are documented here only for cross-SDK reference and appear nowhere else in these docs:

- `ext-swoole`, `Swoole\Coroutine::defer`, `PDOProxy` — PHP/Swoole runtime.
- `bootstrap.php` — PHP entry point filename convention.
- `composer require` / Packagist — PHP package manager.
- `pip install` / PyPI — Python package manager.
- Pydantic `BaseModel` / `Field` — Python schema generation.
- `asyncio.to_thread()`, `asyncpg`, `grpcio` — Python-specific async I/O.
- Monolog loop-detection workaround — PHP-specific logging issue.

---

## v0.6.0 Release Notes

### v0.6.0 — a tool can declare the agents it binds to

Tools bind to agents by namespace today: `myns.orders.get` belongs to agent `myns.orders` and nowhere else. Sharing behaviour across agents therefore meant duplicating the handler — a second class in a second namespace wrapping the same logic.

A tool can now name the agents it binds to. ```typescript
@tool({ key: "erp.data.run_sql", description: "…",
        agents: ["erp.data", "erp.retail"] })
```

`agents` is optional on `ToolDecl`, so existing decorator call sites are unaffected.

**Omitting it changes nothing.** A connector that never sets it binds exactly the tools it binds today.

**A present list is authoritative, not additive.** The key's namespace confers nothing once a list is present, so a tool may live in one namespace and be callable only from another. ``"*"`` means every agent this connector declares and cannot be combined with explicit keys.

Refused before the worker dials the hub: an agent key this connector does not declare, ``"*"`` mixed with explicit keys, and a tool that neither matches an agent namespace nor names any agent. Declaring a list that omits the agent named in the tool's own key is legal — it is how you say "lives here, callable from there" — and logs a startup warning.

### v0.6.0 — the baseline fingerprint now covers agent→tool binding

**Behavioural, not source-breaking. Every connector re-registers once.**

`baseline_fingerprint` did not cover which agents a tool was bound to. That was safe only while binding was *derived* from the tool key — you could not change one without changing the other. With an explicit binding field, re-pointing a tool at different agents would have produced an identical fingerprint, and the hub would have short-circuited the registration as unchanged. Nothing would error; the change simply would not happen.

Each agent's canonical entry now carries its bound tool keys, so your connector's fingerprint changes once on upgrade even if you never use the new field. The re-registration produces **no draft** for review unless an agent's actual tool set changed.

### v0.6.0 — two cross-SDK fingerprint divergences fixed

Found while adding the above, and fixed in the same release. .NET, Node and Python canonicalise the same structure and are meant to agree; nothing checked that they did.

- **Sort comparer.** Node used `localeCompare`, .NET a bare `OrderBy` (`Comparer<string>.Default` is `CurrentCulture`), Python ordinal `sorted()`. Measured on realistic agent keys, ordinal and locale disagree on two independent pairs — so keys differing by case, or by `_` against a letter, already hashed differently per SDK. All three are now ordinal.
- **`model_config`.** .NET emitted `null` where Node and Python emit `{}`, which made .NET's fingerprint differ from both for *every* declaration set that has ever existed. .NET now emits `{}`.

Both are pinned by `vested-ai-sdks/testdata/fingerprint-vectors.json`, a shared fixture the three SDKs assert against.

Intended git tag: `v0.6.0` (on the public mirror repo).

---

## v0.4.x Release Notes

### v0.4.0 — ERP identity on ToolContext (L-4)

`ToolContext` gains three ERP/HR identity fields populated from the incoming `ToolCallRequest` (proto fields 10-12):

| Field | Type | Description |
|---|---|---|
| `employeeNo` | `string` | Caller's employee number in the org's ERP/HR system. |
| `erpIdentifier` | `string` | Caller's primary ERP identifier. |
| `erpDepartmentIdentifiers` | `string[]` | ERP identifiers of every department the caller belongs to in this org. |

All three fields are **always present** (never `undefined`). An empty string or empty array means the hub did not supply the value for this call — treat both as "unset".

```typescript
async handle(args: MyArgs, ctx: ToolContext) {
  if (ctx.employeeNo) {
    // use ctx.employeeNo, ctx.erpIdentifier, ctx.erpDepartmentIdentifiers
  }
}
```

**No breaking changes.** Existing tool handlers that ignore `ctx` continue to work unchanged. If your handler type-checks the ctx shape (e.g. via `satisfies ToolContext`), add the three fields or switch to accepting a `ToolContext` type reference, which now includes them.

---

## v0.3.x Release Notes

### v0.3.0 — Connector-declared tool sensitivity (J-5)

`@tool` gains an optional `sensitivity` field that tells the hub how to classify each tool's side-effects.

```typescript
@tool({
  key: "myns.orders.delete",
  description: "Permanently deletes an order.",
  sensitivity: "destructive",
})
class DeleteOrder extends ToolHandler { ... }
```

Allowed values: `"read"`, `"write"`, `"destructive"`, `"external_call"`, `"medium"`. Omitting `sensitivity` (or leaving it empty) is valid — the hub defaults it to `"external_call"`. A non-empty value outside the allowed set throws an `Error` at decoration time (startup), not at runtime.

The value is threaded into the wire `ToolDecl.sensitivity` (proto field 8) and included in the baseline fingerprint, so the hub detects sensitivity changes and re-reconciles without a connector restart.

```typescript
import { TOOL_SENSITIVITIES } from "@vested-ai/connector-sdk";
// readonly tuple: ["read", "write", "destructive", "external_call", "medium"]
```

**No breaking changes.** Existing code that omits `sensitivity` continues to work unchanged.

---

## v0.2.x Release Notes

### v0.2.2 — scanModule recursion + CLI `instanceof` fixes

Two bugs surfaced by the TableTime e2e test customer:

- **`scanModule(import.meta.url)` deadlock.** When `bootstrap.ts` called `scanModule(import.meta.url)` and the bootstrap file lived in the same directory as the agents/tools, the scanner walked its containing directory and re-imported the bootstrap mid-scan. The bootstrap's pending top-level `await scanModule(...)` blocked its own module-evaluation, deadlocking the import graph.

  Fix: `scanModule` now excludes the caller's file from the walk when given a file URL. It also accepts a directory URL (with trailing slash) and walks that directly without the `dirname()` climb.

- **CLI `instanceof ConnectorApp` check fails under tsx.** When the CLI was loaded by Node as plain JS and the bootstrap was loaded through tsx (TypeScript loader), the two ended up with separate references to `ConnectorApp` class — the `instanceof` check rejected a perfectly valid bootstrap.

  Fix: introduced `isConnectorApp(value)` + the global `CONNECTOR_APP_BRAND` symbol (`Symbol.for("vested-ai.connector-sdk.ConnectorApp")`). Brand survives module duplication; the CLI now uses it instead of `instanceof`.

Required upgrade for any customer using `vested-connect worker` under tsx or with the bootstrap-in-same-dir pattern.

### v0.2.0 — Initial Node.js release

First Node.js SDK implementation. Event-loop + `@grpc/grpc-js` runtime. TypeScript-first, ESM modules. Decorator-first API (`@agent`, `@tool`). Zod v3 schema generation via `zod-to-json-schema`. Feature parity with PHP SDK v0.2.4 and Python SDK v0.2.1 on the wire. Available on [npm](https://www.npmjs.com/package/@vested-ai/connector-sdk) (`npm install @vested-ai/connector-sdk`) (coming soon) and [Docker Hub](https://hub.docker.com/r/vestedai/vested-ai-connector-sdk-node) (coming soon).

**Baseline fingerprint**: the Node.js SDK ships with the v0.2.1 fix from day one — `baseline_fingerprint` is always a non-empty SHA-256 over the canonical agent + tool declarations. Symptom of the bug (never applies here): SDK logs "registered with hub" but no agents appear under the connector in the admin UI.

## Next

[Connector protocol overview](protocol/overview.md)
