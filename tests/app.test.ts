import { describe, it, expect } from "vitest";
import { ConnectorApp } from "../src/app.ts";
import type { Logger } from "../src/app.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCANNER_FIXTURE_URL = new URL(
  join(__dirname, "fixtures/scanner_app/index.ts"),
  import.meta.url,
).href;

describe("ConnectorApp", () => {
  it("create() returns a fresh instance with empty agents and tools", () => {
    const a = ConnectorApp.create();
    const b = ConnectorApp.create();
    expect(a).not.toBe(b);
    expect(a.agents).toHaveLength(0);
    expect(a.tools.size).toBe(0);
  });

  it("scanModule collects agents and tools from the scanner_app fixture", async () => {
    const app = await ConnectorApp.create().scanModule(SCANNER_FIXTURE_URL);
    // scanner_app/index.ts declares 1 agent + 2 tools
    expect(app.agents.length).toBeGreaterThanOrEqual(1);
    expect(app.agents.some((a) => a.key === "fixture.agent")).toBe(true);
    expect(app.tools.has("fixture.agent.ping")).toBe(true);
    expect(app.tools.has("fixture.agent.pong")).toBe(true);
  });

  it("duplicate agent key throws on second scanModule call", async () => {
    const app = await ConnectorApp.create().scanModule(SCANNER_FIXTURE_URL);
    await expect(app.scanModule(SCANNER_FIXTURE_URL)).rejects.toThrow(
      /duplicate agent key/,
    );
  });

  it("withLogger chains and stores the logger", () => {
    const customLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const app = ConnectorApp.create().withLogger(customLogger);
    expect(app.logger).toBe(customLogger);
  });
});
