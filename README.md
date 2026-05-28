# @vested-ai/connector-sdk

![Build](https://img.shields.io/github/actions/workflow/status/vestedai/connector-sdk-node/ci.yml?branch=main)
![npm](https://img.shields.io/npm/v/@vested-ai/connector-sdk)
![License](https://img.shields.io/github/license/vestedai/connector-sdk-node)
![Node](https://img.shields.io/badge/node-%3E%3D22-green)

Connect any Node.js service to the Vested AI platform. The SDK opens a long-lived gRPC stream to the hub, declares agents and tools over that stream, and dispatches tool calls to your handler code — no polling, no webhook setup, no managing your own LLM client. The hub handles model selection, prompt composition, and conversation state; your connector owns the business logic.

## Install

```bash
npm install @vested-ai/connector-sdk
```

Requires Node.js >= 22. Or run the Docker image: `vestedai/vested-ai-connector-sdk-node:0.2.0` (also `:latest`, multi-arch amd64/arm64).

## 5-Line Connector

```typescript
import { agent, tool, ToolHandler, ConnectorApp } from "@vested-ai/connector-sdk";
import { z } from "zod";

@agent({ key: "myapp.orders", name: "Orders", model: "openai:gpt-4o",
         instructions: [{ type: "system", position: 0, body: "You help users look up their orders." }] })
class OrdersAgent {}

@tool({ key: "myapp.orders.get", description: "Returns an order by ID." })
class GetOrder extends ToolHandler {
  static args = z.object({ id: z.string().describe("Order ID") });
  async handle(args: z.infer<typeof GetOrder.args>) {
    return { status: "shipped" }; // replace with a real lookup
  }
}

export default await ConnectorApp.create().scanModule(import.meta.url).build();
```

Then run:

```bash
VESTED_CONNECTOR_TOKEN=eyJ… \
VESTED_CONNECTOR_HUB=hub.example.com:4443 \
vested-connect worker --bootstrap=./bootstrap.ts
```

## What This Is

A **connector** is a long-lived worker process that registers one or more agents with the Vested AI hub. Each agent carries a model selection, a set of instruction blocks, and a set of tool definitions. Admins can override instruction bodies and disable tools in the admin UI; the connector's declared baseline is the floor that overrides are layered on top of. The hub routes LLM tool calls back to the connector over the same stream; the connector dispatches them to your handler code and returns results.

This differs from writing your own LLM client. The connector does not call the LLM directly. It registers capability and responds to callbacks. Prompt composition, model routing, conversation history, streaming to end users — all of that lives in the hub. The connector's surface area is: "declare what agents exist, implement what the tools do."

## Documentation

| Document | What's in it |
|---|---|
| [Quickstart](docs/quickstart.md) | Install, write your first agent + tool, run the worker, verify in the admin UI |
| [Concepts](docs/concepts.md) | Agents, tools, instructions, baselines vs overrides, inheritance state machine, reconciliation |
| [API reference](docs/api.md) | `ConnectorApp`, `@agent`, `@tool`, `ToolHandler`, `ToolContext` |
| [Operations](docs/operations.md) | Docker, env vars, observability, reconnect supervisor, Node.js async notes, gotchas |
| [Upgrading](docs/upgrading.md) | Coming from the PHP or Python SDK; v0.2.0 release notes |
| [Doc index](docs/README.md) | Full table of contents including protocol reference |

## License + Status

MIT. Current release: **v0.2.0** (TypeScript-first, ESM, decorator API, Zod schemas, `@grpc/grpc-js` transport). On [npm](https://www.npmjs.com/package/@vested-ai/connector-sdk) (`npm install @vested-ai/connector-sdk`) (coming soon) and [Docker Hub](https://hub.docker.com/r/vestedai/vested-ai-connector-sdk-node) (coming soon).
