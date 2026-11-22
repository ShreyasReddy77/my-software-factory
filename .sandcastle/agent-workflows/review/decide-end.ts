// Decides, after the agent and the push guard, whether the review's fixes are pushed.
//   REPO_DIR    the target repo's checkout; PUSH_BASE the PR's head before the agent ran
//   OUTPUT_DIR  holds agent-end.json and push-guard.json; gets run-end.json
// It writes `push` (true or false) to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { required, writeJson } from "../shared/common";
import { writeOutputs } from "../shared/gh";
import { readAgentEndFile, readGuardFacts } from "../shared/run-files";
import { decideReviewEnd } from "./review-end";

const git = (args: readonly string[]): string =>
  execFileSync("git", ["-C", required("REPO_DIR"), ...args], { encoding: "utf8" }).trim();

if (git(["status", "--porcelain"]) !== "")
  console.log("::warning::The review left uncommitted changes. Only its commits are pushed.");

const guard = readGuardFacts();
const end = decideReviewEnd({
  agentEnd: readAgentEndFile().agentEnd,
  commits: Number(git(["rev-list", "--count", `${required("PUSH_BASE")}..HEAD`])),
  ...(guard === undefined ? {} : { guard }),
});

console.log(end.why || (end.push ? "The review's fixes are ready to push." : "The review made no commits. Nothing to push."));
writeJson("run-end.json", end);
writeOutputs({ push: String(end.push) });
