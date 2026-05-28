import { describe, it, expect, vi, afterEach } from "vitest";
import { Backoff } from "../../src/runtime/backoff.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Backoff", () => {
  it("returns initial ~1000ms on first call with mid-jitter (random=0.5)", () => {
    // With Math.random() === 0.5 the jitter term resolves to 0
    // because spread = floor(1000 * 0.2) = 200;
    // jitter = floor(0.5 * (2*200+1)) - 200 = floor(200.5) - 200 = 0
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const b = new Backoff();
    const first = b.next();
    expect(first).toBe(1000);
  });

  it("doubles the base on each successive call (no jitter)", () => {
    // Suppress jitter by mocking random to 0 → jitter = floor(0) - spread = -spread
    // Actually, with random=0: jitter = floor(0*(2*s+1)) - s = 0 - s = -s
    // So result = base - spread. Not zero-jitter.
    // Better: use random=0.5 which gives jitter≈0 for integer spreads.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const b = new Backoff();
    const results = [b.next(), b.next(), b.next(), b.next(), b.next()];
    // With ~0 jitter, sequence should be [1000, 2000, 4000, 8000, 16000]
    expect(results[0]).toBe(1000);
    expect(results[1]).toBe(2000);
    expect(results[2]).toBe(4000);
    expect(results[3]).toBe(8000);
    expect(results[4]).toBe(16000);
  });

  it("caps at 30000ms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const b = new Backoff();
    // Advance past cap (1000→2000→4000→8000→16000→30000→30000)
    for (let i = 0; i < 5; i++) b.next();
    const capped = b.next();
    // base is 30000, jitter ~0 → result is 30000
    expect(capped).toBe(30000);
  });

  it("reset() returns cursor to initial", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const b = new Backoff();
    b.next();
    b.next();
    b.reset();
    const afterReset = b.next();
    expect(afterReset).toBe(1000);
  });

  it("jitter is within ±20% of the base", () => {
    const b = new Backoff();
    // Don't mock random — verify the statistical property.
    for (let i = 0; i < 50; i++) {
      b.reset();
      const val = b.next(); // base = 1000, spread = 200
      expect(val).toBeGreaterThanOrEqual(800);
      expect(val).toBeLessThanOrEqual(1200);
    }
  });
});
