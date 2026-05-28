/**
 * Fixture: a "bootstrap" file that calls scanModule on its own URL.
 * The scanner MUST exclude this file from the walk; otherwise the
 * dynamic import re-enters the same module while its top-level await
 * is pending, deadlocking the test.
 *
 * The fixture intentionally avoids top-level await so we can assert the
 * scanner skips this file regardless. (Bootstrap-style top-level await
 * would deadlock if the fix regressed — that's the integration coverage,
 * not this unit's coverage.)
 */

export const FROM_BOOTSTRAP = true;
