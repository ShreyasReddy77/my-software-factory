import { failedTry, pausedComment } from "../shared/agent-end";
import { buildText, type AgentRunEnd, type BuildFacts, type BuildWording } from "../shared/agent-run-end";
import { labels, triggerLabel } from "../shared/labels";
import { statusMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type AgentRunReport = {
  readonly block: boolean;
  readonly outcome: Outcome;
  readonly nextLabel: string;
  readonly comment: string;
};

const wording: BuildWording = {
  run: "Implementer run",
  retry: `Re-add \`${triggerLabel("implement")}\` to retry, on a new branch.`,
  done: "The reviewer has been asked to read it.",
};

export const reportAgentRun = (end: AgentRunEnd, facts: BuildFacts): AgentRunReport => {
  if (end.pause !== undefined && !facts.hostStepFailed)
    return {
      block: false,
      outcome: { kind: "paused" },
      nextLabel: labels.paused,
      comment: pausedComment({ pause: end.pause, runUrl: facts.runUrl, untouched: "pushed", restartTask: "implement" }),
    };
  const block = facts.hostStepFailed || !end.handOffToReview;
  return {
    block,
    outcome: facts.hostStepFailed ? failedTry : end.outcome,
    nextLabel: block ? labels.blocked : triggerLabel("review"),
    comment: `${buildText(end, facts, wording)} ${statusMarker}`,
  };
};
