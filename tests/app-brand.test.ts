import { describe, it, expect } from "vitest";

import {
  ConnectorApp,
  isConnectorApp,
  CONNECTOR_APP_BRAND,
} from "../src/index.ts";

describe("ConnectorApp brand", () => {
  it("exposes a global Symbol.for brand", () => {
    expect(CONNECTOR_APP_BRAND).toBe(Symbol.for("vested-ai.connector-sdk.ConnectorApp"));
  });

  it("instances carry the brand", () => {
    const app = ConnectorApp.create();
    expect((app as unknown as Record<symbol, true>)[CONNECTOR_APP_BRAND]).toBe(true);
  });

  it("isConnectorApp returns true for a real instance", () => {
    expect(isConnectorApp(ConnectorApp.create())).toBe(true);
  });

  it("isConnectorApp returns false for plain objects + nullish", () => {
    expect(isConnectorApp({})).toBe(false);
    expect(isConnectorApp(null)).toBe(false);
    expect(isConnectorApp(undefined)).toBe(false);
    expect(isConnectorApp("ConnectorApp")).toBe(false);
  });

  it("isConnectorApp recognises a duplicated copy via the global brand", () => {
    // Simulate the dual-module-instance case: a value built by a different
    // copy of the SDK won't `instanceof ConnectorApp` here, but it WILL
    // carry the global Symbol.for brand because Symbol.for is process-wide.
    const fake = {
      [Symbol.for("vested-ai.connector-sdk.ConnectorApp")]: true,
      run: async () => 0,
      agents: [],
      tools: new Map(),
    };
    expect(fake instanceof ConnectorApp).toBe(false);
    expect(isConnectorApp(fake)).toBe(true);
  });

  it("isConnectorApp rejects branded values without a run() method", () => {
    const malformed = {
      [Symbol.for("vested-ai.connector-sdk.ConnectorApp")]: true,
    };
    expect(isConnectorApp(malformed)).toBe(false);
  });
});
