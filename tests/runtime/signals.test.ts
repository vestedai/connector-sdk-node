import { describe, it, expect } from "vitest";
import { SignalHandler } from "../../src/runtime/signals.ts";

describe("SignalHandler", () => {
  it("shouldExit() is false before any signal", () => {
    const s = new SignalHandler();
    expect(s.shouldExit()).toBe(false);
    // No install — just checking initial state.
  });

  it("SIGTERM flips shouldExit() to true and resolves waitForExit()", async () => {
    const s = new SignalHandler();
    s.install();
    try {
      expect(s.shouldExit()).toBe(false);
      process.emit("SIGTERM");
      expect(s.shouldExit()).toBe(true);
      // waitForExit() should already be resolved.
      await expect(s.waitForExit()).resolves.toBeUndefined();
    } finally {
      s.uninstall();
    }
  });

  it("uninstall() removes all listeners", () => {
    const s = new SignalHandler();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    s.install();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm + 1);

    s.uninstall();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("uninstall() is idempotent", () => {
    const s = new SignalHandler();
    s.install();
    const countAfterInstall = process.listenerCount("SIGINT");
    s.uninstall();
    s.uninstall(); // second call should not throw
    expect(process.listenerCount("SIGINT")).toBe(countAfterInstall - 1);
  });
});
