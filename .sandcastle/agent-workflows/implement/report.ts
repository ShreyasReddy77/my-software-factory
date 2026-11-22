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
import * as fs from "node:fs";
import * as path from "node:path";
import { loadBudget } from "../shared/budget";
import { recordBudgetPause } from "../shared/budget-pause-github";
import { outputDir, required } from "../shared/common";
import { ghApi, writeStepSummary } from "../shared/gh";
import { labels } from "../shared/labels";
import type { RunUsage } from "../shared/result-event";
import { renderRunSummary } from "../shared/run-summary";
import { decideAgentRunEnd, reportAgentRun, type AgentRunEnd } from "./run-end";

const readJson = <T>(name: string): T | undefined => {
  const file = path.join(outputDir(), name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
};

const repo = required("TARGET_REPO");
const issueNumber = Number(required("ISSUE"));
const issuePath = `repos/${repo}/issues/${issueNumber}`;
const prUrl = process.env.PR_URL || undefined;

const end: AgentRunEnd =
  readJson<AgentRunEnd>("run-end.json") ??
  decideAgentRunEnd({
    agentEnd: { kind: "crashed", message: "a host step failed before the run's end was decided" },
    commits: 0,
    treeClean: true,
  });
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

const usage = readJson<RunUsage>("agent-end.json") ?? {};
writeStepSummary(
  renderRunSummary({
    task: "implement",
    targetRepo: repo,
    item: { kind: "issue", number: issueNumber },
    outcome: report.outcome,
    ...(usage.turns === undefined ? {} : { turns: usage.turns }),
    ...(usage.tokens === undefined ? {} : { tokens: usage.tokens }),
    seconds: Math.max(0, Math.round(Date.now() / 1000) - Number(required("STARTED_AT"))),
    model: loadBudget().tasks.implement.model,
    nextLabel: report.nextLabel,
  })
);
