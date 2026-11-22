import type { AgentEnd } from "../implement/run-end";
import { pauseItemText, type Pause } from "../shared/budget-pause";
import { triggerLabel } from "../shared/labels";
import { statusMarker, writeMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type ExploreFinishFacts = {
  readonly agentEnd: AgentEnd | undefined;
  readonly jobResults: readonly string[];
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

// Explore retries only when a person re-adds its label, so its first failed
// try is also its last.
const failedTry: Outcome = { kind: "failed try", try: 1, of: 1 };

export const planExploreFinish = ({ agentEnd, jobResults, stillInProgress, runUrl }: ExploreFinishFacts): ExploreFinish => {
  const logs = `[logs](${runUrl})`;
  if (agentEnd?.kind === "paused")
    return {
      outcome: { kind: "paused" },
      block: [],
      pause: stillInProgress,
      pauseReason: agentEnd.pause,
      comment:
        `${pauseItemText(agentEnd.pause)} — ${logs}. Nothing was written, and this is not a try. ` +
        `The requeue run restarts it as \`${triggerLabel("explore")}\` once the budget pause ends. ` +
        `${writeMarker(triggerLabel("explore"))} ${statusMarker}`,
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
