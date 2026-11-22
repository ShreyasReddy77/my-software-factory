// The agent run's last word, however it ended: on the spec after a split,
// on the ticket after a build. Comments, labels, closes a built ticket, and
// writes the run summary.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; MODE split or build; SPEC the spec; ISSUE the spec or the ticket
//   OUTPUT_DIR   holds agent-end.json and, for a build, run-end.json
//   JOB_STATUS   job.status; anything but success means a host step failed
//   WRITTEN      tickets the queue writer created (split)
//   PR_URL, HANDED_OFF  the draft PR and whether agent:review is on it (build)
//   RUN_URL      this run's page; STARTED_AT the job's start, in epoch seconds
import * as fs from "node:fs";
import * as path from "node:path";
import { decideAgentRunEnd, type AgentEnd, type AgentRunEnd } from "../implement/run-end";
import { loadBudget } from "../shared/budget";
import { outputDir, required } from "../shared/common";
import { ghApi, writeStepSummary } from "../shared/gh";
import { labels } from "../shared/labels";
import type { RunUsage } from "../shared/result-event";
import { renderRunSummary } from "../shared/run-summary";
import { reportBuild, reportSplit, type BuildReport, type SpecRunReport } from "./run-end";

const readJson = <T>(name: string): T | undefined => {
  const file = path.join(outputDir(), name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
};

const repo = required("TARGET_REPO");
const mode = required("MODE");
if (mode !== "split" && mode !== "build") throw new Error(`MODE ${mode} is neither split nor build`);
const spec = Number(required("SPEC"));
const issueNumber = Number(required("ISSUE"));
const issuePath = `repos/${repo}/issues/${issueNumber}`;
const hostStepFailed = required("JOB_STATUS") !== "success";
const runUrl = required("RUN_URL");
const usage = readJson<RunUsage & { agentEnd?: AgentEnd }>("agent-end.json") ?? {};

const splitReport = (): SpecRunReport => {
  const written = process.env.WRITTEN ? Number(process.env.WRITTEN) : undefined;
  return reportSplit({
    agentEnd: usage.agentEnd ?? { kind: "crashed", message: "the split's host step recorded no end" },
    ...(written === undefined ? {} : { written }),
    spec,
    hostStepFailed,
    runUrl,
  });
};

const buildReport = (): BuildReport => {
  const end: AgentRunEnd =
    readJson<AgentRunEnd>("run-end.json") ??
    decideAgentRunEnd({
      agentEnd: { kind: "crashed", message: "a host step failed before the run's end was decided" },
      commits: 0,
      treeClean: true,
    });
  const prUrl = process.env.PR_URL || undefined;
  return reportBuild(end, {
    ...(prUrl === undefined ? {} : { prUrl }),
    handedOff: process.env.HANDED_OFF === "true",
    hostStepFailed,
    runUrl,
    spec,
  });
};

const report: SpecRunReport & { close?: boolean } = mode === "split" ? splitReport() : buildReport();

ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${report.comment}`]);
if (report.block) ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${labels.blocked}`]);
try {
  ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(labels.inProgress)}`]);
} catch {
  console.log(`${labels.inProgress} was already off #${issueNumber}`);
}
if (report.close) ghApi(["-X", "PATCH", issuePath, "-f", "state=closed"]);

writeStepSummary(
  renderRunSummary({
    task: "implement-spec",
    targetRepo: repo,
    item: { kind: "issue", number: issueNumber },
    outcome: report.outcome,
    ...(usage.turns === undefined ? {} : { turns: usage.turns }),
    ...(usage.tokens === undefined ? {} : { tokens: usage.tokens }),
    seconds: Math.max(0, Math.round(Date.now() / 1000) - Number(required("STARTED_AT"))),
    model: loadBudget().tasks[mode === "split" ? "implement-spec" : "implement"].model,
    ...(report.nextLabel === undefined ? {} : { nextLabel: report.nextLabel }),
  })
);
