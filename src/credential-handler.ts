import type { Logger } from "./app.ts";
import { CredentialError, CredentialOpener } from "./credential.ts";
import type {
  CredentialOpRequest,
  CredentialOpResponse,
} from "./proto/vested/v1/connector_hub.ts";

/**
 * Identity context for a credential lifecycle operation.
 *
 * Deliberately carries no agent or tool key — a credential op is not scoped to
 * a tool — and no raw envelope: the SDK opens it and hands the handler
 * plaintext, so connector authors cannot skip the identity check that makes
 * per-user auth mean anything.
 */
export interface CredentialContext {
  readonly opId: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly employeeNo: string;
  readonly erpIdentifier: string;
  readonly logger: Logger;
}

/**
 * A handler's verdict. `display` is shown to the user, so it must contain only
 * non-secret facts — an account name or role, never the credential itself.
 */
export interface CredentialValidation {
  readonly ok: boolean;
  readonly error?: string;
  readonly display?: Record<string, string>;
}

export const credentialOk = (
  display: Record<string, string> = {},
): CredentialValidation => ({ ok: true, display });

/**
 * @param userFacingMessage shown verbatim to the user. Do not include the
 *        credential, a stack trace, or internal hostnames.
 */
export const credentialFailed = (userFacingMessage: string): CredentialValidation => ({
  ok: false,
  error: userFacingMessage,
});

/**
 * Implemented by a connector that wants per-user credentials.
 *
 * The platform cannot open a sealed credential — only this worker can — so
 * every question about whether a user's credentials work is answered here.
 * `credential` arrives already decrypted and already verified as belonging to
 * the calling user.
 */
export interface UserCredentialHandler {
  validate(
    ctx: CredentialContext,
    credential: Record<string, string>,
  ): Promise<CredentialValidation> | CredentialValidation;

  /** Best-effort: the platform deletes its copy regardless of the outcome. */
  revoke(
    ctx: CredentialContext,
    credential: Record<string, string>,
  ): Promise<void> | void;
}

/**
 * Worker-side dispatcher for credential ops.
 *
 * Never throws and always answers — silence would make the platform wait out
 * its full deadline for an op that was never going to complete.
 */
export class CredentialOpDispatcher {
  constructor(
    private readonly opener: CredentialOpener,
    private readonly handler: UserCredentialHandler | null,
    private readonly connectorId: string,
    private readonly logger: Logger,
  ) {}

  async dispatch(req: CredentialOpRequest): Promise<CredentialOpResponse> {
    const base = { opId: req.opId, ok: false, error: "", display: undefined };

    if (this.handler === null) {
      return {
        ...base,
        error: "This integration does not accept per-user credentials.",
      } as CredentialOpResponse;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(req.envelopeJson).toString("utf8"));
    } catch {
      return {
        ...base,
        error: "The stored credential is unreadable. Please enter it again.",
      } as CredentialOpResponse;
    }

    let credential: Record<string, string>;
    try {
      credential = this.opener.open(
        envelope as Parameters<CredentialOpener["open"]>[0],
        this.connectorId,
        req.userId,
      );
    } catch (e) {
      // The message can name key fingerprints and internals, so it is logged
      // but never returned. An identity mismatch is a security event, not a
      // user-fixable typo.
      this.logger.warn?.(
        `[vested] credential envelope could not be opened (op=${req.opId} user=${req.userId}): ${
          e instanceof CredentialError ? e.code : String(e)
        }`,
      );
      return {
        ...base,
        error:
          "The stored credential could not be read by this integration. Please enter it again.",
      } as CredentialOpResponse;
    }

    const ctx: CredentialContext = {
      opId: req.opId,
      userId: req.userId,
      userEmail: req.userEmail,
      employeeNo: req.employeeNo,
      erpIdentifier: req.erpIdentifier,
      logger: this.logger,
    };

    try {
      if (req.op === "revoke") {
        await this.handler.revoke(ctx, credential);
        return { ...base, ok: true } as CredentialOpResponse;
      }

      const verdict = await this.handler.validate(ctx, credential);
      return {
        opId: req.opId,
        ok: verdict.ok,
        error: verdict.error ?? "",
        display: toStruct(verdict.display),
      } as CredentialOpResponse;
    } catch (e) {
      this.logger.error?.(
        `[vested] credential handler threw (op=${req.opId}): ${String(e)}`,
      );
      return {
        ...base,
        error: "The integration could not check these credentials right now.",
      } as CredentialOpResponse;
    }
  }
}

function toStruct(
  display: Record<string, string> | undefined,
): CredentialOpResponse["display"] {
  if (!display || Object.keys(display).length === 0) return undefined;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(display)) {
    fields[k] = { kind: { $case: "stringValue", stringValue: String(v) } };
  }
  return { fields } as CredentialOpResponse["display"];
}
