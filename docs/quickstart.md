# Quickstart

Reading time: ~15 minutes. By the end, a connector worker is running locally, registered with the hub, and the agent is visible in the admin UI.

## Prerequisites

- **Node.js 22+**
- **npm** (or another package manager)
- A running Vested AI instance with admin access

## 1. Get a Connector Token

Sign in to the admin UI. Navigate to **Integrations → Add integration**. Fill in:

- **Namespace** — a short identifier for your connector (e.g., `myapp`). All agent and tool keys must start with this namespace.
- **Name** — human-readable label.

Click **Create**. Copy the token shown — it is displayed only once.

## 2. Create a Project

```bash
mkdir my-connector && cd my-connector
npm init -y
npm install @vested-ai/connector-sdk zod
```

Expected directory shape after install:

```
my-connector/
  node_modules/
  package.json
  bootstrap.ts          ← you will create this
  src/
    agents.ts
    tools.ts
```

## 3. Declare Your First Agent and Tool

Create `src/agents.ts`:

```typescript
import { agent } from "@vested-ai/connector-sdk";

@agent({
  key: "myapp.greeting",
  name: "Greeting Agent",
  description: "Says hello",
  model: "openai:gpt-4o",
  instructions: [
    { type: "system", position: 0, body: "You greet users warmly and briefly." },
  ],
})
export class GreetingAgent {}
```

Create `src/tools.ts`:

```typescript
import { tool, ToolHandler, type ToolContext } from "@vested-ai/connector-sdk";
import { z } from "zod";

@tool({
  key: "myapp.greeting.hello",
  name: "Say hello",
  description: "Returns a greeting for the given name.",
})
export class SayHello extends ToolHandler {
  static args = z.object({
    name: z.string().describe("The person's name to greet"),
  });

  static result = z.object({ message: z.string() });

  async handle(args: z.infer<typeof SayHello.args>, _ctx: ToolContext) {
    return { message: `Hello, ${args.name}!` };
  }
}
```

`static args` is a Zod schema. The SDK auto-generates the JSON Schema for the `input_schema_json` field from it. Return any JSON-serializable value; declare `static result` for output schema validation.

## 4. Wire bootstrap.ts

Create `bootstrap.ts` in the project root:

```typescript
import "./src/agents.js";  // registers @agent class
import "./src/tools.js";   // registers @tool class

import { ConnectorApp } from "@vested-ai/connector-sdk";

export default await ConnectorApp.create().scanModule(import.meta.url);
```

`bootstrap.ts` is loaded by the CLI. It must ensure all decorated classes are imported before `ConnectorApp` is built. The decorator registration is side-effectful; importing the module is sufficient. The file must `export default` the `ConnectorApp` instance.

## 5. Run the Worker Locally

```bash
VESTED_CONNECTOR_TOKEN=eyJ… \
VESTED_CONNECTOR_HUB=ai-connect.example.com:4443 \
vested-connect worker --bootstrap=./bootstrap.ts
```

On success:

```
connected to hub  connector_id=42 namespace=myapp max_concurrent=16
```

The worker stays running. Leave it running for step 6.

To use plaintext gRPC against a local dev hub, add `--insecure`.

## 6. Verify in the Admin UI

1. Navigate to **Integrations**. The connector's status badge should read **active** (green).
2. Navigate to **Agents**. The `myapp.greeting` agent should appear with source column showing your connector name.
3. Open the agent detail. The version is auto-published (first registration publishes immediately).
4. Open the **Test** tab on the agent. Invoke the `myapp.greeting.hello` tool with `{"name": "World"}`. The response should be `{"message": "Hello, World!"}`.

## Next

[Concepts](concepts.md)
