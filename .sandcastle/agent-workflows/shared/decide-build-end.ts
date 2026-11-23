// Decides, after a build's agent and the push guard, whether the run pushes:
// implement's agent run and implement-spec's build both end here.
//   REPO_DIR    the target repo's checkout; PUSH_BASE the commit before the agent ran
//   OUTPUT_DIR  holds agent-end.json and push-guard.json; gets run-end.json
// It writes `push` (true or false) and `handoff-label` (the label that hands the
// PR to review, or empty) to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { decideAgentRunEnd } from "./agent-run-end";
import { required, writeJson } from "./common";
import { writeOutputs } from "./gh";
import { triggerLabel } from "./labels";
import { readAgentEndFile, readGuardFacts } from "./run-files";

const git = (args: readonly string[]): string =>
  execFileSync("git", ["-C", required("REPO_DIR"), ...args], { encoding: "utf8" }).trim();

const guard = readGuardFacts();
const end = decideAgentRunEnd({
  agentEnd: readAgentEndFile().agentEnd,
  commits: Number(git(["rev-list", "--count", `${required("PUSH_BASE")}..HEAD`])),
  treeClean: git(["status", "--porcelain"]) === "",
  ...(guard === undefined ? {} : { guard }),
});

console.log(end.why || "The agent's work is ready to push.");
writeJson("run-end.json", end);
writeOutputs({ push: String(end.push), "handoff-label": end.handOffToReview ? triggerLabel("review") : "" });
