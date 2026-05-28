import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Dispatcher } from "../../src/runtime/dispatcher.ts";
import { tool, ToolHandler, readToolDeclaration } from "../../src/tool.ts";
import type { ToolDeclaration } from "../../src/tool.ts";
import type { ToolContext } from "../../src/tool.ts";
import type { ConnectorMsg, ToolCallRequest } from "../../src/proto/vested/v1/connector_hub.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

@tool({ key: "test.echo", description: "echo" })
class EchoTool extends ToolHandler {
  static args = z.object({ text: z.string() });
  async handle(args: { text: string }, _ctx: ToolContext) {
    return { echoed: args.text };
  }
}

@tool({ key: "test.slow", description: "slow" })
class SlowTool extends ToolHandler {
  static args = z.object({ ms: z.number() });
  async handle(args: { ms: number }, _ctx: ToolContext): Promise<{ done: boolean }> {
    await new Promise<void>((resolve) => setTimeout(resolve, args.ms));
    return { done: true };
  }
}

@tool({ key: "test.crash", description: "crash" })
class CrashTool extends ToolHandler {
  static args = z.object({ reason: z.string() });
  async handle(args: { reason: string }, _ctx: ToolContext): Promise<never> {
    throw new Error(args.reason);
  }
}

function decl(cls: new () => ToolHandler): ToolDeclaration {
  const d = readToolDeclaration(cls);
  if (!d) throw new Error(`no declaration on ${cls.name}`);
  return d;
}

function makeTools(...ctors: Array<new () => ToolHandler>): Map<string, ToolDeclaration> {
  const m = new Map<string, ToolDeclaration>();
  for (const c of ctors) {
    const d = decl(c);
    m.set(d.key, d);
  }
  return m;
}

function makeReq(
  toolKey: string,
  argsJson: string,
  invocationId = "inv-1",
): ToolCallRequest {
  return {
    invocationId,
    agentKey: "test.agent",
    toolKey,
    argsJson: Buffer.from(argsJson, "utf-8"),
    organizationId: "42",
    userId: "7",
    conversationId: "conv-1",
    deadlineMs: 30_000,
    userEmail: "user@example.com",
  };
}

interface StubClient {
  sent: ConnectorMsg[];
  send(msg: ConnectorMsg): void;
}

function makeClient(): StubClient {
  const sent: ConnectorMsg[] = [];
  return {
    sent,
    send(msg: ConnectorMsg) {
      sent.push(msg);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to drain micro-task queue
// ---------------------------------------------------------------------------
async function flushPromises(): Promise<void> {
  // Yield multiple times to let spawned Promises resolve.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dispatcher", () => {
  it("routes a known tool and replies with result_json", async () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(EchoTool), client);
    dispatcher.dispatch(makeReq("test.echo", '{"text":"hello"}'));
    await flushPromises();

    expect(client.sent).toHaveLength(1);
    const resp = client.sent[0]?.toolCallResponse;
    expect(resp).toBeDefined();
    expect(resp?.invocationId).toBe("inv-1");
    expect(resp?.error).toBeUndefined();
    const body = JSON.parse(Buffer.from(resp!.resultJson!).toString("utf-8")) as {
      echoed: string;
    };
    expect(body.echoed).toBe("hello");
  });

  it("replies with 'unknown tool' for an unknown tool key", async () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(EchoTool), client);
    dispatcher.dispatch(makeReq("test.missing", "{}"));
    await flushPromises();

    expect(client.sent).toHaveLength(1);
    const resp = client.sent[0]?.toolCallResponse;
    expect(resp?.error).toMatch(/unknown tool/);
    expect(resp?.error).toMatch(/test\.missing/);
  });

  it("replies with tool_call_invalid_args for invalid args", async () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(EchoTool), client);
    // Missing required field 'text'
    dispatcher.dispatch(makeReq("test.echo", "{}"));
    await flushPromises();

    expect(client.sent).toHaveLength(1);
    const resp = client.sent[0]?.toolCallResponse;
    expect(resp?.error).toMatch(/tool_call_invalid_args/);
  });

  it("replies with the thrown message when the handler throws", async () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(CrashTool), client);
    dispatcher.dispatch(makeReq("test.crash", '{"reason":"boom"}'));
    await flushPromises();

    expect(client.sent).toHaveLength(1);
    const resp = client.sent[0]?.toolCallResponse;
    expect(resp?.error).toMatch(/boom/);
  });

  it("dispatch() returns synchronously without awaiting the handler", () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(SlowTool), client);

    // SlowTool delays 50 ms; dispatch() must return before the handler finishes.
    const start = Date.now();
    dispatcher.dispatch(makeReq("test.slow", '{"ms":50}'));
    const elapsed = Date.now() - start;

    // The call must return well under 50 ms (allow 20 ms for overhead)
    expect(elapsed).toBeLessThan(20);
    // No response yet
    expect(client.sent).toHaveLength(0);
  });

  it("handles multiple concurrent tool calls without blocking", async () => {
    const client = makeClient();
    const dispatcher = new Dispatcher(makeTools(EchoTool), client);

    dispatcher.dispatch(makeReq("test.echo", '{"text":"a"}', "inv-a"));
    dispatcher.dispatch(makeReq("test.echo", '{"text":"b"}', "inv-b"));
    dispatcher.dispatch(makeReq("test.echo", '{"text":"c"}', "inv-c"));

    await flushPromises();

    expect(client.sent).toHaveLength(3);
    const ids = client.sent.map((m) => m.toolCallResponse?.invocationId).sort();
    expect(ids).toEqual(["inv-a", "inv-b", "inv-c"]);
  });

  it("swallows unexpected errors from _handle without crashing", async () => {
    const client = makeClient();
    // Inject a broken tools map whose .get() throws
    const brokenTools = {
      get: () => {
        throw new Error("internal map explosion");
      },
    } as unknown as Map<string, ToolDeclaration>;

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispatcher = new Dispatcher(brokenTools, client);
    dispatcher.dispatch(makeReq("anything", "{}"));
    await flushPromises();

    // No send because _handle threw before reaching _replyError
    // but the process must not crash — covered by the .catch() in dispatch()
    spy.mockRestore();
  });
});
