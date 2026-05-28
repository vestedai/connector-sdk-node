/**
 * Integration tests: full daemon session against the in-process fake hub.
 *
 * Covers:
 *   - Roundtrip: Hello → HelloAck → Register → RegisterAck(accepted) →
 *     ToolCallRequest → ToolCallResponse → GoAway("revoked") → exit 78.
 *   - Register rejected → exit 78.
 *   - GoAway("revoked") with no prior tool calls → exit 78.
 */

import { describe, it, expect } from "vitest";

import { ConnectorApp } from "../../src/app.ts";
import { runSupervised } from "../../src/runtime/supervisor.ts";
import { fakeHub } from "../fixtures/fake-hub.ts";

// Trailing slash → directory URL. v0.2.2 scanner walks the dir contents
// without skipping any "caller" file.
const INTEGRATION_APP_URL = new URL("../fixtures/integration_app/", import.meta.url).href;

async function buildApp(): Promise<ConnectorApp> {
  const app = ConnectorApp.create();
  await app.scanModule(INTEGRATION_APP_URL);
  return app;
}

describe("fake-hub integration", { timeout: 10000 }, () => {
  it("roundtrips a tool call", async () => {
    const app = await buildApp();
    await fakeHub(
      {
        acceptRegister: true,
        toolCalls: [
          {
            toolKey: "t.test.echo",
            argsJson: Buffer.from(JSON.stringify({ text: "hi" }), "utf-8"),
            expectedInvocationId: "inv-1",
          },
        ],
        finalGoAwayReason: "revoked",
      },
      async (hub, port) => {
        const exitCode = await runSupervised(app, "test.token", "127.0.0.1", port, true);
        expect(exitCode).toBe(78); // 'revoked' = exit 78
        expect(hub.receivedHello).toBeDefined();
        expect(hub.receivedRegister).toBeDefined();
        expect(hub.receivedToolResponses).toHaveLength(1);
        const resp = hub.receivedToolResponses[0];
        expect(resp).toBeDefined();
        expect(resp!.invocationId).toBe("inv-1");
        expect(resp!.resultJson).toBeDefined();
        const body = JSON.parse(
          Buffer.from(resp!.resultJson!).toString("utf-8"),
        );
        expect(body).toEqual({ echoed: "hi" });
      },
    );
  });

  it("returns 78 when register is rejected", async () => {
    const app = await buildApp();
    await fakeHub(
      { acceptRegister: false, registerRejectReason: "token revoked" },
      async (_hub, port) => {
        const exitCode = await runSupervised(app, "test.token", "127.0.0.1", port, true);
        expect(exitCode).toBe(78);
      },
    );
  });

  it("returns 78 on GoAway('revoked')", async () => {
    const app = await buildApp();
    await fakeHub(
      { acceptRegister: true, toolCalls: [], finalGoAwayReason: "revoked" },
      async (_hub, port) => {
        const exitCode = await runSupervised(app, "test.token", "127.0.0.1", port, true);
        expect(exitCode).toBe(78);
      },
    );
  });
});
