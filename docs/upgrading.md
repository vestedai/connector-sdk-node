# Upgrading

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

## v0.2.0 Release Notes

### v0.2.0 — Initial Node.js release

First Node.js SDK implementation. Event-loop + `@grpc/grpc-js` runtime. TypeScript-first, ESM modules. Decorator-first API (`@agent`, `@tool`). Zod v3 schema generation via `zod-to-json-schema`. Feature parity with PHP SDK v0.2.4 and Python SDK v0.2.1 on the wire. Available on [npm](https://www.npmjs.com/package/@vested-ai/connector-sdk) (`npm install @vested-ai/connector-sdk`) (coming soon) and [Docker Hub](https://hub.docker.com/r/vestedai/vested-ai-connector-sdk-node) (coming soon).

**Baseline fingerprint**: the Node.js SDK ships with the v0.2.1 fix from day one — `baseline_fingerprint` is always a non-empty SHA-256 over the canonical agent + tool declarations. Symptom of the bug (never applies here): SDK logs "registered with hub" but no agents appear under the connector in the admin UI.

## Next

[Connector protocol overview](protocol/overview.md)
