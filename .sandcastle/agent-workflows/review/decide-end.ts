// Decides, after the agent and the push guard, whether the review's fixes are pushed.
//   REPO_DIR    the target repo's checkout; PUSH_BASE the PR's head before the agent ran
//   OUTPUT_DIR  holds agent-end.json and push-guard.json; gets run-end.json
// It writes `push` (true or false) to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEnd } from "../implement/run-end";
import { outputDir, required, writeJson } from "../shared/common";
import { writeOutputs } from "../shared/gh";
import { refusalText, type PushVerdict } from "../shared/push-guard";
import { decideReviewEnd } from "./review-end";

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

if (git(["status", "--porcelain"]) !== "")
  console.log("::warning::The review left uncommitted changes. Only its commits are pushed.");

const end = decideReviewEnd({
  agentEnd,
  commits: Number(git(["rev-list", "--count", `${required("PUSH_BASE")}..HEAD`])),
  ...(verdict === undefined
    ? {}
    : { guard: verdict.verdict === "push" ? verdict : { verdict: "refuse", reasons: refusalText(verdict.reasons) } }),
});

console.log(end.why || (end.push ? "The review's fixes are ready to push." : "The review made no commits. Nothing to push."));
writeJson("run-end.json", end);
writeOutputs({ push: String(end.push) });
