// The agent run's last word on its ticket: the comment, the labels and the
// run summary, however the run ended.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; ISSUE the ticket's number
//   OUTPUT_DIR   holds agent-end.json and run-end.json when those steps ran
//   JOB_STATUS   job.status; anything but success means a host step failed
//   PR_URL       the draft PR, when one was opened; HANDED_OFF true once agent:review is on it
//   RUN_URL      this run's page; STARTED_AT the job's start, in epoch seconds
//   FACTORY_REPO where the budget-pause ticket lives; FACTORY_APP_SLUG the App's slug
// A paused run also opens or comments on the budget-pause ticket, so GH_TOKEN
// needs Issues write on FACTORY_REPO too.
import { hostStepFailedEnd, type AgentRunEnd } from "../shared/agent-run-end";
import { loadBudget } from "../shared/budget";
import { recordBudgetPause } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { ghApi, writeStepSummary } from "../shared/gh";
import { labels } from "../shared/labels";
import { readAgentEndFile, readJson, runSeconds, usageFacts } from "../shared/run-files";
import { renderRunSummary } from "../shared/run-summary";
import { reportAgentRun } from "./run-end";

const repo = required("TARGET_REPO");
const issueNumber = Number(required("ISSUE"));
const issuePath = `repos/${repo}/issues/${issueNumber}`;
const prUrl = process.env.PR_URL || undefined;

const end = readJson<AgentRunEnd>("run-end.json") ?? hostStepFailedEnd;
const report = reportAgentRun(end, {
  ...(prUrl === undefined ? {} : { prUrl }),
  handedOff: process.env.HANDED_OFF === "true",
  hostStepFailed: required("JOB_STATUS") !== "success",
  runUrl: required("RUN_URL"),
});

ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${report.comment}`]);
if (report.block || report.nextLabel === labels.paused)
  ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${report.nextLabel}`]);
try {
  ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(labels.inProgress)}`]);
} catch {
  console.log(`${labels.inProgress} was already off #${issueNumber}`);
}

if (report.outcome.kind === "paused" && end.pause !== undefined)
  recordBudgetPause(
    end.pause,
    { repo, number: issueNumber, runUrl: required("RUN_URL") },
    { factoryRepo: required("FACTORY_REPO"), factoryAppLogin: `${required("FACTORY_APP_SLUG")}[bot]` }
  );

writeStepSummary(
  renderRunSummary({
    task: "implement",
    targetRepo: repo,
    item: { kind: "issue", number: issueNumber },
    outcome: report.outcome,
    ...usageFacts(readAgentEndFile()),
    seconds: runSeconds(new Date()),
    model: loadBudget().tasks.implement.model,
    nextLabel: report.nextLabel,
  })
);
