import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CredentialOpener, CredentialError } from "../src/credential.ts";
import {
  CredentialResolver,
  CredentialUnavailableError,
} from "../src/credential-resolver.ts";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../testdata/credential-envelope-vectors.json"),
    "utf8",
  ),
);
const vector = fixture.vectors[0];

function resolverFor(connectorId: string, userId: string) {
  return new CredentialResolver(
    new CredentialOpener(fixture.connector_private_key_pkcs8_pem),
    Buffer.from(JSON.stringify(vector.envelope)),
    () => connectorId,
    userId,
  );
}

describe("CredentialResolver", () => {
  it("hands a tool the decrypted credential", () => {
    const r = resolverFor(vector.connector_id, vector.user_id);

    expect(r.hasCredential()).toBe(true);
    expect(r.credential()).toEqual(vector.plaintext);
  });

  it("memoizes, so a tool reading it twice pays for one key agreement", () => {
    const r = resolverFor(vector.connector_id, vector.user_id);

    expect(r.credential()).toBe(r.credential());
  });

  it("refuses an envelope sealed for a different user", () => {
    // The check lives in CredentialOpener, on the only path a tool author can
    // reach — a tool cannot opt out of it.
    const r = resolverFor(vector.connector_id, "999999");

    expect(() => r.credential()).toThrow(CredentialError);
  });

  it("reports no credential rather than throwing, so a tool can branch", () => {
    const r = new CredentialResolver(null, null, () => "42", "1337");

    expect(r.hasCredential()).toBe(false);
  });

  it("throws a named error when a tool asks for one that was never sent", () => {
    const r = new CredentialResolver(null, null, () => "42", "1337");

    expect(() => r.credential()).toThrow(CredentialUnavailableError);
  });

  it("resolves the connector id lazily, since it arrives at HelloAck", () => {
    let id = "";
    const r = new CredentialResolver(
      new CredentialOpener(fixture.connector_private_key_pkcs8_pem),
      Buffer.from(JSON.stringify(vector.envelope)),
      () => id,
      vector.user_id,
    );

    // Constructed before the handshake; the id lands afterwards.
    id = vector.connector_id;

    expect(r.credential()).toEqual(vector.plaintext);
  });
});
