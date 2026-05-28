# @vested-ai/connector-sdk

The official Node.js SDK for the **Vested AI ConnectorHub**. Build AI agent connectors in TypeScript using class decorators and Zod schemas — register your agents and tools, then let the SDK handle the gRPC wire protocol, reconnect supervision, and heartbeating.

## Install

```bash
npm install @vested-ai/connector-sdk
```

Requires Node.js >= 22.

## Quick start

```typescript
import { agent, tool, ToolHandler, ConnectorApp } from "@vested-ai/connector-sdk";
import { z } from "zod";

@agent({ key: "my.agent", name: "My Agent", model: "openai:gpt-4o" })
class MyAgent {}

@tool({ key: "my.agent.greet", description: "Greet the user." })
class GreetTool extends ToolHandler {
  static args = z.object({ name: z.string() });
  async handle(args: z.infer<typeof GreetTool.args>) {
    return { message: `Hello, ${args.name}!` };
  }
}

export default ConnectorApp.create().build();
```

Then run:

```bash
vested-connect worker --bootstrap=./bootstrap.ts --hub-addr=hub.vested.ai:4443
```

## Documentation

Full documentation is at [docs/quickstart.md](docs/quickstart.md).
