import { agentTasks, type AgentTask } from "./tasks";

const triggerPrefix = "agent:";

export type TriggerLabel = `agent:${AgentTask}`;

export const triggerLabel = (task: AgentTask): TriggerLabel => `${triggerPrefix}${task}`;

export const taskOfTriggerLabel = (label: TriggerLabel): AgentTask => label.slice(triggerPrefix.length) as AgentTask;

export const triggerLabels: readonly TriggerLabel[] = agentTasks.map(triggerLabel);

export const isTriggerLabel = (label: string): label is TriggerLabel =>
  (triggerLabels as readonly string[]).includes(label);

export const labels = {
  inProgress: "agent:in-progress",
  blocked: "agent:blocked",
  queued: "factory:queued",
  paused: "factory:paused",
  needsHuman: "factory:needs-human",
  needsAHuman: "needs-a-human",
} as const;

export const waitingLabels: readonly string[] = [labels.queued, labels.paused];

export const specQueueLabel = (spec: number): string => `spec:${spec}`;
