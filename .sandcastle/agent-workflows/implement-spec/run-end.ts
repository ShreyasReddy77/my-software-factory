import { failedTry, pausedComment, type AgentEnd } from "../shared/agent-end";
import { buildText, type AgentRunEnd, type BuildFacts, type BuildWording } from "../shared/agent-run-end";
import { pauseItemText, type Pause } from "../shared/budget-pause";
import { labels, specQueueLabel, triggerLabel } from "../shared/labels";
import { statusMarker, writeMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type SpecRunReport = {
  readonly block: boolean;
  readonly outcome: Outcome;
  readonly nextLabel?: string;
  readonly comment: string;
  readonly pause?: Pause;
};

const trigger = triggerLabel("implement-spec");

export type SplitFacts = {
  readonly agentEnd: AgentEnd;
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
      comment: pausedComment({
        pause: agentEnd.pause,
        runUrl,
        untouched: "written",
        restartTask: "implement-spec",
        restartWhat: "the spec",
      }),
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

export type SpecBuildFacts = BuildFacts & { readonly spec: number };

export type BuildReport = SpecRunReport & {
  readonly specPause?: { readonly label: string; readonly comment: string };
};

const wording = (spec: number): BuildWording => ({
  run: "Implement-spec build",
  retry: `Take \`${labels.blocked}\` off this ticket and re-add \`${trigger}\` to #${spec} to build it again, on a new branch.`,
  done: "The reviewer has been asked to read it. This ticket closes when its PR merges, and the queue moves on then.",
});

export const reportBuild = (end: AgentRunEnd, facts: SpecBuildFacts): BuildReport => {
  if (end.pause !== undefined && !facts.hostStepFailed) {
    const text = `${pauseItemText(end.pause)} — [logs](${facts.runUrl}).`;
    return {
      block: false,
      outcome: { kind: "paused" },
      pause: end.pause,
      comment: `${text} Nothing was pushed, and this is not a try. The next build of spec #${facts.spec} picks this ticket up again. ${statusMarker}`,
      specPause: {
        label: labels.paused,
        comment:
          `${text} While building a queue ticket. The requeue run restarts the spec as \`${trigger}\` ` +
          `once the budget pause ends. ${writeMarker(trigger)} ${statusMarker}`,
      },
    };
  }
  const block = facts.hostStepFailed || !end.handOffToReview;
  return {
    block,
    outcome: facts.hostStepFailed ? failedTry : end.outcome,
    nextLabel: block ? labels.blocked : triggerLabel("review"),
    comment: `${buildText(end, facts, wording(facts.spec))} ${statusMarker}`,
  };
};
