import type { GateDecision } from "../shared/gate";
import { jobTimeoutMinutes, planGateRun, type GateAction } from "../shared/gate-run-plan";
import { labels, triggerLabel } from "../shared/labels";
import { statusMarker, writeMarker } from "../shared/marker";
import type { LockKey } from "../shared/run-name";
import type { OutcomeRecord } from "../shared/run-summary";
import type { QueueSurvey } from "./queue";

// Until the PR loop, each `agent:implement-spec` label does one thing: split
// the spec into a queue when it has none, or else build the queue's next
// ready ticket. The split runs under the spec's lock and implement-spec's
// budget line; a build runs under its ticket's lock and implement's line.
export type SpecGateMode = "split" | "build";

export type SpecGateInput = {
  readonly spec: { readonly repo: string; readonly number: number };
  // The pre-run gates with everything but the lock key fixed.
  readonly decide: (lockKey: LockKey) => GateDecision;
  readonly survey: () => QueueSurvey;
  readonly agentRun: {
    readonly factoryRepo: string;
    readonly workflow: string;
    readonly ref: string;
    readonly factorySha: string;
  };
  readonly agentMinutes: { readonly split: number; readonly build: number };
};

type IssueAction = Extract<GateAction, { kind: "comment" | "add label" | "remove label" }>;

export type SpecGateAction =
  | (IssueAction & { readonly on: number })
  | Extract<GateAction, { kind: "dispatch agent run" }>;

export type SpecGatePlan = {
  readonly actions: readonly SpecGateAction[];
  readonly record: Omit<OutcomeRecord, "seconds">;
};

const task = "implement-spec";
const trigger = triggerLabel(task);

const ticketLock = (repo: string, number: number): LockKey => ({ scope: "ticket", repo, number });

const onSpec = (input: SpecGateInput, decision: GateDecision): SpecGatePlan => {
  const { spec, agentRun } = input;
  const plan = planGateRun(decision, {
    task,
    item: spec,
    agentRun: { ...agentRun, jobTimeoutMinutes: jobTimeoutMinutes(input.agentMinutes.split) },
  });
  return {
    ...plan,
    actions: plan.actions.flatMap((action) =>
      action.kind === "dispatch agent run" || action.kind === "claim batch" ? [] : [{ ...action, on: spec.number }]
    ),
  };
};

const startAgentRun = (input: SpecGateInput, mode: SpecGateMode, issue: number): SpecGateAction => ({
  kind: "dispatch agent run",
  factoryRepo: input.agentRun.factoryRepo,
  workflow: input.agentRun.workflow,
  ref: input.agentRun.ref,
  inputs: {
    factory_ref: input.agentRun.ref,
    factory_sha: input.agentRun.factorySha,
    mode,
    spec: String(input.spec.number),
    issue: String(issue),
    job_timeout: String(jobTimeoutMinutes(input.agentMinutes[mode])),
  },
});

const stop = (input: SpecGateInput, reason: string, text: string): SpecGatePlan => ({
  actions: [
    { kind: "comment", on: input.spec.number, body: `${text} ${statusMarker}` },
    { kind: "remove label", on: input.spec.number, label: trigger },
  ],
  record: {
    task: `${task} gate run`,
    targetRepo: input.spec.repo,
    item: { kind: "issue", number: input.spec.number },
    outcome: { kind: "stopped", reason },
  },
});

const split = (input: SpecGateInput, decision: GateDecision): SpecGatePlan => {
  const plan = onSpec(input, decision);
  return { ...plan, actions: [...plan.actions, startAgentRun(input, "split", input.spec.number)] };
};

const build = (input: SpecGateInput, ticket: number): SpecGatePlan => {
  const decision = input.decide(ticketLock(input.spec.repo, ticket));
  if (decision.kind !== "proceed") return onSpec(input, decision);
  const spec = input.spec.number;
  return {
    actions: [
      {
        kind: "comment",
        on: spec,
        body: `Building #${ticket}, the queue's next ready ticket. ${writeMarker(trigger)} ${statusMarker}`,
      },
      { kind: "comment", on: ticket, body: `Claimed: the implement-spec run for #${spec} is building this. ${statusMarker}` },
      { kind: "add label", on: ticket, label: labels.inProgress },
      { kind: "remove label", on: spec, label: trigger },
      startAgentRun(input, "build", ticket),
    ],
    record: {
      task: `${task} gate run`,
      targetRepo: input.spec.repo,
      item: { kind: "issue", number: ticket },
      outcome: { kind: "done" },
      nextLabel: labels.inProgress,
    },
  };
};

const list = (numbers: readonly number[]): string => numbers.map((n) => `#${n}`).join(", ");

export const planSpecGate = (input: SpecGateInput): SpecGatePlan => {
  const decision = input.decide(ticketLock(input.spec.repo, input.spec.number));
  if (decision.kind !== "proceed") return onSpec(input, decision);
  const survey = input.survey();
  switch (survey.kind) {
    case "no queue":
      return split(input, decision);
    case "ready":
      return build(input, survey.ticket);
    case "drained":
      return stop(input, "queue drained", "Nothing to build: every ticket in this spec's queue is closed.");
    case "nothing ready":
      return stop(
        input,
        "nothing ready",
        `Nothing to build yet. Open: ${list(survey.open)}.` +
          (survey.held.length > 0 ? ` Held by a run, parked or waiting: ${list(survey.held)}.` : "") +
          ` The rest wait on their dependencies. Re-add \`${trigger}\` once one is free.`
      );
  }
};
