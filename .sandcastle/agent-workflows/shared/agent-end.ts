import { classifyPause, pauseItemText, type Pause } from "./budget-pause";
import { triggerLabel } from "./labels";
import { statusMarker, writeMarker } from "./marker";
import type { Outcome } from "./run-summary";
import type { AgentTask } from "./tasks";

export type AgentEnd =
  | { readonly kind: "finished" }
  | { readonly kind: "ceiling hit" | "crashed"; readonly message: string }
  | { readonly kind: "paused"; readonly pause: Pause; readonly message: string };

export type GuardFacts = { readonly verdict: "push" } | { readonly verdict: "refuse"; readonly reasons: string };

export const failedTry: Outcome = { kind: "failed try", try: 1, of: 1 };

const maxTurnsStop = /error_max_turns|max(?:imum)?[ _-]?turns/i;

export const classifyAgentEnd = (error: unknown, now: Date): AgentEnd => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "CeilingHit") return { kind: "ceiling hit", message };
  const pause = classifyPause(message, now);
  if (pause.kind !== "not a pause") return { kind: "paused", pause, message };
  if (maxTurnsStop.test(message)) return { kind: "ceiling hit", message };
  return { kind: "crashed", message };
};

export const describeAgentEnd = (agentEnd: AgentEnd): string =>
  agentEnd.kind === "finished" ? "finished" : `ended: ${agentEnd.kind}, ${agentEnd.message}`;

export type PausedCommentFacts = {
  readonly pause: Pause;
  readonly runUrl: string;
  readonly untouched: "pushed" | "written";
  readonly restartTask: AgentTask;
  readonly restartWhat?: string;
};

export const pausedComment = ({ pause, runUrl, untouched, restartTask, restartWhat = "it" }: PausedCommentFacts): string =>
  `${pauseItemText(pause)} — [logs](${runUrl}). Nothing was ${untouched}, and this is not a try. ` +
  `The requeue run restarts ${restartWhat} as \`${triggerLabel(restartTask)}\` once the budget pause ends. ` +
  `${writeMarker(triggerLabel(restartTask))} ${statusMarker}`;
