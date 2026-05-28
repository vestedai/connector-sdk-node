# Operations

## Docker

A minimal customer Dockerfile:

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY bootstrap.js .
COPY src ./src
COPY dist ./dist

ENTRYPOINT ["node", "dist/cli.js", "worker", "--bootstrap=/app/bootstrap.js"]
```

The entrypoint reads `VESTED_CONNECTOR_TOKEN` and `VESTED_CONNECTOR_HUB` from the environment.

Run as a single long-lived container (`replicas: 1` per token in Kubernetes). Graceful shutdown on SIGTERM: in-flight tool calls drain up to their remaining `deadlineMs` before the process exits.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VESTED_CONNECTOR_TOKEN` | Yes | — | JWT from the admin UI (Integrations → Add). Use `--token-stdin` for secrets management. |
| `VESTED_CONNECTOR_HUB` | Yes | — | Hub address as `host:port`, e.g. `ai-connect.example.com:4443`. |
| `LOG_LEVEL` | No | `INFO` | Log level: `DEBUG`, `INFO`, `WARNING`, `ERROR`. Read in `bootstrap.ts`; the SDK does not read this variable directly. |

For secrets management, `--token-stdin` lets you pipe the token from any credential provider:

```bash
# systemd credential
cat "$CREDENTIALS_DIRECTORY/vested-token" | vested-connect worker --bootstrap=./bootstrap.js --token-stdin

# Vault / AWS SSM / SOPS — same pattern
vault kv get -field=token secret/vested | vested-connect worker --bootstrap=./bootstrap.js --token-stdin
```

---

## Observability

**Structured log fields** present on every log line emitted by the SDK:

| Field | Present on |
|---|---|
| `connector_id` | All lines after HelloAck |
| `invocation_id` | Tool-call lines |
| `agent_key` | Tool-call lines |
| `tool_key` | Tool-call lines |
| `duration_ms` | Tool-call completion |

Log output defaults to a structured console format. Plug in any logger via `.withLogger()`.

**Key log events by level:**

- `INFO` — `connected to hub` (with `connector_id`, `namespace`, `max_concurrent`); `stream closed`; `drain complete`; `shutdown requested`
- `WARNING` — `hub session ended, reconnecting` (with `delay_ms`, `handshake_completed`, `last_exit`); `GoAway from hub`
- `ERROR` — `token rejected`; `register issue`; `session ended` (with error class + message)

**Heartbeat**: the SDK sends a `Heartbeat` frame every 20 seconds. The hub replies with `HeartbeatAck`. No heartbeat acknowledgement within the idle-timeout window (30 s) causes the hub to send `GoAway{idle}`.

---

## Reconnect + Supervisor

`ConnectorApp.run()` embeds a supervisor loop. The lifecycle is:

```
supervisor loop
  └── new session
        ├── open gRPC stream
        ├── Hello/HelloAck
        ├── Register/RegisterAck  ← handshake_completed = true
        ├── steady-state (tool calls + heartbeats)
        └── disconnect / GoAway / error
              ↓
        if signal: exit 0
        if token rejected: exit 78 (EX_CONFIG)
        if handshake completed: reset backoff
        sleep(backoff.next())
        → new session
```

**Backoff schedule**: 1 s → 2 s → 4 s → 8 s → 16 s → 30 s (cap). Each interval has ±20% random jitter. A session that completed handshake before disconnecting resets the backoff to 1 s — hub deploys and node maintenance cause fast reconnect.

SIGTERM during the inter-attempt sleep is caught immediately via `process.on('SIGTERM', ...)` installed at the supervisor level.

Token rotation sends `GoAway{token_rotated}` on the active stream. The process exits with code 78. Redeploy with the new token; the supervisor does not retry on exit 78.

---

## Signal Handling

The supervisor installs handlers for `SIGTERM` and `SIGINT` (Ctrl-C) at startup. On signal receipt:

1. In-flight tool calls are allowed to complete up to their remaining `deadlineMs`.
2. The gRPC stream is half-closed.
3. The process exits with code `0`.

Do not install competing signal handlers in `bootstrap.ts`. If your application needs signal hooks, register them before calling `ConnectorApp.run()` and chain to the existing handlers.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Clean shutdown (SIGTERM, SIGINT, or hub GoAway that is not terminal). |
| `78` | Token rejected (`EX_CONFIG`). A configuration change (new token) is required before retry. |

All other non-zero exit codes indicate an unexpected error. Process managers should restart on non-78 exits.

---

## Node.js Async Notes

The SDK runs the supervisor in the Node.js event loop. Tool handlers are `async`; they share the loop with the gRPC stream reader. Follow these rules to avoid blocking the event loop:

- **Never use blocking I/O** (`fs.readFileSync`, synchronous `pg` drivers, etc.) directly in a handler. Use async alternatives or wrap in a worker thread.
- **Database connections**: use async connection pools (e.g. `pg`, `knex`, `drizzle`). A shared synchronous connection will serialize all queries.
- **CPU-bound work**: offload to `worker_threads` so it does not block heartbeats.

```typescript
@tool({ key: "myns.data.fetch", description: "Fetches remote data." })
class FetchData extends ToolHandler {
  static args = z.object({ url: z.string() });

  async handle(args: z.infer<typeof FetchData.args>, _ctx: ToolContext) {
    const resp = await fetch(args.url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { body: await resp.text() };
  }
}
```

Node 22+ ships native `fetch`; no extra dependency needed.

---

## Deployment Recipes

**Kubernetes** — set `replicas: 1` per connector token; set `VESTED_CONNECTOR_TOKEN` from a Secret; set `terminationGracePeriodSeconds: 45` (longer than the 30 s drain window).

**systemd** — pipe the token via `--token-stdin` from `$CREDENTIALS_DIRECTORY`; set `Restart=on-failure` and `RestartSec=5`.

---

## Troubleshooting

**`connector_unavailable`**
The tool dispatch arrived while the connector was disconnected. Check `hub session ended, reconnecting` in the connector logs. Verify the supervisor is running and not stuck on exit 78.

**`tool_call_timeout`**
A tool handler exceeded `deadlineMs`. Either increase `defaultDeadlineMs` in `@tool(...)`, or speed up the handler (add timeouts to outbound fetch calls, cache expensive lookups, etc.).

**`tool_call_invalid_result`**
The handler returned data that does not conform to the declared output schema. Check that the return value matches your `static result` Zod schema.

## Next

[Upgrading](upgrading.md)
