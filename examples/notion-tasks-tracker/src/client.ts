/**
 * Thin native-fetch wrapper for a generic task tracker REST API.
 *
 * Authenticates every request with a Bearer token. Maps HTTP error codes to
 * typed errors so tool handlers can catch specific failure modes.
 *
 * Usage:
 *
 *   const client = TaskClient.fromEnv();
 *   const data = await client.get("/tasks", { status: "todo", limit: "10" });
 *   const updated = await client.patch("/tasks/task-123", { status: "done" });
 */

import { ToolValidationError } from "@vested-ai/connector-sdk";

export class TaskAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskAuthError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotFoundError";
  }
}

export class TaskClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, token: string, timeoutMs = 10_000) {
    if (!baseUrl) {
      throw new ToolValidationError(
        "tasks",
        "TASK_TRACKER_API_BASE_URL is required"
      );
    }
    if (!token) {
      throw new ToolValidationError(
        "tasks",
        "TASK_TRACKER_API_TOKEN is required"
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  /** Build from TASK_TRACKER_API_BASE_URL and TASK_TRACKER_API_TOKEN env vars. */
  static fromEnv(): TaskClient {
    return new TaskClient(
      process.env["TASK_TRACKER_API_BASE_URL"] ?? "",
      process.env["TASK_TRACKER_API_TOKEN"] ?? ""
    );
  }

  /** GET *path* with optional query params, returns decoded JSON. */
  async get(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    const url = this.buildUrl(path, params);
    const response = await this.fetchWithTimeout(url, { method: "GET" });
    return this.handleResponse(response);
  }

  /** PATCH *path* with a JSON body, returns decoded JSON. */
  async patch(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = this.buildUrl(path);
    const response = await this.fetchWithTimeout(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.handleResponse(response);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    params?: Record<string, string | number | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleResponse(response: Response): Promise<unknown> {
    const status = response.status;
    if (status >= 200 && status < 300) {
      return response.json() as Promise<unknown>;
    }
    const preview = await response.text().then((t) => t.slice(0, 200));
    const msg = `Task API ${response.url} → ${status}: ${preview}`;
    if (status === 401 || status === 403) throw new TaskAuthError(msg);
    if (status === 404) throw new TaskNotFoundError(msg);
    throw new Error(msg);
  }
}
