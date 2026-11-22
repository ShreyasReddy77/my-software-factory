// Implement-spec's gate run host step: re-reads the spec with its own App
// token, gates it, reads its queue, then splits the spec or claims and builds
// the queue's next ready ticket, or queues, pauses or ends quietly.
//   GH_TOKEN          App token for TARGET_REPO: Issues write, Actions write
//   TARGET_REPO       owner/repo of the spec; ISSUE the spec's number
//   FACTORY_REPO      owner/repo the agent run's workflow lives in
//   FACTORY_REF       stable or main; FACTORY_SHA the commit this run pinned
//   AGENT_WORKFLOW    the agent run's entry file, started by workflow_dispatch
//   FACTORY_APP_SLUG  the App's slug, from the token step
import { loadBudget } from "../shared/budget";
import { readBudgetPauseTicket } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { decideGate } from "../shared/gate";
import { carryOutGatePlan, readLabeller } from "../shared/gate-run-github";
import { ghApi, writeStepSummary } from "../shared/gh";
import { readAllPages, repoVariables, type Connection } from "../shared/gh-graphql";
import { labels, specQueueLabel, triggerLabel } from "../shared/labels";
import { renderRunSummary } from "../shared/run-summary";
import { readWorkflowRuns } from "../shared/workflow-runs-github";
import { planSpecGate } from "./gate-plan";
import { surveyQueue, type QueueIssue } from "./queue";

const startedAt = Date.now();
const now = new Date(startedAt);
const task = "implement-spec";

const repo = required("TARGET_REPO");
const spec = Number(required("ISSUE"));
const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const budget = loadBudget();
const runs = readWorkflowRuns(factoryRepo, now);
const budgetPause = readBudgetPauseTicket(factoryRepo, factoryAppLogin);

type QueueNode = {
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly body: string;
  readonly labels: { readonly nodes: readonly { readonly name: string }[] };
  readonly closedByPullRequestsReferences: { readonly totalCount: number };
};

const queueQuery = `query($owner: String!, $name: String!, $label: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, labels: [$label], states: [OPEN, CLOSED]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state body
        labels(first: 100) { nodes { name } }
        closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount }
      }
    }
  }
}`;

const readQueue = (): QueueIssue[] =>
  readAllPages<{ repository: { issues: Connection<QueueNode> } }, QueueNode>(
    { query: queueQuery, variables: { ...repoVariables(repo), label: specQueueLabel(spec) } },
    (data) => data.repository.issues
  ).map((node) => ({
    number: node.number,
    state: node.state === "OPEN" ? "open" : "closed",
    body: node.body,
    labels: node.labels.nodes.map((label) => label.name),
    openPullRequests: node.closedByPullRequestsReferences.totalCount,
  }));

const specIssue = ghApi([`repos/${repo}/issues/${spec}`]) as { labels: { name: string }[] };
const item = { labels: specIssue.labels.map((label) => label.name), labeller: readLabeller(repo, spec, task) };

const plan = planSpecGate({
  spec: { repo, number: spec },
  decide: (lockKey) => {
    const decision = decideGate({
      budget,
      runLists: [{ repo: factoryRepo, runs }],
      budgetPause,
      task,
      item,
      lockKey,
      thisRunId: Number(required("GITHUB_RUN_ID")),
      factoryAppLogin,
      now,
    });
    console.log(`Gate decision for ${JSON.stringify(lockKey)}: ${JSON.stringify(decision)}`);
    return decision;
  },
  survey: () => {
    const survey = surveyQueue(readQueue());
    console.log(`Queue survey: ${JSON.stringify(survey)}`);
    return survey;
  },
  agentRun: {
    factoryRepo,
    workflow: required("AGENT_WORKFLOW"),
    ref: required("FACTORY_REF"),
    factorySha: required("FACTORY_SHA"),
  },
  agentMinutes: { split: budget.tasks["implement-spec"].agentMinutes, build: budget.tasks.implement.agentMinutes },
});

carryOutGatePlan({
  repo,
  item: spec,
  actions: plan.actions,
  retryText: `Take \`${labels.blocked}\` off and re-add \`${triggerLabel(task)}\` to spec #${spec} to retry.`,
});

writeStepSummary(renderRunSummary({ ...plan.record, seconds: Math.round((Date.now() - startedAt) / 1000) }));
