import crypto from "node:crypto";

/**
 * Sealed user-credential envelope. The core seals with the connector's public
 * key and cannot open what it stored; this module is the only place the
 * plaintext exists inside a worker.
 *
 * Format: ECDH-P256 -> HKDF-SHA256 -> AES-256-GCM. See
 * docs/superpowers/specs/2026-08-10-connector-user-auth-design.md.
 */
export interface CredentialEnvelope {
  v: number;
  alg: string;
  kid: string;
  epk: string;
  iv: string;
  ct: string;
  aad: string;
}

export type CredentialErrorCode =
  | "identity_mismatch"
  | "decrypt_failed"
  | "unsupported_alg";

export class CredentialError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = "CredentialError";
    this.code = code;
  }
}

export const CREDENTIAL_ALG = "ECDH-P256+HKDF-SHA256+A256GCM";

const INFO = Buffer.from("vested-connector-credential-v1");
const SALT = Buffer.alloc(32);
const TAG_BYTES = 16;

export class CredentialOpener {
  private readonly keyring: string[];

  /** @param privateKeyPems PKCS#8 PEM private keys, newest first. */
  constructor(...privateKeyPems: string[]) {
    this.keyring = privateKeyPems;
  }

  open(
    envelope: CredentialEnvelope,
    connectorId: string,
    userId: string,
  ): Record<string, string> {
    if (envelope.alg !== CREDENTIAL_ALG) {
      throw new CredentialError(
        "unsupported_alg",
        `unsupported credential envelope algorithm '${envelope.alg}'`,
      );
    }

    // Verify the binding BEFORE decrypting. GCM enforces the AAD anyway, but
    // checking here turns a generic decrypt failure into a specific, alertable
    // security signal: an envelope sealed for one identity arrived on a call
    // made by another.
    const expected = `connector:${connectorId}|user:${userId}|v${envelope.v ?? 1}`;
    if (!timingSafeEqualStr(expected, envelope.aad)) {
      throw new CredentialError(
        "identity_mismatch",
        `credential envelope identity mismatch: envelope is bound to '${envelope.aad}', invocation is '${expected}'`,
      );
    }

    let ephemeral: crypto.KeyObject;
    let iv: Buffer;
    let raw: Buffer;
    try {
      ephemeral = crypto.createPublicKey({
        key: Buffer.from(envelope.epk, "base64"),
        format: "der",
        type: "spki",
      });
      iv = Buffer.from(envelope.iv, "base64");
      raw = Buffer.from(envelope.ct, "base64");
    } catch {
      throw new CredentialError(
        "decrypt_failed",
        "credential envelope is malformed",
      );
    }

    if (raw.length <= TAG_BYTES) {
      throw new CredentialError(
        "decrypt_failed",
        "credential envelope ciphertext is too short",
      );
    }

    const body = raw.subarray(0, raw.length - TAG_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);

    for (const pem of this.keyring) {
      let pt: string;
      try {
        const z = crypto.diffieHellman({
          privateKey: crypto.createPrivateKey(pem),
          publicKey: ephemeral,
        });
        const key = Buffer.from(crypto.hkdfSync("sha256", z, SALT, INFO, 32));

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(envelope.aad, "utf8"));
        decipher.setAuthTag(tag);

        pt = Buffer.concat([decipher.update(body), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        continue; // wrong key in the ring, or authentication failed
      }

      const parsed: unknown = JSON.parse(pt);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CredentialError(
          "decrypt_failed",
          "credential payload is not an object",
        );
      }
      return parsed as Record<string, string>;
    }

    throw new CredentialError(
      "decrypt_failed",
      "credential envelope failed to decrypt or authenticate under any key in the ring",
    );
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
