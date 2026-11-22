import type { GateDecision } from "./gate";
import { labels, triggerLabel } from "./labels";
import { statusMarker, writeMarker } from "./marker";
import type { OutcomeRecord } from "./run-summary";
import type { AgentTask } from "./tasks";

export type AgentRunStart = {
  readonly factoryRepo: string;
  readonly workflow: string;
  readonly ref: string;
  readonly factorySha: string;
  readonly jobTimeoutMinutes: number;
};

export type GateRunContext = {
  readonly task: AgentTask;
  readonly item: { readonly repo: string; readonly number: number };
  readonly agentRun: AgentRunStart;
};

export type GateAction =
  | { readonly kind: "comment"; readonly body: string }
  | { readonly kind: "add label" | "remove label"; readonly label: string }
  | {
      readonly kind: "dispatch agent run";
      readonly factoryRepo: string;
      readonly workflow: string;
      readonly ref: string;
      readonly inputs: Readonly<Record<string, string>>;
    };

export type GateRunPlan = {
  readonly actions: readonly GateAction[];
  readonly record: Omit<OutcomeRecord, "seconds">;
};

const waitingText = (decision: GateDecision, task: AgentTask): string | undefined => {
  const restart = `The requeue run restarts it as \`${triggerLabel(task)}\`.`;
  switch (decision.kind) {
    case "proceed":
      return `Claimed: the ${task} agent run is starting.`;
    case "queued":
      return `Queued: the ${decision.reason} is full right now. ${restart}`;
    case "paused":
      return `Paused: Claude usage is paused. ${restart}`;
    case "quiet end":
      return undefined;
  }
};

const nextLabels = {
  proceed: labels.inProgress,
  queued: labels.queued,
  paused: labels.paused,
} as const;

const dispatch = ({ factoryRepo, workflow, ref, factorySha, jobTimeoutMinutes }: AgentRunStart, item: number): GateAction => ({
  kind: "dispatch agent run",
  factoryRepo,
  workflow,
  ref,
  inputs: { factory_sha: factorySha, issue: String(item), job_timeout: String(jobTimeoutMinutes) },
});

const outcomeOf = (decision: GateDecision): OutcomeRecord["outcome"] => {
  switch (decision.kind) {
    case "proceed":
      return { kind: "done" };
    case "quiet end":
      return { kind: "stopped", reason: `quiet end, ${decision.reason}` };
    default:
      return { kind: decision.kind };
  }
};

// Marker first and trigger label last, so a gate run that stops part-way
// leaves the trigger on and re-adding it is still the retry.
export const planGateRun = (decision: GateDecision, { task, item, agentRun }: GateRunContext): GateRunPlan => {
  const record = {
    task: `${task} gate run`,
    targetRepo: item.repo,
    item: { kind: "issue", number: item.number },
    outcome: outcomeOf(decision),
  } as const;
  const text = waitingText(decision, task);
  if (decision.kind === "quiet end" || text === undefined) return { actions: [], record };
  const nextLabel = nextLabels[decision.kind];
  return {
    actions: [
      { kind: "comment", body: `${text} ${writeMarker(triggerLabel(task))} ${statusMarker}` },
      { kind: "add label", label: nextLabel },
      { kind: "remove label", label: triggerLabel(task) },
      ...(decision.kind === "proceed" ? [dispatch(agentRun, item.number)] : []),
    ],
    record: { ...record, nextLabel },
  };
};

export const jobTimeoutMinutes = (agentMinutes: number): number => agentMinutes + 15;
