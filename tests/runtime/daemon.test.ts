/**
 * Unit tests for Daemon — handshake state and error paths.
 *
 * These tests stub the GrpcClient so no real network connection is made.
 * Port of vested_connect/tests/runtime/test_daemon.py.
 */

import { describe, it, expect } from "vitest";
import type { HubMsg } from "../../src/proto/vested/v1/connector_hub.ts";
import type { ConnectorMsg } from "../../src/proto/vested/v1/connector_hub.ts";
import { TokenError } from "../../src/errors.ts";
import { Daemon } from "../../src/runtime/daemon.ts";
import { SignalHandler } from "../../src/runtime/signals.ts";

// ---------------------------------------------------------------------------
// Minimal stub helpers
// ---------------------------------------------------------------------------

interface AppLike {
  agents: never[];
  tools: Map<string, never>;
}

const emptyApp: AppLike = {
  agents: [],
  tools: new Map(),
};

/** Controllable fake GrpcClient. Preload recv_queue with HubMsg objects. */
class StubClient {
  private _queue: Array<HubMsg | Error>;
  readonly sentMsgs: ConnectorMsg[] = [];

  constructor(recvQueue: Array<HubMsg | Error> = []) {
    this._queue = [...recvQueue];
  }

  send(msg: ConnectorMsg): void {
    this.sentMsgs.push(msg);
  }

  recv(): Promise<HubMsg> {
    const item = this._queue.shift();
    if (item === undefined) {
      return Promise.reject(new Error("stub recv queue exhausted"));
    }
    if (item instanceof Error) {
      return Promise.reject(item);
    }
    return Promise.resolve(item);
  }

  close(): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Daemon handshake state", () => {
  it("handshakeCompleted is false before RegisterAck", async () => {
    // Provide a HelloAck then a rejected RegisterAck — daemon should exit 78
    // but handshakeCompleted must stay false.
    const helloAck: HubMsg = {
      helloAck: {
        connectorId: "c1",
        organizationId: "org",
        namespace: "ns",
        maxAgents: 10,
        maxToolsPerAgent: 50,
        maxConcurrentToolCalls: 5,
      },
    };
    const registerAckRejected: HubMsg = {
      registerAck: {
        baselineFingerprint: "",
        status: "rejected",
        issues: [{ path: "", code: "E", message: "bad token" }],
      },
    };

    const client = new StubClient([helloAck, registerAckRejected]);
    const signals = new SignalHandler();
    const daemon = new Daemon(emptyApp, client as any, signals);

    expect(daemon.handshakeCompleted).toBe(false);
    const code = await daemon.run();
    expect(code).toBe(78);
    expect(daemon.handshakeCompleted).toBe(false);
  });

  it("handshakeCompleted is true after RegisterAck(accepted)", async () => {
    const helloAck: HubMsg = {
      helloAck: {
        connectorId: "c1",
        organizationId: "org",
        namespace: "ns",
        maxAgents: 10,
        maxToolsPerAgent: 50,
        maxConcurrentToolCalls: 5,
      },
    };
    const registerAckOk: HubMsg = {
      registerAck: {
        baselineFingerprint: "",
        status: "accepted",
        issues: [],
      },
    };
    const goAway: HubMsg = {
      goAway: { reason: "shutdown" },
    };

    const client = new StubClient([helloAck, registerAckOk, goAway]);
    const signals = new SignalHandler();
    const daemon = new Daemon(emptyApp, client as any, signals);

    const code = await daemon.run();
    expect(code === 0 || code === 1).toBe(true);
    expect(daemon.handshakeCompleted).toBe(true);
  });
});

describe("Daemon error paths", () => {
  it("returns 78 when recv() raises TokenError (e.g. UNAUTHENTICATED)", async () => {
    const tokenErrorClient = {
      sentMsgs: [] as ConnectorMsg[],
      send(msg: ConnectorMsg) {
        this.sentMsgs.push(msg);
      },
      recv(): Promise<HubMsg> {
        return Promise.reject(new TokenError("UNAUTHENTICATED: bad token"));
      },
      close() {},
    };

    const signals = new SignalHandler();
    const daemon = new Daemon(emptyApp, tokenErrorClient as any, signals);

    const code = await daemon.run();
    expect(code).toBe(78);
  });

  it("returns 1 on unexpected message when HelloAck expected", async () => {
    // Send a GoAway when the daemon expects a HelloAck.
    const unexpected: HubMsg = { goAway: { reason: "shutdown" } };
    const client = new StubClient([unexpected]);
    const signals = new SignalHandler();
    const daemon = new Daemon(emptyApp, client as any, signals);

    const code = await daemon.run();
    expect(code).toBe(1);
  });
});
