import { classifyPause, pauseItemText, type Pause } from "../shared/budget-pause";
import { labels, triggerLabel } from "../shared/labels";
import { statusMarker, writeMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type AgentEnd =
  | { readonly kind: "finished" }
  | { readonly kind: "ceiling hit" | "crashed"; readonly message: string }
  | { readonly kind: "paused"; readonly pause: Pause; readonly message: string };

export type AgentRunFacts = {
  readonly agentEnd: AgentEnd;
  readonly commits: number;
  readonly treeClean: boolean;
  readonly guard?: { readonly verdict: "push" } | { readonly verdict: "refuse"; readonly reasons: string };
};

export type AgentRunEnd = {
  readonly push: boolean;
  readonly handOffToReview: boolean;
  readonly outcome: Outcome;
  readonly why: string;
  readonly pause?: Pause;
};

export type AgentRunReport = {
  readonly block: boolean;
  readonly outcome: Outcome;
  readonly nextLabel: string;
  readonly comment: string;
};

// Implement retries only when a person re-adds its label, so its first
// failed try is also its last.
const failedTry: Outcome = { kind: "failed try", try: 1, of: 1 };

const maxTurnsStop = /error_max_turns|max(?:imum)?[ _-]?turns/i;

export const classifyAgentEnd = (error: unknown, now: Date): AgentEnd => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "CeilingHit") return { kind: "ceiling hit", message };
  const pause = classifyPause(message, now);
  if (pause.kind !== "not a pause") return { kind: "paused", pause, message };
  if (maxTurnsStop.test(message)) return { kind: "ceiling hit", message };
  return { kind: "crashed", message };
};

const noPush = (outcome: Outcome, why: string): AgentRunEnd => ({ push: false, handOffToReview: false, outcome, why });

// A pause fails fast and pushes nothing: the restart builds afresh, and a
// pause is not a try.
export const decideAgentRunEnd = ({ agentEnd, commits, treeClean, guard }: AgentRunFacts): AgentRunEnd => {
  if (agentEnd.kind === "paused")
    return { ...noPush({ kind: "paused" }, agentEnd.message), pause: agentEnd.pause };
  if (agentEnd.kind === "crashed") return noPush(failedTry, `The agent crashed: ${agentEnd.message}`);
  if (commits === 0)
    return agentEnd.kind === "ceiling hit"
      ? noPush({ kind: "ceiling hit" }, agentEnd.message)
      : noPush(failedTry, "The agent finished without committing anything, so there is nothing to open a PR for.");
  if (guard?.verdict === "refuse")
    return noPush(failedTry, `The push guard refused the agent's commits, so nothing was pushed.\n\n${guard.reasons}`);
  if (guard === undefined) return noPush(failedTry, "The push guard did not scan the agent's commits, so nothing was pushed.");
  if (agentEnd.kind === "ceiling hit")
    return { push: true, handOffToReview: false, outcome: { kind: "ceiling hit" }, why: agentEnd.message };
  if (!treeClean)
    return noPush(failedTry, "The agent left uncommitted changes, which the PR would not contain.");
  return { push: true, handOffToReview: true, outcome: { kind: "done" }, why: "" };
};

export type ReportFacts = {
  readonly prUrl?: string;
  readonly handedOff: boolean;
  readonly hostStepFailed: boolean;
  readonly runUrl: string;
};

const retryText = `Re-add \`${triggerLabel("implement")}\` to retry, on a new branch.`;

const reportText = (end: AgentRunEnd, { prUrl, handedOff, hostStepFailed, runUrl }: ReportFacts): string => {
  const logs = `[logs](${runUrl})`;
  const pr = prUrl ? ` Draft PR: ${prUrl}.` : "";
  if (hostStepFailed && prUrl && !handedOff)
    return `Implementer run **failed** at the hand-off to review — ${logs}.${pr} Add \`${triggerLabel("review")}\` to it to have it reviewed.`;
  if (hostStepFailed) return `Implementer run **failed** in a host step — ${logs}.${pr} ${retryText}`;
  if (end.outcome.kind === "done") return `Implementer run **done** — ${logs}.${pr} The reviewer has been asked to read it.`;
  return `Implementer run **${end.outcome.kind === "ceiling hit" ? "hit its ceiling" : "failed"}** — ${logs}.${pr}\n\n${end.why}\n\n${retryText}`;
};

const pausedReport = (pause: Pause, runUrl: string): AgentRunReport => ({
  block: false,
  outcome: { kind: "paused" },
  nextLabel: labels.paused,
  comment:
    `${pauseItemText(pause)} — [logs](${runUrl}). Nothing was pushed, and this is not a try. ` +
    `The requeue run restarts it as \`${triggerLabel("implement")}\` once the budget pause ends. ` +
    `${writeMarker(triggerLabel("implement"))} ${statusMarker}`,
});

export const reportAgentRun = (end: AgentRunEnd, facts: ReportFacts): AgentRunReport => {
  if (end.pause !== undefined && !facts.hostStepFailed) return pausedReport(end.pause, facts.runUrl);
  const block = facts.hostStepFailed || !end.handOffToReview;
  return {
    block,
    outcome: facts.hostStepFailed ? failedTry : end.outcome,
    nextLabel: block ? labels.blocked : triggerLabel("review"),
    comment: `${reportText(end, facts)} ${statusMarker}`,
  };
};
