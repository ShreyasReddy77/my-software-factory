// The explore run's last word, however it ended: blocks the batch issues the
// apply job did not get to, takes agent:in-progress off, and writes the run summary.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; BATCH the gate run's batch, a JSON array of numbers
//   AGENT_END    agent-end.json from the explore job, as text, or empty
//   JOB_RESULTS  the explore and apply jobs' results, as a JSON array
//   RUN_URL      this run's page; STARTED_AT the run's start, in epoch seconds
import type { AgentEnd } from "../implement/run-end";
import { loadBudget } from "../shared/budget";
import { required } from "../shared/common";
import { writeStepSummary } from "../shared/gh";
import { readIssues, readLabelIds, writeIssues } from "../shared/gh-graphql";
import { labels } from "../shared/labels";
import type { RunUsage } from "../shared/result-event";
import { renderRunSummary } from "../shared/run-summary";
import { planExploreFinish } from "./finish-plan";

type BatchState = { readonly id: string; readonly number: number; readonly labels: { readonly nodes: { readonly name: string }[] } };

const repo = required("TARGET_REPO");
const batch = JSON.parse(required("BATCH")) as number[];
const recorded = (process.env.AGENT_END ? JSON.parse(process.env.AGENT_END) : {}) as RunUsage & { agentEnd?: AgentEnd };

const states = readIssues<BatchState>(repo, batch, "id number labels(first: 100) { nodes { name } }");
const inProgress = states.filter((issue) => issue.labels.nodes.some((label) => label.name === labels.inProgress));

const finish = planExploreFinish({
  agentEnd: recorded.agentEnd,
  jobResults: JSON.parse(required("JOB_RESULTS")) as string[],
  stillInProgress: inProgress.map((issue) => issue.number),
  runUrl: required("RUN_URL"),
});

if (inProgress.length > 0) {
  const ids = readLabelIds(repo, [labels.inProgress, labels.blocked]);
  writeIssues(
    inProgress.map((issue) => {
      const block = finish.block.includes(issue.number);
      return {
        issueId: issue.id,
        removeLabelIds: [ids[labels.inProgress]],
        ...(block ? { comment: finish.comment, addLabelIds: [ids[labels.blocked]] } : {}),
      };
    })
  );
}

writeStepSummary(
  renderRunSummary({
    task: "explore",
    targetRepo: repo,
    outcome: finish.outcome,
    ...(recorded.turns === undefined ? {} : { turns: recorded.turns }),
    ...(recorded.tokens === undefined ? {} : { tokens: recorded.tokens }),
    seconds: Math.max(0, Math.round(Date.now() / 1000) - Number(required("STARTED_AT"))),
    model: loadBudget().tasks.explore.model,
    ...(finish.block.length > 0 ? { nextLabel: labels.blocked } : {}),
  })
);
