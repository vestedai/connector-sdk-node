/**
 * Routes ToolCallRequest frames to registered ToolHandlers.
 *
 * Each dispatch() call spawns a Promise and returns immediately — the
 * daemon's read loop is never blocked by a handler awaiting a slow call.
 *
 * Port of vested_connect/runtime/dispatcher.py.
 */

import type { ConnectorMsg, ToolCallRequest } from "../proto/vested/v1/connector_hub.ts";
import type { ToolContext, ToolDeclaration } from "../tool.ts";
import { validateArgs } from "../tool.ts";
import { ToolValidationError } from "../errors.ts";

export class Dispatcher {
  constructor(
    private readonly tools: ReadonlyMap<string, ToolDeclaration>,
    private readonly client: { send: (msg: ConnectorMsg) => void },
  ) {}

  /** Fire-and-forget: spawns a Promise, does NOT block the caller. */
  dispatch(req: ToolCallRequest): void {
    void this._handle(req).catch((e: unknown) => {
      console.error(
        `[vested] dispatcher: unhandled error for invocation ${req.invocationId}: ${String(e)}`,
      );
    });
  }

  private async _handle(req: ToolCallRequest): Promise<void> {
    const decl = this.tools.get(req.toolKey);
    if (!decl) {
      this._replyError(req.invocationId, "tool_not_found", `unknown tool ${req.toolKey}`);
      return;
    }

    let args: unknown;
    try {
      args = validateArgs(decl, req.argsJson as Buffer);
    } catch (e) {
      if (e instanceof ToolValidationError) {
        this._replyError(req.invocationId, "validation_error", e.message);
      } else {
        this._replyError(req.invocationId, "validation_error", String(e));
      }
      return;
    }

    const ctx: ToolContext = {
      orgId: parseInt(req.organizationId, 10) || 0,
      agentKey: req.agentKey ?? "",
      runId: "",
      conversationId: req.conversationId ?? "",
      userEmail: req.userEmail ?? "",
      userId: parseInt(req.userId, 10) || 0,
    };

    try {
      const handler = new decl.handlerCtor();
      const result = await handler.handle(args, ctx);
      this._replyOk(req.invocationId, JSON.stringify(result));
    } catch (e) {
      this._replyError(
        req.invocationId,
        "handler_error",
        e instanceof Error ? (e.message || String(e)) : String(e),
      );
    }
  }

  private _replyOk(invocationId: string, resultJson: string): void {
    const msg: ConnectorMsg = {
      toolCallResponse: {
        invocationId,
        resultJson: Buffer.from(resultJson, "utf-8"),
        durationMs: 0,
      },
    };
    this.client.send(msg);
  }

  private _replyError(invocationId: string, _code: string, message: string): void {
    // Wire protocol uses a single `error` string field (not an object).
    // We embed the code as a prefix so callers can pattern-match it.
    const msg: ConnectorMsg = {
      toolCallResponse: {
        invocationId,
        error: `${_code}: ${message}`,
        durationMs: 0,
      },
    };
    this.client.send(msg);
  }
}
