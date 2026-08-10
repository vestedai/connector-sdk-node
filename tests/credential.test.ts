import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

// Extension is `.ts`, matching this SDK's existing tests and src/index.ts.
import { CredentialError, CredentialOpener } from "../src/credential.ts";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../testdata/credential-envelope-vectors.json"),
    "utf8",
  ),
);

const opener = () =>
  new CredentialOpener(fixture.connector_private_key_pkcs8_pem);

const negative = (name: string) =>
  fixture.negative.find((n: { name: string }) => n.name === name);

const freshKeyPem = () =>
  crypto
    .generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();

/**
 * vitest's toThrow() matches a message, regexp, or Error class — it does NOT
 * accept expect.objectContaining, so asserting on `.code` needs a real catch.
 */
function codeOfThrown(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CredentialError) return e.code;
    throw e;
  }
  throw new Error("expected a CredentialError, nothing was thrown");
}

describe("CredentialOpener", () => {
  it("opens every positive vector to its expected plaintext", () => {
    for (const v of fixture.vectors) {
      expect(opener().open(v.envelope, v.connector_id, v.user_id)).toEqual(
        v.plaintext,
      );
    }
  });

  it("rejects an envelope sealed for a different user", () => {
    const n = negative("aad_identity_mismatch");
    expect(
      codeOfThrown(() =>
        opener().open(n.envelope, n.open_as_connector_id, n.open_as_user_id),
      ),
    ).toBe("identity_mismatch");
  });

  it("rejects a tampered ciphertext", () => {
    const n = negative("tampered_ciphertext");
    expect(
      codeOfThrown(() =>
        opener().open(n.envelope, n.open_as_connector_id, n.open_as_user_id),
      ),
    ).toBe("decrypt_failed");
  });

  it("rejects an unknown algorithm rather than guessing", () => {
    const n = negative("unknown_algorithm");
    expect(
      codeOfThrown(() =>
        opener().open(n.envelope, n.open_as_connector_id, n.open_as_user_id),
      ),
    ).toBe("unsupported_alg");
  });

  it("tries every key in the ring so a rotation overlap still opens", () => {
    const ring = new CredentialOpener(
      freshKeyPem(),
      fixture.connector_private_key_pkcs8_pem,
    );
    const v = fixture.vectors[0];
    expect(ring.open(v.envelope, v.connector_id, v.user_id)).toEqual(
      v.plaintext,
    );
  });

  it("fails when no key in the ring opens the envelope", () => {
    const v = fixture.vectors[0];
    expect(
      codeOfThrown(() =>
        new CredentialOpener(freshKeyPem()).open(
          v.envelope,
          v.connector_id,
          v.user_id,
        ),
      ),
    ).toBe("decrypt_failed");
  });
});
