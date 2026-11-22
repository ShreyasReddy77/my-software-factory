// Decides, after the agent and the push guard, whether the run pushes.
//   REPO_DIR    the target repo's checkout; PUSH_BASE the commit before the agent ran
//   OUTPUT_DIR  holds agent-end.json and push-guard.json; gets run-end.json
// It writes `push` (true or false) and `handoff-label` (the label that hands the
// PR to review, or empty) to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { outputDir, required, writeJson } from "../shared/common";
import { writeOutputs } from "../shared/gh";
import { triggerLabel } from "../shared/labels";
import { refusalText, type PushVerdict } from "../shared/push-guard";
import { decideAgentRunEnd, type AgentEnd } from "./run-end";

const git = (args: readonly string[]): string =>
  execFileSync("git", ["-C", required("REPO_DIR"), ...args], { encoding: "utf8" }).trim();

const readJson = <T>(name: string): T | undefined => {
  const file = path.join(outputDir(), name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
};

const agentEnd = readJson<{ agentEnd: AgentEnd }>("agent-end.json")?.agentEnd ?? {
  kind: "crashed",
  message: "the agent's host step recorded no end",
};
const verdict = readJson<PushVerdict>("push-guard.json");

const end = decideAgentRunEnd({
  agentEnd,
  commits: Number(git(["rev-list", "--count", `${required("PUSH_BASE")}..HEAD`])),
  treeClean: git(["status", "--porcelain"]) === "",
  ...(verdict === undefined
    ? {}
    : {
        guard: verdict.verdict === "push" ? verdict : { verdict: "refuse", reasons: refusalText(verdict.reasons) },
      }),
});

console.log(end.why || "The agent's work is ready to push.");
writeJson("run-end.json", end);
writeOutputs({ push: String(end.push), "handoff-label": end.handOffToReview ? triggerLabel("review") : "" });
