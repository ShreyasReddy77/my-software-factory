// The requeue run's host step: counts the agent runs, reads the budget-pause
// ticket and the waiting items, then closes a timed pause whose reset has
// passed and restarts waiting items into the free slots.
//   GH_TOKEN          App token for FACTORY_REPO: Issues write, Pull requests
//                     write, Actions read
//   FACTORY_REPO      owner/repo of the factory, whose items it restarts
//   FACTORY_APP_SLUG  the App's slug, from the token step
//   FINISHING_RUN_ID  optional: the agent run whose last job started this run,
//                     which is not counted as in flight
import { loadBudget } from "../shared/budget";
import { readBudgetPauseTicket } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { countAgentRuns } from "../shared/gate";
import { ghApi, writeStepSummary } from "../shared/gh";
import { ghGraphql, readAllPages, readLabelIds, repoVariables, writeIssues, type Connection } from "../shared/gh-graphql";
import { waitingLabels } from "../shared/labels";
import { statusMarker } from "../shared/marker";
import { renderRunSummary } from "../shared/run-summary";
import { readWorkflowRuns } from "../shared/workflow-runs-github";
import { planRequeue, type RequeueAction, type WaitingItem } from "./requeue-plan";
import {
  earlierCommentsQuery,
  readWaitingItem,
  waitingQuery,
  type WaitingComments,
  type WaitingNode,
} from "./waiting-items";

const startedAt = Date.now();
const now = new Date(startedAt);

const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const finishingRunId = process.env.FINISHING_RUN_ID ? Number(process.env.FINISHING_RUN_ID) : undefined;
const budget = loadBudget();

const withEveryComment = (node: WaitingNode): WaitingNode => {
  const nodes = [...node.comments.nodes];
  let pageInfo = node.comments.pageInfo;
  while (pageInfo?.hasPreviousPage) {
    const page: WaitingComments = ghGraphql<{ node: { comments: WaitingComments } }>({
      query: earlierCommentsQuery,
      variables: { id: node.id, before: pageInfo.startCursor },
    }).node.comments;
    nodes.unshift(...page.nodes);
    pageInfo = page.pageInfo;
  }
  return { ...node, comments: { nodes } };
};

const readWaiting = (field: "issues" | "pullRequests", kind: WaitingItem["kind"]): WaitingItem[] =>
  readAllPages<{ repository: Record<string, Connection<WaitingNode>> }, WaitingNode>(
    { query: waitingQuery(field), variables: { ...repoVariables(factoryRepo), labels: waitingLabels } },
    (data) => data.repository[field]!
  ).map((node) => {
    const context = { repo: factoryRepo, kind, factoryAppLogin };
    const item = readWaitingItem(node, context);
    return item.restartAs === undefined && node.comments.pageInfo?.hasPreviousPage
      ? readWaitingItem(withEveryComment(node), context)
      : item;
  });

const plan = planRequeue({
  budget,
  runCounts: countAgentRuns([{ repo: factoryRepo, runs: readWorkflowRuns(factoryRepo, now) }], now, {
    ...(finishingRunId === undefined ? {} : { finishingRunId }),
  }),
  waiting: [...readWaiting("issues", "issue"), ...readWaiting("pullRequests", "pr")],
  budgetPause: readBudgetPauseTicket(factoryRepo, factoryAppLogin),
  now,
});
console.log(`Requeue plan: ${JSON.stringify(plan.actions)}`);

const closePauseTicket = (ticket: number): void => {
  ghApi([
    "-X", "POST", `repos/${factoryRepo}/issues/${ticket}/comments`,
    "-f", `body=The reset has passed, so the requeue run closed this pause and restarts paused work. ${statusMarker}`,
  ]);
  ghApi(["-X", "PATCH", `repos/${factoryRepo}/issues/${ticket}`, "-f", "state=closed", "-f", "state_reason=completed"]);
};

// Order: docs/factory-v1.md, "Requeue run".
const restart = (restarts: readonly Extract<RequeueAction, { kind: "restart" }>[]): void => {
  if (restarts.length === 0) return;
  const names = [...new Set(restarts.flatMap((action) => [action.add, ...action.remove]))];
  const ids = readLabelIds(factoryRepo, names);
  const id = (name: string): string => {
    const labelId = ids[name];
    if (labelId === undefined) throw new Error(`No label id for ${name}`);
    return labelId;
  };
  writeIssues(restarts.map((action) => ({ issueId: action.item.id, removeLabelIds: action.remove.map(id) })));
  writeIssues(restarts.map((action) => ({ issueId: action.item.id, addLabelIds: [id(action.add)] })));
};

for (const action of plan.actions) if (action.kind === "close pause ticket") closePauseTicket(action.ticket);
restart(plan.actions.filter((action) => action.kind === "restart"));

writeStepSummary(
  renderRunSummary({
    task: "requeue",
    targetRepo: factoryRepo,
    outcome: { kind: "done" },
    seconds: Math.round((Date.now() - startedAt) / 1000),
    gauge: plan.gauge,
  })
);
