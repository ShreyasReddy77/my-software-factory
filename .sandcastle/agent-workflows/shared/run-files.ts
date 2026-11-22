// What an agent run's host steps leave for each other in OUTPUT_DIR, read
// back by the steps after them.
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEnd, GuardFacts } from "./agent-end";
import { outputDir, required } from "./common";
import { refusalText, type PushVerdict } from "./push-guard";
import type { RunUsage } from "./result-event";

export const readJson = <T>(name: string): T | undefined => {
  const file = path.join(outputDir(), name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
};

export type AgentEndFile = RunUsage & { readonly agentEnd: AgentEnd };

export const readAgentEndFile = (): AgentEndFile =>
  readJson<AgentEndFile>("agent-end.json") ?? {
    agentEnd: { kind: "crashed", message: "the agent's host step recorded no end" },
  };

export const readGuardFacts = (): GuardFacts | undefined => {
  const verdict = readJson<PushVerdict>("push-guard.json");
  if (verdict === undefined) return undefined;
  return verdict.verdict === "push" ? verdict : { verdict: "refuse", reasons: refusalText(verdict.reasons) };
};

export const usageFacts = ({ turns, tokens }: RunUsage): RunUsage => ({
  ...(turns === undefined ? {} : { turns }),
  ...(tokens === undefined ? {} : { tokens }),
});

export const runSeconds = (now: Date): number =>
  Math.max(0, Math.round(now.getTime() / 1000) - Number(required("STARTED_AT")));
