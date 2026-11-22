import { failedTry, pausedComment, type AgentEnd, type GuardFacts } from "../shared/agent-end";
import type { Pause } from "../shared/budget-pause";
import { labels, triggerLabel } from "../shared/labels";
import type { Outcome } from "../shared/run-summary";

export const closedTicket = (body: string | null): number | undefined => {
  const number = /\b(?:closes|fixes|resolves) #([1-9][0-9]*)/i.exec(body ?? "")?.[1];
  return number === undefined ? undefined : Number(number);
};

export type ReviewRunFacts = {
  readonly agentEnd: AgentEnd;
  readonly commits: number;
  readonly guard?: GuardFacts;
};

export type ReviewRunEnd = {
  readonly push: boolean;
  readonly outcome: Outcome;
  readonly why: string;
  readonly pause?: Pause;
};

export const decideReviewEnd = ({ agentEnd, commits, guard }: ReviewRunFacts): ReviewRunEnd => {
  if (agentEnd.kind === "paused")
    return { push: false, outcome: { kind: "paused" }, why: agentEnd.message, pause: agentEnd.pause };
  if (agentEnd.kind === "crashed") return { push: false, outcome: failedTry, why: `The agent crashed: ${agentEnd.message}` };
  const outcome: Outcome = agentEnd.kind === "ceiling hit" ? { kind: "ceiling hit" } : { kind: "done" };
  const why = agentEnd.kind === "ceiling hit" ? agentEnd.message : "";
  if (commits === 0) return { push: false, outcome, why };
  if (guard === undefined)
    return { push: false, outcome: failedTry, why: "The push guard did not scan the review's commits, so nothing was pushed." };
  if (guard.verdict === "refuse")
    return {
      push: false,
      outcome: failedTry,
      why: `The push guard refused the review's commits, so nothing was pushed.\n\n${guard.reasons}`,
    };
  return { push: true, outcome, why };
};

export type ReviewReportFacts = {
  readonly verdict: string;
  readonly pushRejected: boolean;
  readonly fallbackUrl?: string;
  readonly hostStepFailed: boolean;
  readonly branch: string;
  readonly fallbackBranch: string;
  readonly runUrl: string;
};

export type ReviewReport = {
  readonly ready: boolean;
  readonly block: boolean;
  readonly outcome: Outcome;
  readonly nextLabel?: string;
  readonly comment: string;
};

const realVerdict = (verdict: string): boolean => verdict.includes("## Standards:");

const retry = `Re-add \`${triggerLabel("review")}\` to retry.`;

const commentText = (end: ReviewRunEnd, facts: ReviewReportFacts): string => {
  const parts = [realVerdict(facts.verdict) ? facts.verdict.trim() : `The review run produced no verdict. See the logs. ${retry}`];
  if (end.why) parts.push(`${end.why}\n\n${retry}`);
  if (facts.pushRejected)
    parts.push(
      `The push of this review's fixes to \`${facts.branch}\` was **rejected**: the branch moved during this run. Nothing was force-pushed.\n` +
        `The fixes are on \`${facts.fallbackBranch}\`${facts.fallbackUrl ? `, opened as ${facts.fallbackUrl}` : ""}. ` +
        `Labelled \`${labels.blocked}\`: keep one of the two PRs.`
    );
  parts.push(
    `---\n\nReviewed by the review workflow — [logs](${facts.runUrl}). This run\nsaw the diff, the standards and the ticket, and nothing else.`
  );
  return `${parts.join("\n\n")}\n`;
};

const pausedReport = (pause: Pause, runUrl: string): ReviewReport => ({
  ready: false,
  block: false,
  outcome: { kind: "paused" },
  nextLabel: labels.paused,
  comment: pausedComment({ pause, runUrl, untouched: "pushed", restartTask: "review" }),
});

export const reportReview = (end: ReviewRunEnd, facts: ReviewReportFacts): ReviewReport => {
  if (end.pause !== undefined && !facts.hostStepFailed) return pausedReport(end.pause, facts.runUrl);
  const done = end.outcome.kind === "done" && !facts.hostStepFailed;
  const block = !done || facts.pushRejected;
  return {
    ready: done && realVerdict(facts.verdict),
    block,
    outcome: facts.hostStepFailed ? failedTry : end.outcome,
    ...(block ? { nextLabel: labels.blocked } : {}),
    comment: commentText(end, facts),
  };
};
