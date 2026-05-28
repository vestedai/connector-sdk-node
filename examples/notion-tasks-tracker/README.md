# Notion-tasks connector walkthrough

Build a vested-ai connector for a generic task tracker (Notion / Linear / Jira
style). Two agents, three tools, deployed as a Docker worker. Builds on
[quickstart](../../docs/quickstart.md).

---

## What this example demonstrates

- `tasks.ops` agent — finds tasks and updates their status via a REST API
- `tasks.analytics` agent — answers workload and throughput questions
- Native `fetch` (Node 22+) against a generic task tracker REST API —
  no third-party HTTP library required
- In-memory workload aggregation: `workload_summary` fetches tasks and
  aggregates counts locally, so no analytics database is needed
- Class-based `@agent` / `@tool` decorators — all wired by a single
  `scanModule(import.meta.url)` call in `bootstrap.ts`

---

## Prerequisites

- Node.js 22+ (native `fetch` and `--import` flag required)
- A task tracker REST API with a bearer token (Notion, Linear, Jira, or any
  custom system that follows the schema described in _Each tool in detail_)
- A vested-ai connector token — see
  [quickstart §1](../../docs/quickstart.md#1-get-a-connector-token)
- Docker (for the containerised run)

---

## Layout

```
notion-tasks-tracker/
├── bootstrap.ts               # ConnectorApp.create().scanModule(...).build()
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
└── src/
    ├── client.ts              # Thin fetch wrapper; Bearer auth + typed errors
    ├── agents.ts              # @agent declarations (tasks.ops + tasks.analytics)
    └── tools.ts               # @tool handler classes (3 tools)
```

`scanModule(import.meta.url)` walks the directory containing `bootstrap.ts`,
imports every `.ts` / `.js` file, and collects every class decorated with
`@agent` or `@tool`. Agents and tools are defined in separate files purely for
readability — the scanner picks them up regardless of how they are laid out.

---

## Step-by-step

### 1. Install

```bash
cd vested-ai-sdks/node/examples/notion-tasks-tracker
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
$EDITOR .env
```

| Variable | Description |
|---|---|
| `VESTED_CONNECTOR_TOKEN` | Your vested-ai connector token (`ct_…`) |
| `VESTED_CONNECTOR_HUB` | Hub address, e.g. `hub.vested.ai:4443` |
| `TASK_TRACKER_API_BASE_URL` | Base URL of your task tracker API, e.g. `https://api.linear.app/v1` |
| `TASK_TRACKER_API_TOKEN` | Bearer token for the task tracker API |
| `LOG_LEVEL` | `info` (default) or `debug` |

### 3. Run the worker — development (tsx)

`tsx` transpiles TypeScript on the fly so you can run `bootstrap.ts` directly
without a build step:

```bash
source .env   # or use dotenv / direnv

node --import tsx/esm \
  node_modules/.bin/vested-connect \
  worker \
  --bootstrap=./bootstrap.ts
```

Expected startup output:

```
[vested] Connected to hub hub.vested.ai:4443
[vested] Registered agent tasks.ops (2 tools)
[vested] Registered agent tasks.analytics (1 tool)
[vested] Worker ready
```

Set `LOG_LEVEL=debug` to see per-request timings for every API call.

### 4. Run the worker — production (tsc + node)

For production images, compile first and run the compiled output:

```bash
npm run build           # emits dist/

node \
  node_modules/.bin/vested-connect \
  worker \
  --bootstrap=./dist/bootstrap.js
```

The Dockerfile uses this path — see [Docker](#docker).

### 5. Verify in the admin UI

1. Open the vested-ai admin UI → **Connectors**.
2. Both agents (`tasks.ops` and `tasks.analytics`) appear with a green status
   pill.
3. Open the **Test** tab on `tasks.ops`.
4. Run `{"query": "login page", "limit": 5}` on `search_tasks` — a list of
   matching tasks should appear within a few seconds.
5. Run `{"task_id": "TASK-42", "new_status": "done"}` on `update_task_status`.
6. Switch to `tasks.analytics` and run `{"days": 7}` on `workload_summary`.

---

## Each tool in detail

### `tasks.ops.search_tasks`

Searches tasks by a text query against the task tracker REST API.

**Args**

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | `string` | — | Text matched against title and description |
| `status` | `"todo" \| "in_progress" \| "done" \| "blocked"` | _(any)_ | Optional status filter |
| `limit` | `number` | `10` | Max tasks to return (1–50) |

**Result** — `{ tasks: Task[] }`

Each `Task` has: `id`, `title`, `status`, `assignee` (nullable), `due_date` (nullable).

**API call**

```
GET {TASK_TRACKER_API_BASE_URL}/tasks?q={query}&status={status}&limit={limit}
Authorization: Bearer {TASK_TRACKER_API_TOKEN}
```

---

### `tasks.ops.update_task_status`

Updates the status of a single task and returns both the previous and new status.
Throws `ToolValidationError` if the task ID does not exist (HTTP 404).

**Args**

| Field | Type | Description |
|---|---|---|
| `task_id` | `string` | Numeric or alphanumeric task ID (e.g. `"TASK-42"`) |
| `new_status` | `"todo" \| "in_progress" \| "done" \| "blocked"` | Target status |

**Result**

| Field | Type |
|---|---|
| `task_id` | `string` |
| `previous_status` | `string` |
| `new_status` | `string` |

**API calls**

1. `GET {base}/tasks/{task_id}` — fetch current status (verifies existence)
2. `PATCH {base}/tasks/{task_id}` with `{ "status": "{new_status}" }`

---

### `tasks.analytics.workload_summary`

Fetches tasks for the specified window and assembles an in-memory summary —
no analytics database needed.

**Args**

| Field | Type | Default | Description |
|---|---|---|---|
| `assignee` | `string` | _(all)_ | Filter to one assignee. Omit for whole-team summary |
| `days` | `number` | `30` | Lookback window in days (1–365) |

**Result**

| Field | Type |
|---|---|
| `window_days` | `number` |
| `assignee` | `string \| null` |
| `counts_by_status` | `Record<string, number>` |
| `total_open` | `number` — sum of `todo + in_progress + blocked` |
| `total_completed_in_window` | `number` — count with status `"done"` |

**API call**

```
GET {base}/tasks?assignee={assignee}&window_days={days}&limit=500
```

Counts are computed locally from the returned task list.

---

## Docker

### Build and run

```bash
# from the notion-tasks-tracker/ directory
docker build -t tasks-connector .

docker run --rm \
  --env-file .env \
  tasks-connector
```

### What the image contains

The Dockerfile is a two-stage build. The `build` stage compiles TypeScript via
`npm run build`. The `runtime` stage copies only the compiled `dist/` directory
and production dependencies, runs as a non-root user (`uid 1000`), and starts
the worker:

```dockerfile
ENTRYPOINT ["npx", "vested-connect"]
CMD ["worker", "--bootstrap=/app/dist/bootstrap.js"]
```

To pin the SDK version, update `@vested-ai/connector-sdk` in `package.json`
before building the image.

---

## Customizing

### Adding a new tool

1. Add a new `@tool`-decorated class to `src/tools.ts` (or a new file under
   `src/`).
2. Prefix the tool key with the agent key it should be scoped to:
   ```ts
   @tool({ key: "tasks.ops.assign_task", description: "Reassign a task." })
   export class AssignTask extends ToolHandler { ... }
   ```
3. Restart the worker — the new tool appears in the admin UI automatically.

The `@tool` key prefix determines which agent receives the tool. A tool keyed
`tasks.ops.assign_task` is automatically attached to the `tasks.ops` agent.

### Scoping a tool to multiple agents

The SDK matches tools to agents by key prefix. To make the same logic available
under two agents, register it as two separate `@tool` classes that share a
common helper function:

```ts
async function summarise(args: SummaryArgs): Promise<SummaryResult> { ... }

@tool({ key: "tasks.ops.summary", description: "..." })
export class OpsSummary extends ToolHandler {
  static args = SummaryArgsSchema;
  async handle(args, ctx) { return summarise(args); }
}

@tool({ key: "tasks.analytics.summary", description: "..." })
export class AnalyticsSummary extends ToolHandler {
  static args = SummaryArgsSchema;
  async handle(args, ctx) { return summarise(args); }
}
```

### Adding a new agent

```ts
// src/agents.ts
@agent({
  key: "tasks.planning",
  name: "Tasks Planning",
  model: "openai:gpt-4o",
  description: "Helps plan sprints and estimate workload.",
  instructions: [
    { type: "system", position: 0, body: "You assist with sprint planning..." },
  ],
})
export class TasksPlanningAgent {}
```

Prefix any new tools with `tasks.planning.<tool_name>` and they will be
automatically scoped to the new agent.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `VESTED_CONNECTOR_TOKEN invalid` | Token revoked or miscopied | Re-issue in the admin UI |
| `TASK_TRACKER_API_BASE_URL is required` | Env var missing | Check `.env` or shell export |
| `TaskAuthError: … 401` | API token expired or wrong scope | Regenerate in your task tracker |
| `ToolValidationError: Task X not found` | Task ID does not exist | Verify the ID |
| Worker exits immediately (code 78) | `VESTED_CONNECTOR_TOKEN` or `VESTED_CONNECTOR_HUB` unset | Check env vars |
