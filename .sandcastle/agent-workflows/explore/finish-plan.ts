import type { AgentEnd } from "../implement/run-end";
import { triggerLabel } from "../shared/labels";
import { statusMarker } from "../shared/marker";
import type { Outcome } from "../shared/run-summary";

export type ExploreFinishFacts = {
  readonly agentEnd: AgentEnd | undefined;
  readonly jobResults: readonly string[];
  readonly stillInProgress: readonly number[];
  readonly runUrl: string;
};

export type ExploreFinish = {
  readonly outcome: Outcome;
  readonly block: readonly number[];
  readonly comment: string;
};

// Explore retries only when a person re-adds its label, so its first failed
// try is also its last.
const failedTry: Outcome = { kind: "failed try", try: 1, of: 1 };

export const planExploreFinish = ({ agentEnd, jobResults, stillInProgress, runUrl }: ExploreFinishFacts): ExploreFinish => {
  const ok = agentEnd?.kind === "finished" && jobResults.every((result) => result === "success");
  if (ok) return { outcome: { kind: "done" }, block: [], comment: "" };
  const ceiling = agentEnd?.kind === "ceiling hit";
  return {
    outcome: ceiling ? { kind: "ceiling hit" } : failedTry,
    block: stillInProgress,
    comment:
      `Explore run **${ceiling ? "hit its ceiling" : "failed"}** — [logs](${runUrl}). ` +
      `Re-add \`${triggerLabel("explore")}\` to retry. ${statusMarker}`,
  };
};
