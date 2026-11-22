import type { LockKey } from "./run-name";

export const agentTasks = [
  "explore",
  "implement",
  "implement-spec",
  "review",
] as const;

export type AgentTask = (typeof agentTasks)[number];

export const isAgentTask = (name: string): name is AgentTask =>
  (agentTasks as readonly string[]).includes(name);

export const lockScopes: Readonly<Record<AgentTask, LockKey["scope"]>> = {
  explore: "repo",
  implement: "ticket",
  "implement-spec": "ticket",
  review: "pr",
};
