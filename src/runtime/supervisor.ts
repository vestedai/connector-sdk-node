/**
 * Outer reconnect loop around Daemon.
 *
 * Port of vested_connect/runtime/supervisor.py.
 *
 * Exits only on:
 *   0  — SIGINT / SIGTERM
 *   78 — TokenError (permanent config failure)
 *
 * CRITICAL: do NOT exit on exitCode === 0 from the daemon — that was the
 * Python v0.2.0 bug. Code 0 from the daemon means the signal was already
 * set; the outer loop's shouldExit() check handles the actual exit.
 */

import { Backoff } from "./backoff.ts";
import { Daemon, type AppLike } from "./daemon.ts";
import { GrpcClient } from "./grpc-client.ts";
import { SignalHandler } from "./signals.ts";
import { TokenError } from "../errors.ts";

export async function runSupervised(
  app: AppLike,
  token: string,
  host: string,
  port: number,
  insecure: boolean = false,
): Promise<number> {
  const signals = new SignalHandler();
  signals.install();
  const backoff = new Backoff();

  try {
    while (!signals.shouldExit()) {
      let handshakeCompleted = false;
      let exitCode = 1;

      try {
        const client = new GrpcClient(host, port, token, insecure);
        await client.connect();
        try {
          const daemon = new Daemon(app, client, signals);
          exitCode = await daemon.run();
          handshakeCompleted = daemon.handshakeCompleted;
        } finally {
          client.close();
        }
      } catch (e) {
        if (e instanceof TokenError) {
          console.error(`[vested] token rejected: ${String(e.message)}`);
          return 78;
        }
        console.warn(`[vested] session ended with exception: ${String(e)}`);
      }

      if (signals.shouldExit()) return 0;
      if (exitCode === 78) return 78;

      // NB: do NOT return on exitCode === 0 — that's the Python v0.2.0 bug.
      // exitCode 0 from the daemon means it exited because shouldExit()
      // returned true; the outer while condition will catch it next iteration.

      if (handshakeCompleted) {
        backoff.reset();
      }
      const delayMs = backoff.next();
      console.warn(
        `[vested] hub session ended, reconnecting in ${delayMs}ms (handshake=${handshakeCompleted}, exit=${exitCode})`,
      );

      // Race the backoff sleep against a signal so SIGTERM during sleep is caught.
      await Promise.race([
        new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
        signals.waitForExit(),
      ]);

      if (signals.shouldExit()) return 0;
    }
    return 0;
  } finally {
    signals.uninstall();
  }
}
