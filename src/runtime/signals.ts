/**
 * SIGINT / SIGTERM → boolean flag + Promise.
 *
 * Port of vested_connect/runtime/signals.py.
 */

export class SignalHandler {
  private exitRequested = false;
  private resolver?: () => void;
  private readonly waitPromise: Promise<void>;
  private readonly listeners: Array<{ sig: NodeJS.Signals; handler: () => void }> = [];

  constructor() {
    this.waitPromise = new Promise<void>((resolve) => {
      this.resolver = resolve;
    });
  }

  install(): void {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        if (this.exitRequested) return;
        this.exitRequested = true;
        this.resolver?.();
      };
      process.on(sig, handler);
      this.listeners.push({ sig, handler });
    }
  }

  /**
   * Removes every listener registered by install(). Idempotent.
   */
  uninstall(): void {
    for (const { sig, handler } of this.listeners) {
      process.off(sig, handler);
    }
    this.listeners.length = 0;
  }

  shouldExit(): boolean {
    return this.exitRequested;
  }

  waitForExit(): Promise<void> {
    return this.waitPromise;
  }
}
