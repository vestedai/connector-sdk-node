import { CredentialError, CredentialOpener } from "./credential.ts";

/**
 * No sealed credential was forwarded for this tool call.
 *
 * Defensive: when a connector declares a credential schema the platform gates
 * dispatch, so a gated tool should never run without one. Reaching this means
 * either the connector declares no schema (and the tool should not be asking)
 * or the gate is misconfigured — both worth failing loudly rather than
 * silently proceeding without an identity.
 */
export class CredentialUnavailableError extends Error {
  readonly code = "credential_unavailable" as const;

  constructor(message: string) {
    super(message);
    this.name = "CredentialUnavailableError";
  }
}

/**
 * Lazily opens the caller's sealed credential for one tool invocation.
 *
 * Lazy because most tools never read the credential, and one that doesn't ask
 * should neither pay for an ECDH key agreement nor fail because of one.
 * Memoized because a tool may read it more than once.
 */
export class CredentialResolver {
  private opened: Record<string, string> | null = null;

  constructor(
    private readonly opener: CredentialOpener | null,
    private readonly envelopeJson: Uint8Array | null,
    /** Lazy: the hub assigns the connector id at HelloAck, after construction. */
    private readonly connectorId: () => string,
    private readonly userId: string,
  ) {}

  hasCredential(): boolean {
    return this.opener !== null && !!this.envelopeJson && this.envelopeJson.length > 0;
  }

  credential(): Record<string, string> {
    if (this.opened !== null) return this.opened;

    if (!this.hasCredential()) {
      throw new CredentialUnavailableError(
        "No user credential was supplied for this tool call. Either this connector " +
          "declares no credential schema, or the platform refused the call before dispatch.",
      );
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(this.envelopeJson!).toString("utf8"));
    } catch {
      throw new CredentialError(
        "decrypt_failed",
        "The forwarded credential envelope is malformed.",
      );
    }

    // The AAD identity check happens inside open(). Deliberately not duplicated
    // here: one implementation, on the only path a connector author can reach.
    this.opened = this.opener!.open(
      envelope as Parameters<CredentialOpener["open"]>[0],
      this.connectorId(),
      this.userId,
    );

    return this.opened;
  }
}
