import type { GateDecision } from "./gate";
import { labels, triggerLabel } from "./labels";
import { statusMarker, writeMarker } from "./marker";
import type { LockKey } from "./run-name";
import type { OutcomeRecord } from "./run-summary";
import { lockScopes, type AgentTask } from "./tasks";

export type AgentRunStart = {
  readonly factoryRepo: string;
  readonly workflow: string;
  readonly ref: string;
  readonly factorySha: string;
};

export type GateRunContext = {
  readonly task: AgentTask;
  readonly item: { readonly repo: string; readonly number: number };
  readonly agentRun: AgentRunStart & { readonly jobTimeoutMinutes: number };
  readonly batch?: readonly number[];
};

export type GateAction =
  | { readonly kind: "comment"; readonly on: number; readonly body: string }
  | { readonly kind: "add label" | "remove label"; readonly on: number; readonly label: string }
  | { readonly kind: "claim batch"; readonly numbers: readonly number[]; readonly add: string; readonly remove: string }
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

type ScopeShape = {
  readonly itemKind: "issue" | "pr";
  readonly lockKey: (repo: string, number: number) => LockKey;
  readonly dispatchInput: (number: number, batch: readonly number[] | undefined) => Record<string, string>;
};

export const scopeShapes: Readonly<Record<LockKey["scope"], ScopeShape>> = {
  repo: {
    itemKind: "issue",
    lockKey: (repo) => ({ scope: "repo", repo }),
    dispatchInput: (number, batch) => ({ batch: JSON.stringify(batch ?? [number]) }),
  },
  pr: {
    itemKind: "pr",
    lockKey: (repo, number) => ({ scope: "pr", repo, number }),
    dispatchInput: (number) => ({ pr: String(number) }),
  },
  ticket: {
    itemKind: "issue",
    lockKey: (repo, number) => ({ scope: "ticket", repo, number }),
    dispatchInput: (number) => ({ issue: String(number) }),
  },
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

export const dispatchAgentRun = (agentRun: AgentRunStart, inputs: Readonly<Record<string, string>>): GateAction => ({
  kind: "dispatch agent run",
  factoryRepo: agentRun.factoryRepo,
  workflow: agentRun.workflow,
  ref: agentRun.ref,
  inputs: { factory_ref: agentRun.ref, factory_sha: agentRun.factorySha, ...inputs },
});

const batchText = (batch: readonly number[] | undefined): string =>
  batch === undefined ? "" : ` Its batch holds ${batch.length} ${batch.length === 1 ? "issue" : "issues"}.`;

export type GateLabelsContext = Omit<GateRunContext, "agentRun">;

const swapLabels = (decision: GateDecision, { task, item, batch }: GateLabelsContext, nextLabel: string): GateAction[] =>
  decision.kind === "proceed" && batch !== undefined
    ? [{ kind: "claim batch", numbers: batch, add: nextLabel, remove: triggerLabel(task) }]
    : [
        { kind: "add label", on: item.number, label: nextLabel },
        { kind: "remove label", on: item.number, label: triggerLabel(task) },
      ];

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

// Order: docs/factory-v1.md, "Locks, tries and claims".
export const planGateLabels = (decision: GateDecision, context: GateLabelsContext): GateRunPlan => {
  const { task, item } = context;
  const record = {
    task: `${task} gate run`,
    targetRepo: item.repo,
    item: { kind: scopeShapes[lockScopes[task]].itemKind, number: item.number },
    outcome: outcomeOf(decision),
  } as const;
  const text = waitingText(decision, task);
  if (decision.kind === "quiet end" || text === undefined) return { actions: [], record };
  const nextLabel = nextLabels[decision.kind];
  const claim = decision.kind === "proceed" ? batchText(context.batch) : "";
  return {
    actions: [
      { kind: "comment", on: item.number, body: `${text}${claim} ${writeMarker(triggerLabel(task))} ${statusMarker}` },
      ...swapLabels(decision, context, nextLabel),
    ],
    record: { ...record, nextLabel },
  };
};

export const planGateRun = (decision: GateDecision, context: GateRunContext): GateRunPlan => {
  const plan = planGateLabels(decision, context);
  if (decision.kind !== "proceed") return plan;
  const { task, item, batch, agentRun } = context;
  const inputs = {
    ...scopeShapes[lockScopes[task]].dispatchInput(item.number, batch),
    job_timeout: String(agentRun.jobTimeoutMinutes),
  };
  return { ...plan, actions: [...plan.actions, dispatchAgentRun(agentRun, inputs)] };
};

export const jobTimeoutMinutes = (agentMinutes: number): number => agentMinutes + 15;
