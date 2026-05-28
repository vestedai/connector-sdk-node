/**
 * Bidi gRPC client for ConnectorHub.Connect.
 *
 * Port of vested_connect/runtime/grpc_client.py.
 *
 * The ts-proto codegen (outputServices=grpc-js) emits:
 *
 *   ConnectorHubClient.connect(metadata?, options?): ClientDuplexStream<ConnectorMsg, HubMsg>
 *
 * The stream is a Node.js Duplex — we write ConnectorMsg objects to the
 * writable side and read HubMsg objects from the readable side via async
 * iteration. Errors emitted by the stream surface as rejections from the
 * async iterator and are caught in recv().
 */

import * as grpc from "@grpc/grpc-js";
import type { ConnectorMsg, HubMsg } from "../proto/vested/v1/connector_hub.ts";
import { ConnectorHubClient as GrpcConnectorHubClient } from "../proto/vested/v1/connector_hub.ts";
import { ConnectorError, TokenError } from "../errors.ts";

export class GrpcClient {
  private stream?: grpc.ClientDuplexStream<ConnectorMsg, HubMsg>;
  private readonly inboundQueue: HubMsg[] = [];
  private readonly inboundResolvers: Array<{
    resolve: (msg: HubMsg) => void;
    reject: (err: unknown) => void;
  }> = [];
  private streamError: unknown = undefined;
  private streamEnded = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly token: string,
    private readonly insecure: boolean,
  ) {}

  async connect(): Promise<void> {
    const creds = this.insecure
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl();
    const client = new GrpcConnectorHubClient(`${this.host}:${this.port}`, creds);
    const metadata = new grpc.Metadata();
    metadata.set("x-connector-token", this.token);
    this.stream = client.connect(metadata);

    this.stream.on("data", (msg: HubMsg) => {
      const waiter = this.inboundResolvers.shift();
      if (waiter) {
        waiter.resolve(msg);
      } else {
        this.inboundQueue.push(msg);
      }
    });

    this.stream.on("error", (err: grpc.ServiceError) => {
      const wrapped =
        err.code === grpc.status.UNAUTHENTICATED
          ? new TokenError(err.details || "unauthenticated")
          : new ConnectorError(`stream error: ${err.details ?? String(err)}`);
      this.streamError = wrapped;
      // Drain any pending recv() waiters with the error.
      let waiter = this.inboundResolvers.shift();
      while (waiter) {
        waiter.reject(wrapped);
        waiter = this.inboundResolvers.shift();
      }
    });

    this.stream.on("end", () => {
      this.streamEnded = true;
      const closed = new ConnectorError("stream closed by hub");
      let waiter = this.inboundResolvers.shift();
      while (waiter) {
        waiter.reject(closed);
        waiter = this.inboundResolvers.shift();
      }
    });
  }

  send(msg: ConnectorMsg): void {
    if (!this.stream) {
      throw new ConnectorError("stream not opened");
    }
    this.stream.write(msg);
  }

  recv(): Promise<HubMsg> {
    // If there's already a queued message, return it immediately.
    if (this.inboundQueue.length > 0) {
      return Promise.resolve(this.inboundQueue.shift()!);
    }
    // Propagate any already-known error or end-of-stream.
    if (this.streamError !== undefined) {
      return Promise.reject(this.streamError);
    }
    if (this.streamEnded) {
      return Promise.reject(new ConnectorError("stream closed by hub"));
    }
    // Park a resolver waiting for the next message.
    return new Promise<HubMsg>((resolve, reject) => {
      this.inboundResolvers.push({ resolve, reject });
    });
  }

  close(): void {
    this.stream?.end();
  }
}
