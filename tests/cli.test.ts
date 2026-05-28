import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { main } from "../src/cli.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = join(__dirname, "fixtures/cli_bootstraps");
const VALID_BOOTSTRAP = join(FIXTURES, "valid.ts");
const BOGUS_BOOTSTRAP = join(FIXTURES, "bogus.ts");
const MISSING_BOOTSTRAP = join(FIXTURES, "does_not_exist.ts");

describe("CLI main()", () => {
  it("--help returns 0 and prints usage", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(["--help"], {});
    expect(code).toBe(0);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/vested-connect/);
    expect(output).toMatch(/--bootstrap/);
    spy.mockRestore();
  });

  it("missing --token returns 78", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(
      ["worker", "--bootstrap", VALID_BOOTSTRAP, "--hub-addr", "localhost:4443"],
      { VESTED_CONNECTOR_TOKEN: "", VESTED_CONNECTOR_HUB: undefined },
    );
    expect(code).toBe(78);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/VESTED_CONNECTOR_TOKEN/);
    spy.mockRestore();
  });

  it("missing --hub returns 78", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(
      ["worker", "--bootstrap", VALID_BOOTSTRAP],
      { VESTED_CONNECTOR_TOKEN: "tok", VESTED_CONNECTOR_HUB: "" },
    );
    expect(code).toBe(78);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/VESTED_CONNECTOR_HUB/);
    spy.mockRestore();
  });

  it("missing bootstrap file returns 1", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(
      ["worker", "--bootstrap", MISSING_BOOTSTRAP, "--hub-addr", "localhost:4443"],
      { VESTED_CONNECTOR_TOKEN: "tok" },
    );
    expect(code).toBe(1);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/bootstrap not found/);
    spy.mockRestore();
  });

  it("bootstrap without default-export ConnectorApp returns 1", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(
      ["worker", "--bootstrap", BOGUS_BOOTSTRAP, "--hub-addr", "localhost:4443"],
      { VESTED_CONNECTOR_TOKEN: "tok" },
    );
    expect(code).toBe(1);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toMatch(/must default-export a ConnectorApp/);
    spy.mockRestore();
  });
});
