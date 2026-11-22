import type { AgentEnd, AgentRunEnd } from "../implement/run-end";
import { pauseItemText, type Pause } from "../shared/budget-pause";
import { labels, specQueueLabel, triggerLabel } from "../shared/labels";
import { statusMarker, writeMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type SpecRunReport = {
  readonly block: boolean;
  readonly outcome: Outcome;
  readonly nextLabel?: string;
  readonly comment: string;
  // Set when Claude's limit paused the run: the budget-pause ticket records it.
  readonly pause?: Pause;
};

// A run retries only when a person re-adds the label, so its first failed
// try is also its last.
const failedTry: Outcome = { kind: "failed try", try: 1, of: 1 };

const trigger = triggerLabel("implement-spec");

// A paused split or build restarts from the spec, never from the ticket.
const restartText = `The requeue run restarts the spec as \`${trigger}\` once the budget pause ends. ${writeMarker(trigger)} ${statusMarker}`;

export type SplitFacts = {
  readonly agentEnd: AgentEnd;
  // Tickets the queue writer created; absent when it never ran.
  readonly written?: number;
  readonly spec: number;
  readonly hostStepFailed: boolean;
  readonly runUrl: string;
};

export const reportSplit = ({ agentEnd, written, spec, hostStepFailed, runUrl }: SplitFacts): SpecRunReport => {
  const logs = `[logs](${runUrl})`;
  const blocked = (outcome: Outcome, why: string): SpecRunReport => ({
    block: true,
    outcome,
    nextLabel: labels.blocked,
    comment: `Split **${outcome.kind === "ceiling hit" ? "hit its ceiling" : "failed"}** — ${logs}.\n\n${why}\n\nRe-add \`${trigger}\` to retry. ${statusMarker}`,
  });
  if (agentEnd.kind === "paused")
    return {
      block: false,
      outcome: { kind: "paused" },
      nextLabel: labels.paused,
      pause: agentEnd.pause,
      comment: `${pauseItemText(agentEnd.pause)} — ${logs}. Nothing was written, and this is not a try. ${restartText}`,
    };
  if (agentEnd.kind !== "finished")
    return blocked(agentEnd.kind === "ceiling hit" ? { kind: "ceiling hit" } : failedTry, agentEnd.message);
  if (hostStepFailed || written === undefined || written === 0)
    return blocked(failedTry, "A host step failed before the queue was written in full. Check the queue for partial tickets before retrying.");
  return {
    block: false,
    outcome: { kind: "done" },
    comment:
      `Split into ${written} tickets labelled \`${specQueueLabel(spec)}\` — ${logs}. ` +
      `Review and edit them. Re-add \`${trigger}\` to build the first ready ticket; each label builds one. ${statusMarker}`,
  };
};

export type BuildFacts = {
  readonly prUrl?: string;
  readonly handedOff: boolean;
  readonly hostStepFailed: boolean;
  readonly runUrl: string;
  readonly spec: number;
};

export type BuildReport = SpecRunReport & {
  // Closing the ticket is what moves the queue on, until the PR loop counts
  // a ticket done only when its PR merges.
  readonly close: boolean;
  // On a pause the spec, not the ticket, waits to be restarted.
  readonly specPause?: { readonly label: string; readonly comment: string };
};

const buildText = (end: AgentRunEnd, { prUrl, handedOff, hostStepFailed, runUrl, spec }: BuildFacts): string => {
  const logs = `[logs](${runUrl})`;
  const pr = prUrl ? ` Draft PR: ${prUrl}.` : "";
  const retry = `Take \`${labels.blocked}\` off this ticket and re-add \`${trigger}\` to #${spec} to build it again, on a new branch.`;
  if (hostStepFailed && prUrl && !handedOff)
    return `Implement-spec build **failed** at the hand-off to review — ${logs}.${pr} Add \`${triggerLabel("review")}\` to it to have it reviewed.`;
  if (hostStepFailed) return `Implement-spec build **failed** in a host step — ${logs}.${pr} ${retry}`;
  if (end.outcome.kind === "done")
    return `Implement-spec build **done** — ${logs}.${pr} The reviewer has been asked to read it. Closing this ticket so the queue moves on.`;
  return `Implement-spec build **${end.outcome.kind === "ceiling hit" ? "hit its ceiling" : "failed"}** — ${logs}.${pr}\n\n${end.why}\n\n${retry}`;
};

export const reportBuild = (end: AgentRunEnd, facts: BuildFacts): BuildReport => {
  if (end.pause !== undefined && !facts.hostStepFailed) {
    const text = `${pauseItemText(end.pause)} — [logs](${facts.runUrl}).`;
    return {
      block: false,
      close: false,
      outcome: { kind: "paused" },
      pause: end.pause,
      comment: `${text} Nothing was pushed, and this is not a try. The next build of spec #${facts.spec} picks this ticket up again. ${statusMarker}`,
      specPause: { label: labels.paused, comment: `${text} While building a queue ticket. ${restartText}` },
    };
  }
  const block = facts.hostStepFailed || !end.handOffToReview;
  return {
    block,
    close: !block && facts.handedOff,
    outcome: facts.hostStepFailed ? failedTry : end.outcome,
    nextLabel: block ? labels.blocked : triggerLabel("review"),
    comment: `${buildText(end, facts)} ${statusMarker}`,
  };
};
