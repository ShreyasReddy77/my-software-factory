import { failedTry, type AgentEnd, type GuardFacts } from "./agent-end";
import type { Pause } from "./budget-pause";
import { triggerLabel } from "./labels";
import type { Outcome } from "./run-summary";

export type AgentRunFacts = {
  readonly agentEnd: AgentEnd;
  readonly commits: number;
  readonly treeClean: boolean;
  readonly guard?: GuardFacts;
};

export type AgentRunEnd = {
  readonly push: boolean;
  readonly handOffToReview: boolean;
  readonly outcome: Outcome;
  readonly why: string;
  readonly pause?: Pause;
};

const noPush = (outcome: Outcome, why: string): AgentRunEnd => ({ push: false, handOffToReview: false, outcome, why });

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

export type BuildFacts = {
  readonly prUrl?: string;
  readonly handedOff: boolean;
  readonly hostStepFailed: boolean;
  readonly runUrl: string;
};

export type BuildWording = {
  readonly run: string;
  readonly retry: string;
  readonly done: string;
};

export const buildText = (end: AgentRunEnd, facts: BuildFacts, wording: BuildWording): string => {
  const { prUrl, handedOff, hostStepFailed, runUrl } = facts;
  const logs = `[logs](${runUrl})`;
  const pr = prUrl ? ` Draft PR: ${prUrl}.` : "";
  if (hostStepFailed && prUrl && !handedOff)
    return `${wording.run} **failed** at the hand-off to review — ${logs}.${pr} Add \`${triggerLabel("review")}\` to it to have it reviewed.`;
  if (hostStepFailed) return `${wording.run} **failed** in a host step — ${logs}.${pr} ${wording.retry}`;
  if (end.outcome.kind === "done") return `${wording.run} **done** — ${logs}.${pr} ${wording.done}`;
  const how = end.outcome.kind === "ceiling hit" ? "hit its ceiling" : "failed";
  return `${wording.run} **${how}** — ${logs}.${pr}\n\n${end.why}\n\n${wording.retry}`;
};

export const hostStepFailedEnd: AgentRunEnd = decideAgentRunEnd({
  agentEnd: { kind: "crashed", message: "a host step failed before the run's end was decided" },
  commits: 0,
  treeClean: true,
});
