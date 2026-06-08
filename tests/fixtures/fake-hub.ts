/**
 * Scriptable in-process gRPC fake hub for integration tests.
 *
 * The ConnectorHub protocol is asymmetric:
 *   - client → hub: ConnectorMsg  (Hello, Register, ToolCallResponse, Heartbeat)
 *   - hub → client: HubMsg        (HelloAck, RegisterAck, ToolCallRequest, GoAway, HeartbeatAck)
 *
 * Usage:
 *   await fakeHub({ toolCalls: [...], finalGoAwayReason: "revoked" }, async (hub, port) => {
 *     const exitCode = await runSupervised(app, "token", "127.0.0.1", port, true);
 *   });
 */

import * as grpc from "@grpc/grpc-js";
import type {
  ConnectorMsg,
  HubMsg,
  Hello,
  Register,
  ToolCallResponse,
} from "../../src/proto/vested/v1/connector_hub.ts";
import { ConnectorHubService } from "../../src/proto/vested/v1/connector_hub.ts";

export interface ToolInvocation {
  toolKey: string;
  argsJson: Buffer;
  expectedInvocationId?: string;
}

export interface FakeHubScript {
  /** default true */
  acceptRegister?: boolean;
  registerRejectReason?: string;
  toolCalls?: ToolInvocation[];
  /** default "shutdown"; set to "" to skip GoAway */
  finalGoAwayReason?: string;
}

export class FakeHub {
  receivedHello?: Hello;
  receivedRegister?: Register;
  receivedToolResponses: ToolCallResponse[] = [];

  constructor(public script: FakeHubScript) {}

  // grpc-js server bidi streaming handler — reads ConnectorMsg, writes HubMsg
  connect(call: grpc.ServerDuplexStream<ConnectorMsg, HubMsg>): void {
    // Drive the async session logic, ending the call when done.
    this._runSession(call).catch((err: unknown) => {
      console.error("[fake-hub] session error:", err);
      call.destroy(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private async _runSession(
    call: grpc.ServerDuplexStream<ConnectorMsg, HubMsg>,
  ): Promise<void> {
    const acceptRegister = this.script.acceptRegister ?? true;
    const toolCalls = this.script.toolCalls ?? [];
    const finalGoAwayReason =
      this.script.finalGoAwayReason !== undefined
        ? this.script.finalGoAwayReason
        : "shutdown";

    // Wrap the call into an async message iterator.
    const msgs = callToAsyncIter(call);

    // Step 1: await Hello → send HelloAck
    for await (const msg of msgs) {
      if (msg.hello) {
        this.receivedHello = msg.hello;
        call.write({
          helloAck: {
            connectorId: "test-connector",
            organizationId: "test-org",
            namespace: "test",
            maxAgents: 10,
            maxToolsPerAgent: 50,
            maxConcurrentToolCalls: 5,
          },
        });
        break;
      }
      // Ignore unexpected messages before Hello
    }

    // Step 2: await Register → send RegisterAck
    for await (const msg of msgs) {
      if (msg.heartbeat) {
        // Daemon may send a heartbeat before Register — absorb it.
        continue;
      }
      if (msg.register) {
        this.receivedRegister = msg.register;
        if (acceptRegister) {
          call.write({
            registerAck: {
              baselineFingerprint: "",
              status: "accepted",
              issues: [],
            },
          });
        } else {
          const reason = this.script.registerRejectReason ?? "rejected by script";
          call.write({
            registerAck: {
              baselineFingerprint: "",
              status: "rejected",
              issues: [{ path: "", code: "TOKEN_ERROR", message: reason }],
            },
          });
          call.end();
          return;
        }
        break;
      }
      // Ignore unexpected messages before Register
    }

    if (!acceptRegister) {
      call.end();
      return;
    }

    // Step 3: issue scripted tool calls, await responses
    for (const invocation of toolCalls) {
      const invId = invocation.expectedInvocationId ?? "inv-1";
      call.write({
        toolCallRequest: {
          invocationId: invId,
          agentKey: "",
          toolKey: invocation.toolKey,
          argsJson: invocation.argsJson,
          organizationId: "",
          userId: "",
          conversationId: "",
          deadlineMs: 30000,
          userEmail: "",
          employeeNo: "",
          erpIdentifier: "",
          erpDepartmentIdentifiers: [],
        },
      });

      // Await matching ToolCallResponse (absorb heartbeats in between)
      let responseReceived = false;
      for await (const msg of msgs) {
        if (msg.heartbeat) {
          call.write({ heartbeatAck: { at: undefined } });
          continue;
        }
        if (msg.toolCallResponse) {
          this.receivedToolResponses.push(msg.toolCallResponse);
          responseReceived = true;
          break;
        }
      }
      if (!responseReceived) {
        // Stream ended before response arrived
        return;
      }
    }

    // Step 4: send GoAway if specified
    if (finalGoAwayReason !== "") {
      call.write({ goAway: { reason: finalGoAwayReason } });
    }

    call.end();
  }
}

/**
 * Convert a grpc-js ServerDuplexStream into an async iterator of ConnectorMsg.
 * The iterator ends when the stream emits 'end' or 'error'.
 */
function callToAsyncIter(
  call: grpc.ServerDuplexStream<ConnectorMsg, HubMsg>,
): AsyncIterable<ConnectorMsg> {
  const queue: ConnectorMsg[] = [];
  const waiters: Array<(value: IteratorResult<ConnectorMsg>) => void> = [];
  let done = false;

  call.on("data", (msg: ConnectorMsg) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: msg, done: false });
    } else {
      queue.push(msg);
    }
  });

  const finish = (_err?: unknown) => {
    done = true;
    let waiter = waiters.shift();
    while (waiter) {
      waiter({ value: undefined as unknown as ConnectorMsg, done: true });
      waiter = waiters.shift();
    }
  };

  call.on("end", () => finish());
  call.on("error", (err: unknown) => finish(err));

  return {
    [Symbol.asyncIterator](): AsyncIterator<ConnectorMsg> {
      return {
        next(): Promise<IteratorResult<ConnectorMsg>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined as unknown as ConnectorMsg, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
      };
    },
  };
}

/**
 * Start an in-process gRPC server on a random port, run `body`, then shut down.
 */
export async function fakeHub<T>(
  script: FakeHubScript,
  body: (hub: FakeHub, port: number) => Promise<T>,
): Promise<T> {
  const hub = new FakeHub(script);
  const server = new grpc.Server();

  server.addService(ConnectorHubService, {
    connect: hub.connect.bind(hub),
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) reject(err);
        else resolve(boundPort);
      },
    );
  });

  try {
    return await body(hub, port);
  } finally {
    await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  }
}
