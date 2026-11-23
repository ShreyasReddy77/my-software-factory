// The review run's last word on its PR, however it ended: the verdict, the
// inline comments, ready or not, the labels and the run summary.
//   GH_TOKEN         App token for TARGET_REPO: Pull requests write, Issues write
//   TARGET_REPO      owner/repo; PR the pull request's number
//   AGENT_IO_DIR     holds review-verdict.md when the agent wrote one
//   OUTPUT_DIR       holds agent-end.json, run-end.json and review-comments.json when those steps ran
//   BRANCH, FALLBACK_BRANCH  the PR's branch, and where rejected fixes went
//   PUSH_REJECTED    true when the push to BRANCH was rejected; FALLBACK_PR its draft PR's number
//   JOB_STATUS       job.status; anything but success means a host step failed
//   RUN_URL          this run's page; STARTED_AT the job's start, in epoch seconds
//   FACTORY_REPO     where the budget-pause ticket lives; FACTORY_APP_SLUG the App's slug
// A paused run also opens or comments on the budget-pause ticket, so GH_TOKEN
// needs Issues write on FACTORY_REPO too.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadBudget } from "../shared/budget";
import { recordBudgetPause } from "../shared/budget-pause-github";
import { outputDir, required } from "../shared/common";
import { ghApi, writeStepSummary } from "../shared/gh";
import { labels } from "../shared/labels";
import { readAgentEndFile, readJson, runSeconds, usageFacts } from "../shared/run-files";
import { renderRunSummary } from "../shared/run-summary";
import { decideReviewEnd, reportReview, type ReviewRunEnd } from "./review-end";

const repo = required("TARGET_REPO");
const prNumber = Number(required("PR"));
const issuePath = `repos/${repo}/issues/${prNumber}`;
const verdictFile = path.join(required("AGENT_IO_DIR"), "review-verdict.md");
const fallbackPr = process.env.FALLBACK_PR || undefined;
const runUrl = required("RUN_URL");

const end: ReviewRunEnd =
  readJson<ReviewRunEnd>("run-end.json") ??
  decideReviewEnd({ agentEnd: { kind: "crashed", message: "a host step failed before the run's end was decided" }, commits: 0 });
const report = reportReview(end, {
  verdict: fs.existsSync(verdictFile) ? fs.readFileSync(verdictFile, "utf8") : "",
  pushRejected: process.env.PUSH_REJECTED === "true",
  ...(fallbackPr === undefined ? {} : { fallbackUrl: `https://github.com/${repo}/pull/${fallbackPr}` }),
  hostStepFailed: required("JOB_STATUS") !== "success",
  branch: required("BRANCH"),
  fallbackBranch: required("FALLBACK_BRANCH"),
  runUrl,
});

ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${report.comment}`]);

const reviewFile = path.join(outputDir(), "review-comments.json");
const review = readJson<{ comments: unknown[] }>("review-comments.json");
if (review && review.comments.length > 0)
  ghApi(["-X", "POST", `repos/${repo}/pulls/${fallbackPr ?? prNumber}/reviews`, "--input", reviewFile]);
else console.log("No inline comments: the review fixed or passed everything.");

if (report.ready) execFileSync("gh", ["pr", "ready", String(prNumber), "--repo", repo], { stdio: "inherit" });
else console.log("No verdict, or the run did not finish, so the PR stays a draft.");

if (report.nextLabel !== undefined) ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${report.nextLabel}`]);
try {
  ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(labels.inProgress)}`]);
} catch {
  console.log(`${labels.inProgress} was already off #${prNumber}`);
}

if (report.outcome.kind === "paused" && end.pause !== undefined)
  recordBudgetPause(
    end.pause,
    { repo, number: prNumber, runUrl },
    { factoryRepo: required("FACTORY_REPO"), factoryAppLogin: `${required("FACTORY_APP_SLUG")}[bot]` }
  );

writeStepSummary(
  renderRunSummary({
    task: "review",
    targetRepo: repo,
    item: { kind: "pr", number: prNumber },
    outcome: report.outcome,
    ...usageFacts(readAgentEndFile()),
    seconds: runSeconds(new Date()),
    model: loadBudget().tasks.review.model,
    ...(report.nextLabel === undefined ? {} : { nextLabel: report.nextLabel }),
  })
);
