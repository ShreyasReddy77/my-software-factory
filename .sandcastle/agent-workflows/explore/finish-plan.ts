import { failedTry, pausedComment, type AgentEnd } from "../shared/agent-end";
import type { Pause } from "../shared/budget-pause";
import { triggerLabel } from "../shared/labels";
import { statusMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type JobResult = "success" | "failure" | "cancelled" | "skipped";

export type ExploreFinishFacts = {
  readonly agentEnd: AgentEnd | undefined;
  readonly jobResults: readonly JobResult[];
  readonly stillInProgress: readonly number[];
  readonly runUrl: string;
};

// Each issue still in progress is blocked, paused, or (on success) just released.
export type ExploreFinish = {
  readonly outcome: Outcome;
  readonly block: readonly number[];
  readonly pause: readonly number[];
  readonly pauseReason?: Pause;
  readonly comment: string;
};

export const planExploreFinish = ({ agentEnd, jobResults, stillInProgress, runUrl }: ExploreFinishFacts): ExploreFinish => {
  const logs = `[logs](${runUrl})`;
  if (agentEnd?.kind === "paused")
    return {
      outcome: { kind: "paused" },
      block: [],
      pause: stillInProgress,
      pauseReason: agentEnd.pause,
      comment: pausedComment({ pause: agentEnd.pause, runUrl, untouched: "written", restartTask: "explore" }),
    };
  const ok = agentEnd?.kind === "finished" && jobResults.every((result) => result === "success");
  if (ok) return { outcome: { kind: "done" }, block: [], pause: [], comment: "" };
  const ceiling = agentEnd?.kind === "ceiling hit";
  return {
    outcome: ceiling ? { kind: "ceiling hit" } : failedTry,
    block: stillInProgress,
    pause: [],
    comment:
      `Explore run **${ceiling ? "hit its ceiling" : "failed"}** — ${logs}. ` +
      `Re-add \`${triggerLabel("explore")}\` to retry. ${statusMarker}`,
  };
};
