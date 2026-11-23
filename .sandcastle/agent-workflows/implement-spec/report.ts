// The agent run's last word, however it ended: on the spec after a split,
// on the ticket after a build. Comments, labels, and writes the run summary.
// A built ticket stays open: its PR's "Closes #n" closes it when the PR merges.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; MODE split or build; SPEC the spec; ISSUE the spec or the ticket
//   OUTPUT_DIR   holds agent-end.json and, for a build, run-end.json
//   JOB_STATUS   job.status; anything but success means a host step failed
//   WRITTEN      tickets the queue writer created (split)
//   PR_URL, HANDED_OFF  the draft PR and whether agent:review is on it (build)
//   RUN_URL      this run's page; STARTED_AT the job's start, in epoch seconds
//   FACTORY_REPO where the budget-pause ticket lives; FACTORY_APP_SLUG the App's slug
// A paused run pauses the spec, which restarts as agent:implement-spec, and
// opens or comments on the budget-pause ticket, so GH_TOKEN needs Issues
// write on FACTORY_REPO too.
import { hostStepFailedEnd, type AgentRunEnd } from "../shared/agent-run-end";
import { loadBudget } from "../shared/budget";
import { recordBudgetPause } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { ghApi, writeStepSummary } from "../shared/gh";
import { labels } from "../shared/labels";
import { readAgentEndFile, readJson, runSeconds, usageFacts } from "../shared/run-files";
import { renderRunSummary } from "../shared/run-summary";
import type { SpecGateMode } from "./gate-plan";
import { reportBuild, reportSplit, type BuildReport } from "./run-end";

const isMode = (mode: string): mode is SpecGateMode => mode === "split" || mode === "build";

const repo = required("TARGET_REPO");
const mode = required("MODE");
if (!isMode(mode)) throw new Error(`MODE ${mode} is neither split nor build`);
const spec = Number(required("SPEC"));
const issueNumber = Number(required("ISSUE"));
const issuePath = `repos/${repo}/issues/${issueNumber}`;
const hostStepFailed = required("JOB_STATUS") !== "success";
const runUrl = required("RUN_URL");
const agentEndFile = readAgentEndFile();

const splitReport = (): BuildReport => {
  const written = process.env.WRITTEN ? Number(process.env.WRITTEN) : undefined;
  return reportSplit({
    agentEnd: agentEndFile.agentEnd,
    ...(written === undefined ? {} : { written }),
    spec,
    hostStepFailed,
    runUrl,
  });
};

const buildReport = (): BuildReport => {
  const prUrl = process.env.PR_URL || undefined;
  return reportBuild(readJson<AgentRunEnd>("run-end.json") ?? hostStepFailedEnd, {
    ...(prUrl === undefined ? {} : { prUrl }),
    handedOff: process.env.HANDED_OFF === "true",
    hostStepFailed,
    runUrl,
    spec,
  });
};

const report = mode === "split" ? splitReport() : buildReport();

ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${report.comment}`]);
if (report.block || report.nextLabel === labels.paused)
  ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${report.nextLabel}`]);
if (report.specPause !== undefined) {
  const specPath = `repos/${repo}/issues/${spec}`;
  ghApi(["-X", "POST", `${specPath}/comments`, "-f", `body=${report.specPause.comment}`]);
  ghApi(["-X", "POST", `${specPath}/labels`, "-f", `labels[]=${report.specPause.label}`]);
}
try {
  ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(labels.inProgress)}`]);
} catch {
  console.log(`${labels.inProgress} was already off #${issueNumber}`);
}
if (report.pause !== undefined)
  recordBudgetPause(
    report.pause,
    { repo, number: mode === "split" ? issueNumber : spec, runUrl },
    { factoryRepo: required("FACTORY_REPO"), factoryAppLogin: `${required("FACTORY_APP_SLUG")}[bot]` }
  );

writeStepSummary(
  renderRunSummary({
    task: "implement-spec",
    targetRepo: repo,
    item: { kind: "issue", number: issueNumber },
    outcome: report.outcome,
    ...usageFacts(agentEndFile),
    seconds: runSeconds(new Date()),
    model: loadBudget().tasks[mode === "split" ? "implement-spec" : "implement"].model,
    ...(report.nextLabel === undefined ? {} : { nextLabel: report.nextLabel }),
  })
);
