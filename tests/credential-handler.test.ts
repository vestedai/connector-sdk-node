import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialOpener } from "../src/credential.ts";
import {
  CredentialOpDispatcher,
  credentialFailed,
  credentialOk,
  type CredentialContext,
  type CredentialValidation,
  type UserCredentialHandler,
} from "../src/credential-handler.ts";
import type { CredentialOpRequest } from "../src/proto/vested/v1/connector_hub.ts";

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, "../testdata/credential-envelope-vectors.json"),
    "utf8",
  ),
);

const vector = fixture.vectors[0];

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

class SpyHandler implements UserCredentialHandler {
  sawCredential: Record<string, string> | null = null;
  sawCtx: CredentialContext | null = null;
  revokeCalls = 0;

  constructor(private readonly verdict?: CredentialValidation) {}

  validate(ctx: CredentialContext, credential: Record<string, string>) {
    this.sawCredential = credential;
    this.sawCtx = ctx;
    return this.verdict ?? credentialOk({ account: "j.smith@erp" });
  }

  revoke(_ctx: CredentialContext, credential: Record<string, string>) {
    this.revokeCalls++;
    this.sawCredential = credential;
  }
}

function request(userId: string, op = "validate"): CredentialOpRequest {
  return {
    opId: "op-1",
    op,
    userId,
    userEmail: "j.smith@example.com",
    employeeNo: "",
    erpIdentifier: "",
    envelopeJson: Buffer.from(JSON.stringify(vector.envelope)),
    deadlineMs: 5000,
  } as CredentialOpRequest;
}

function dispatcher(handler: UserCredentialHandler | null) {
  return new CredentialOpDispatcher(
    new CredentialOpener(fixture.connector_private_key_pkcs8_pem),
    handler,
    vector.connector_id,
    logger,
  );
}

beforeEach(() => {
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("CredentialOpDispatcher", () => {
  it("opens the envelope and hands the handler plaintext", async () => {
    const handler = new SpyHandler();
    const resp = await dispatcher(handler).dispatch(request(vector.user_id));

    expect(resp.ok).toBe(true);
    expect(handler.sawCredential).toEqual(vector.plaintext);
    expect(handler.sawCtx?.userId).toBe(vector.user_id);
  });

  it("surfaces a handler refusal as ok=false with its message", async () => {
    const resp = await dispatcher(
      new SpyHandler(credentialFailed("ERP rejected those credentials.")),
    ).dispatch(request(vector.user_id));

    expect(resp.ok).toBe(false);
    expect(resp.error).toBe("ERP rejected those credentials.");
  });

  it("refuses an envelope sealed for a different user without calling the handler", async () => {
    const handler = new SpyHandler();
    const resp = await dispatcher(handler).dispatch(request("999999"));

    expect(resp.ok).toBe(false);
    expect(handler.sawCredential).toBeNull();
  });

  it("never leaks handler exception text to the user", async () => {
    const throwing: UserCredentialHandler = {
      validate() {
        throw new Error("ERP host db-prod-07.internal refused: connection reset");
      },
      revoke() {},
    };

    const resp = await dispatcher(throwing).dispatch(request(vector.user_id));

    expect(resp.ok).toBe(false);
    expect(resp.error).not.toContain("db-prod-07.internal");
  });

  it("runs revoke when asked", async () => {
    const handler = new SpyHandler();
    const resp = await dispatcher(handler).dispatch(request(vector.user_id, "revoke"));

    expect(resp.ok).toBe(true);
    expect(handler.revokeCalls).toBe(1);
  });

  it("answers ok=false rather than staying silent when no handler is registered", async () => {
    const resp = await dispatcher(null).dispatch(request(vector.user_id));

    expect(resp.ok).toBe(false);
    expect(resp.opId).toBe("op-1");
  });
});
