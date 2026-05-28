/**
 * One connector session: Hello → HelloAck → Register → RegisterAck → steady-state.
 *
 * Port of vested_connect/runtime/daemon.py.
 *
 * Exit codes:
 *   0  — signal-driven graceful exit
 *   78 — token rejected / register rejected (EX_CONFIG)
 *   1  — any other transient error
 */

import { hostname } from "node:os";
import type { AgentDeclaration } from "../agent.ts";
import { ConnectorError, TokenError } from "../errors.ts";
import type {
  AgentDecl as WireAgentDecl,
  ConnectorMsg,
} from "../proto/vested/v1/connector_hub.ts";
import type { ToolDeclaration } from "../tool.ts";
import { computeFingerprint } from "./fingerprint.ts";
import type { GrpcClient } from "./grpc-client.ts";
import { HeartbeatTimer } from "./heartbeat.ts";
import type { SignalHandler } from "./signals.ts";

export const SDK_VERSION = "0.2.0";

export interface AppLike {
  agents: AgentDeclaration[];
  tools: Map<string, ToolDeclaration>;
}

export class Daemon {
  handshakeCompleted = false;
  private heartbeat?: HeartbeatTimer;

  constructor(
    private readonly app: AppLike,
    private readonly client: GrpcClient,
    private readonly signals: SignalHandler,
  ) {}

  async run(): Promise<number> {
    try {
      // 1. Hello
      const hello: ConnectorMsg = {
        hello: {
          sdkLanguage: "node",
          sdkVersion: SDK_VERSION,
          workerId: `${hostname()}:${process.pid}`,
        },
      };
      this.client.send(hello);

      // 2. HelloAck
      const ackMsg = await this.client.recv();
      if (!ackMsg.helloAck) {
        throw new ConnectorError("expected HelloAck, got something else");
      }
      const ack = ackMsg.helloAck;
      console.info(
        `[vested] connected to hub: connector_id=${ack.connectorId} namespace=${ack.namespace} max_concurrent=${ack.maxConcurrentToolCalls}`,
      );

      // 3. Register
      const registerMsg = this._buildRegister();
      this.client.send(registerMsg);

      // 4. RegisterAck
      const regAckMsg = await this.client.recv();
      if (!regAckMsg.registerAck) {
        throw new ConnectorError("expected RegisterAck");
      }
      if (regAckMsg.registerAck.status !== "accepted") {
        for (const issue of regAckMsg.registerAck.issues) {
          console.error(`[vested] register issue: ${issue.path} [${issue.code}] ${issue.message}`);
        }
        throw new TokenError("register rejected — see logs for issues");
      }
      this.handshakeCompleted = true;
      console.info("[vested] registered with hub");

      // 5. Heartbeat
      this.heartbeat = new HeartbeatTimer(this.client);
      this.heartbeat.start();

      // 6. Steady state
      return await this._steadyState();
    } catch (e) {
      if (e instanceof TokenError) {
        console.error(`[vested] token rejected: ${String(e.message)}`);
        return 78;
      }
      if (e instanceof ConnectorError) {
        console.warn(`[vested] session ended: ${String(e.message)}`);
        return 1;
      }
      throw e;
    } finally {
      this.heartbeat?.stop();
    }
  }

  private async _steadyState(): Promise<number> {
    while (!this.signals.shouldExit()) {
      let msg;
      try {
        msg = await this.client.recv();
      } catch (e) {
        if (e instanceof TokenError) {
          // Surface revocation upward to the catch in run().
          throw e;
        }
        console.info(`[vested] stream closed: ${String(e)}`);
        return 1;
      }

      if (msg.toolCallRequest) {
        // TODO(I-4): dispatcher integration.
        // When Dispatcher lands, call: dispatcher.dispatch(msg.toolCallRequest)
        console.warn(
          `[vested] tool_call_request received but no dispatcher configured (tool=${msg.toolCallRequest.toolKey})`,
        );
      } else if (msg.heartbeatAck) {
        // no-op
      } else if (msg.goAway) {
        const reason = msg.goAway.reason;
        console.warn(`[vested] GoAway from hub: ${reason}`);
        if (reason === "revoked" || reason === "token_revoked") {
          throw new TokenError(`hub revoked stream: ${reason}`);
        }
        // Transient close (e.g. hub deploy). Return 1 so supervisor reconnects.
        return 1;
      }
    }
    return 0;
  }

  private _buildRegister(): ConnectorMsg {
    // CRITICAL: baseline_fingerprint MUST be non-empty — the hub's in-memory
    // store starts at "" so an empty fingerprint short-circuits "accepted"
    // without ever reconciling to Laravel. See runtime/fingerprint.ts.
    const baselineFingerprint = computeFingerprint(
      this.app.agents,
      this.app.tools,
    );

    const agents: WireAgentDecl[] = this.app.agents.map((agentDecl) => {
      const [provider, , modelName] = splitOnFirst(agentDecl.model, ":");

      const namespacePrefix = agentDecl.key + ".";
      const tools = [...this.app.tools.entries()]
        .filter(([key]) => key.startsWith(namespacePrefix))
        .map(([, t]) => ({
          key: t.key,
          name: t.name,
          description: t.description,
          inputSchemaJson: Buffer.from(JSON.stringify(t.inputSchema), "utf-8"),
          outputSchemaJson: Buffer.from(
            JSON.stringify(t.outputSchema ?? {}),
            "utf-8",
          ),
          defaultDeadlineMs: t.defaultDeadlineMs,
          maxResultBytes: t.maxResultBytes,
        }));

      return {
        key: agentDecl.key,
        name: agentDecl.name,
        description: agentDecl.description,
        status: agentDecl.status,
        model: { provider, name: modelName, config: agentDecl.modelConfig },
        instructions: [...agentDecl.instructions]
          .sort((a, b) => a.position - b.position)
          .map((i) => ({
            type: i.type,
            format: i.format ?? "markdown",
            body: i.body,
            position: i.position,
          })),
        tools,
      };
    });

    return {
      register: {
        baselineFingerprint,
        agents,
      },
    };
  }
}

/** Split string at first occurrence of sep. Returns [before, sep, after]. */
function splitOnFirst(s: string, sep: string): [string, string, string] {
  const idx = s.indexOf(sep);
  if (idx === -1) return [s, "", ""];
  return [s.slice(0, idx), sep, s.slice(idx + sep.length)];
}
