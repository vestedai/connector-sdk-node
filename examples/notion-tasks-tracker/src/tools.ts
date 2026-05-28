/**
 * Tool handlers for the notion-tasks-tracker connector.
 *
 * Three tools:
 *   tasks.ops.search_tasks        — search tasks by text + optional status filter
 *   tasks.ops.update_task_status  — PATCH a task to a new status
 *   tasks.analytics.workload_summary — aggregate task counts for the whole team or one assignee
 *
 * Pattern for each tool class:
 *   - static args   — Zod schema validated by the SDK before handle() is called
 *   - static result — Zod schema used by the admin UI to document the output shape
 *   - handle(args: unknown, ctx) — cast args to z.infer<typeof Cls.args> inside
 *
 * The SDK validates args against `static args` before invoking handle().
 */

import { z } from "zod";
import {
  tool,
  ToolHandler,
  ToolValidationError,
  type ToolContext,
} from "@vested-ai/connector-sdk";

import { TaskClient, TaskNotFoundError } from "./client.js";

// ── Shared status enum ───────────────────────────────────────────────────────

const StatusEnum = z.enum(["todo", "in_progress", "done", "blocked"]);

// ── tasks.ops.search_tasks ────────────────────────────────────────────────────

@tool({
  key: "tasks.ops.search_tasks",
  description:
    "Search tasks by text query and optional status filter. Returns matching tasks with id, title, status, assignee, and due date.",
  defaultDeadlineMs: 15_000,
  maxResultBytes: 65_536,
})
export class SearchTasks extends ToolHandler {
  static args = z.object({
    query: z
      .string()
      .describe("Text matched against task title and description."),
    status: StatusEnum.optional().describe("Optional status filter."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max tasks to return (1–50). Defaults to 10."),
  });

  static result = z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        assignee: z.string().nullable(),
        due_date: z.string().nullable(),
      })
    ),
  });

  async handle(args: unknown, _ctx: ToolContext): Promise<unknown> {
    const { query, status, limit } = args as z.infer<typeof SearchTasks.args>;
    const client = TaskClient.fromEnv();

    const data = (await client.get("/tasks", {
      q: query,
      status: status,
      limit: limit,
    })) as { tasks?: RawTask[] };

    const tasks = (data.tasks ?? []).map(normalizeTask);
    return { tasks };
  }
}

// ── tasks.ops.update_task_status ──────────────────────────────────────────────

@tool({
  key: "tasks.ops.update_task_status",
  description:
    "Update the status of a task by its ID. Returns the previous and new status.",
  defaultDeadlineMs: 15_000,
  maxResultBytes: 4_096,
})
export class UpdateTaskStatus extends ToolHandler {
  static args = z.object({
    task_id: z.string().describe("Numeric or alphanumeric task ID."),
    new_status: StatusEnum.describe("Target status."),
  });

  static result = z.object({
    task_id: z.string(),
    previous_status: z.string(),
    new_status: z.string(),
  });

  async handle(args: unknown, _ctx: ToolContext): Promise<unknown> {
    const { task_id, new_status } = args as z.infer<
      typeof UpdateTaskStatus.args
    >;
    const client = TaskClient.fromEnv();
    const toolKey = "tasks.ops.update_task_status";

    // Fetch the current task to capture previous_status and verify existence.
    let current: RawTask;
    try {
      const data = (await client.get(`/tasks/${task_id}`)) as
        | { task?: RawTask }
        | RawTask;
      current =
        "task" in data && data.task ? data.task : (data as RawTask);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        throw new ToolValidationError(toolKey, `Task ${task_id} not found.`);
      }
      throw err;
    }

    const previousStatus = String(current.status ?? "unknown");

    await client.patch(`/tasks/${task_id}`, { status: new_status });

    return {
      task_id,
      previous_status: previousStatus,
      new_status,
    };
  }
}

// ── tasks.analytics.workload_summary ─────────────────────────────────────────

@tool({
  key: "tasks.analytics.workload_summary",
  description:
    "Return a workload summary — task counts by status and total open/completed — for the whole team or a single assignee over a lookback window.",
  defaultDeadlineMs: 20_000,
  maxResultBytes: 16_384,
})
export class WorkloadSummary extends ToolHandler {
  static args = z.object({
    assignee: z
      .string()
      .optional()
      .describe("Filter to one assignee. Omit for all-team summary."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days (1–365). Defaults to 30."),
  });

  static result = z.object({
    window_days: z.number(),
    assignee: z.string().nullable(),
    counts_by_status: z.record(z.number()),
    total_open: z.number(),
    total_completed_in_window: z.number(),
  });

  async handle(args: unknown, _ctx: ToolContext): Promise<unknown> {
    const { assignee, days } = args as z.infer<typeof WorkloadSummary.args>;
    const client = TaskClient.fromEnv();

    // Fetch all tasks visible in the window; aggregate locally.
    const data = (await client.get("/tasks", {
      assignee,
      window_days: days,
      limit: 500,
    })) as { tasks?: RawTask[] };

    const tasks = data.tasks ?? [];

    const countsByStatus: Record<string, number> = {};
    for (const task of tasks) {
      const s = String(task.status ?? "unknown");
      countsByStatus[s] = (countsByStatus[s] ?? 0) + 1;
    }

    const openStatuses = new Set(["todo", "in_progress", "blocked"]);
    const totalOpen = tasks.filter((t) =>
      openStatuses.has(String(t.status ?? ""))
    ).length;

    const totalCompleted = countsByStatus["done"] ?? 0;

    return {
      window_days: days,
      assignee: assignee ?? null,
      counts_by_status: countsByStatus,
      total_open: totalOpen,
      total_completed_in_window: totalCompleted,
    };
  }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RawTask {
  id?: string | number;
  title?: string;
  status?: string;
  assignee?: string | null;
  due_date?: string | null;
}

function normalizeTask(t: RawTask) {
  return {
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    status: String(t.status ?? ""),
    assignee: t.assignee ?? null,
    due_date: t.due_date ?? null,
  };
}
