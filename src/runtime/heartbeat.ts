/**
 * Periodic Heartbeat sender.
 *
 * Port of vested_connect/runtime/heartbeat.py.
 * Default interval mirrors the PHP SDK's 20 000 ms.
 */

import type { ConnectorMsg } from "../proto/vested/v1/connector_hub.ts";
import type { GrpcClient } from "./grpc-client.ts";

export class HeartbeatTimer {
  private timer: NodeJS.Timeout | undefined = undefined;

  /**
   * @param intervalMs  How often to send a heartbeat (default: 20 000 ms).
   * @param client      GrpcClient — duck-typed: needs only send(ConnectorMsg).
   */
  constructor(
    private readonly client: Pick<GrpcClient, "send">,
    private readonly intervalMs: number = 20_000,
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      const msg: ConnectorMsg = { heartbeat: { at: new Date() } };
      try {
        this.client.send(msg);
      } catch {
        // Swallow — daemon will detect stream death on next recv().
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
