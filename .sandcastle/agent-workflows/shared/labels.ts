import { agentTasks, type AgentTask } from "./tasks";

export type TriggerLabel = `agent:${AgentTask}`;

export const triggerLabel = (task: AgentTask): TriggerLabel => `agent:${task}`;

export const triggerLabels: readonly TriggerLabel[] = agentTasks.map(triggerLabel);

export const isTriggerLabel = (label: string): label is TriggerLabel =>
  (triggerLabels as readonly string[]).includes(label);

export const labels = {
  inProgress: "agent:in-progress",
  blocked: "agent:blocked",
  queued: "factory:queued",
  paused: "factory:paused",
  needsHuman: "factory:needs-human",
} as const;
