import { describe, it, expect } from "vitest";
import { agent, readAgentDeclaration } from "../src/agent.ts";

describe("@agent", () => {
  it("stamps the declaration on the class", () => {
    @agent({ key: "x.y", name: "X", model: "openai:gpt-4o" })
    class X {}
    const decl = readAgentDeclaration(X);
    expect(decl?.key).toBe("x.y");
    expect(decl?.status).toBe("active");
    expect(decl?.instructions).toEqual([]);
  });

  it("preserves explicit instructions", () => {
    @agent({
      key: "x.y", name: "X", model: "openai:gpt-4o",
      instructions: [{ type: "system", position: 0, body: "hi" }],
    })
    class X {}
    expect(readAgentDeclaration(X)?.instructions).toHaveLength(1);
  });
});
