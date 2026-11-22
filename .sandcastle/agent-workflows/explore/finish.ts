// The explore run's last word, however it ended: blocks the batch issues the
// apply job did not get to, takes agent:in-progress off, and writes the run summary.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; BATCH the gate run's batch, a JSON array of numbers
//   AGENT_END    agent-end.json from the explore job, as text, or empty
//   JOB_RESULTS  the explore and apply jobs' results, as a JSON array
//   RUN_URL      this run's page; STARTED_AT the run's start, in epoch seconds
//   FACTORY_REPO where the budget-pause ticket lives; FACTORY_APP_SLUG the App's slug
// A Claude pause labels the batch factory:paused instead and opens or comments
// on the budget-pause ticket, so GH_TOKEN needs Issues write on FACTORY_REPO too.
import type { AgentEnd } from "../shared/agent-end";
import { loadBudget } from "../shared/budget";
import { recordBudgetPause } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { writeStepSummary } from "../shared/gh";
import { readIssues, readLabelIds, writeIssues } from "../shared/gh-graphql";
import { labels } from "../shared/labels";
import type { RunUsage } from "../shared/result-event";
import { runSeconds, usageFacts } from "../shared/run-files";
import { renderRunSummary } from "../shared/run-summary";
import { planExploreFinish, type JobResult } from "./finish-plan";

type BatchState = { readonly id: string; readonly number: number; readonly labels: { readonly nodes: { readonly name: string }[] } };

const repo = required("TARGET_REPO");
const batch = JSON.parse(required("BATCH")) as number[];
const recorded = (process.env.AGENT_END ? JSON.parse(process.env.AGENT_END) : {}) as RunUsage & { agentEnd?: AgentEnd };

const states = readIssues<BatchState>(repo, batch, "id number labels(first: 100) { nodes { name } }");
const inProgress = states.filter((issue) => issue.labels.nodes.some((label) => label.name === labels.inProgress));

const finish = planExploreFinish({
  agentEnd: recorded.agentEnd,
  jobResults: JSON.parse(required("JOB_RESULTS")) as JobResult[],
  stillInProgress: inProgress.map((issue) => issue.number),
  runUrl: required("RUN_URL"),
});

if (inProgress.length > 0) {
  const ids = readLabelIds(repo, [labels.inProgress, labels.blocked, labels.paused]);
  const nextLabel = (number: number): string | undefined => {
    if (finish.block.includes(number)) return ids[labels.blocked];
    if (finish.pause.includes(number)) return ids[labels.paused];
    return undefined;
  };
  writeIssues(
    inProgress.map((issue) => {
      const next = nextLabel(issue.number);
      return {
        issueId: issue.id,
        removeLabelIds: [ids[labels.inProgress]],
        ...(next === undefined ? {} : { comment: finish.comment, addLabelIds: [next] }),
      };
    })
  );
}

const firstPaused = finish.pause[0];
if (finish.pauseReason !== undefined && firstPaused !== undefined)
  recordBudgetPause(
    finish.pauseReason,
    { repo, number: firstPaused, runUrl: required("RUN_URL") },
    { factoryRepo: required("FACTORY_REPO"), factoryAppLogin: `${required("FACTORY_APP_SLUG")}[bot]` }
  );

writeStepSummary(
  renderRunSummary({
    task: "explore",
    targetRepo: repo,
    outcome: finish.outcome,
    ...usageFacts(recorded),
    seconds: runSeconds(new Date()),
    model: loadBudget().tasks.explore.model,
    ...(finish.block.length > 0 ? { nextLabel: labels.blocked } : {}),
    ...(finish.pause.length > 0 ? { nextLabel: labels.paused } : {}),
  })
);
