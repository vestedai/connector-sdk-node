/**
 * Exponential backoff with jitter.
 *
 * Mirrors vested-ai-sdks/php/src/Vested/Connect/Sdk/Hub/Backoff.php and
 * the Python port in runtime/backoff.py.
 */

const INITIAL_MS = 1000;
const CAP_MS = 30_000;
const FACTOR = 2;
const JITTER_PCT = 0.2;

export class Backoff {
  private current = INITIAL_MS;

  /**
   * Returns the next delay (ms), then advances the cursor.
   * Applies ±20% additive jitter on the base value before returning.
   */
  next(): number {
    const base = Math.min(this.current, CAP_MS);
    this.current = Math.min(this.current * FACTOR, CAP_MS);
    const spread = Math.floor(base * JITTER_PCT);
    const jitter = Math.floor(Math.random() * (2 * spread + 1)) - spread;
    return Math.max(0, base + jitter);
  }

  reset(): void {
    this.current = INITIAL_MS;
  }
}
