// The gate run's host step for review, explore and implement: re-reads the
// item with its own App token, decides, and claims and starts the agent run,
// or queues, pauses or ends quietly.
//   GH_TOKEN          App token for TARGET_REPO: Issues write, Actions write
//   TASK              the agent task, e.g. implement
//   TARGET_REPO       owner/repo of the item; ISSUE its number (a PR's number for review)
//   FACTORY_REPO      owner/repo the agent run's workflow lives in
//   FACTORY_REF       stable or main; FACTORY_SHA the commit this run pinned
//   AGENT_WORKFLOW    the agent run's entry file, started by workflow_dispatch
//   FACTORY_APP_SLUG  the App's slug, from the token step
import { loadBudget } from "./budget";
import { readBudgetPauseTicket } from "./budget-pause-github";
import { required } from "./common";
import { decideGate } from "./gate";
import { carryOutGatePlan, readLabeller, readPermission } from "./gate-run-github";
import { jobTimeoutMinutes, planGateRun, scopeShapes } from "./gate-run-plan";
import { ghApi, writeStepSummary } from "./gh";
import { ghGraphql, repoVariables } from "./gh-graphql";
import { batchQuery, chooseBatch, labellersToCheck, type BatchCandidate, type BatchIssue } from "./batch";
import { triggerLabel } from "./labels";
import { renderRunSummary } from "./run-summary";
import { isAgentTask, lockScopes } from "./tasks";
import { readWorkflowRuns } from "./workflow-runs-github";

const startedAt = Date.now();
const now = new Date(startedAt);

const taskName = required("TASK");
if (!isAgentTask(taskName)) throw new Error(`TASK ${taskName} is not an agent task`);
const task = taskName;
const repo = required("TARGET_REPO");
const issueNumber = Number(required("ISSUE"));
const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const budget = loadBudget();
const scope = scopeShapes[lockScopes[task]];

const readBatch = (trigger: BatchIssue): BatchIssue[] => {
  const data = ghGraphql<{ repository: { issues: { nodes: BatchCandidate[] } } }>({
    query: batchQuery,
    variables: { ...repoVariables(repo), label: triggerLabel(task) },
  });
  const candidates = data.repository.issues.nodes;
  const permissions = Object.fromEntries(
    labellersToCheck(candidates).map((login) => [login, readPermission(repo, login)])
  );
  const batch = chooseBatch(candidates, permissions, factoryAppLogin);
  return batch.some((issue) => issue.number === trigger.number) ? batch : [trigger, ...batch];
};

const issue = ghApi([`repos/${repo}/issues/${issueNumber}`]) as { node_id: string; labels: { name: string }[] };
const decision = decideGate({
  budget,
  runLists: [{ repo: factoryRepo, runs: readWorkflowRuns(factoryRepo, now) }],
  budgetPause: readBudgetPauseTicket(factoryRepo, factoryAppLogin),
  task,
  item: { labels: issue.labels.map((label) => label.name), labeller: readLabeller(repo, issueNumber, task) },
  lockKey: scope.lockKey(repo, issueNumber),
  thisRunId: Number(required("GITHUB_RUN_ID")),
  factoryAppLogin,
  now,
});
console.log(`Gate decision: ${JSON.stringify(decision)}`);

const batch =
  decision.kind === "proceed" && lockScopes[task] === "repo"
    ? readBatch({ id: issue.node_id, number: issueNumber })
    : undefined;

const plan = planGateRun(decision, {
  ...(batch === undefined ? {} : { batch: batch.map((member) => member.number) }),
  task,
  item: { repo, number: issueNumber },
  agentRun: {
    factoryRepo,
    workflow: required("AGENT_WORKFLOW"),
    ref: required("FACTORY_REF"),
    factorySha: required("FACTORY_SHA"),
    jobTimeoutMinutes: jobTimeoutMinutes(budget.tasks[task].agentMinutes),
  },
});

carryOutGatePlan({
  repo,
  item: issueNumber,
  actions: plan.actions,
  ...(batch === undefined ? {} : { batch }),
  retryText: `Re-add \`${triggerLabel(task)}\` to retry.`,
});

writeStepSummary(renderRunSummary({ ...plan.record, seconds: Math.round((Date.now() - startedAt) / 1000) }));
