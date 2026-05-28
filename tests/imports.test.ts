import { describe, it, expect } from "vitest";

describe("package skeleton", () => {
  it("exports __version__", async () => {
    const mod = await import("../src/index.ts");
    expect(mod.__version__).toBe("0.2.2");
  });
});
