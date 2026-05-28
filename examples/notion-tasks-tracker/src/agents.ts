/**
 * Agent declarations for the notion-tasks-tracker connector.
 *
 * Two agents:
 *   tasks.ops       — looks up and updates task status
 *   tasks.analytics — answers workload and throughput questions
 */

import { agent } from "@vested-ai/connector-sdk";

@agent({
  key: "tasks.ops",
  name: "Tasks Ops",
  model: "openai:gpt-4o",
  description: "Looks up tasks and updates their status for the team.",
  instructions: [
    {
      type: "system",
      position: 0,
      body: "You help team members find and update tasks. Always look up a task by ID before changing its status. Use natural-language status terms when relaying results to users (e.g., 'in progress' not 'in_progress').",
    },
  ],
})
export class TasksOpsAgent {}

@agent({
  key: "tasks.analytics",
  name: "Tasks Analytics",
  model: "openai:gpt-4o",
  description: "Answers workload and throughput questions.",
  instructions: [
    {
      type: "system",
      position: 0,
      body: "You answer questions about team workload and task throughput. Quote actual counts from the workload_summary tool; do not estimate.",
    },
  ],
})
export class TasksAnalyticsAgent {}
