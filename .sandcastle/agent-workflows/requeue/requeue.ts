// The requeue run's host step: counts the agent runs, reads the budget-pause
// ticket and the waiting items, then closes a timed pause whose reset has
// passed and restarts waiting items into the free slots.
//   GH_TOKEN          App token for FACTORY_REPO: Issues write, Pull requests
//                     write, Actions read
//   FACTORY_REPO      owner/repo of the factory, whose items it restarts
//   FACTORY_APP_SLUG  the App's slug, from the token step
import { loadBudget } from "../shared/budget";
import { readBudgetPauseTicket } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { countAgentRuns } from "../shared/gate";
import { ghApi, writeStepSummary } from "../shared/gh";
import { ghGraphql, readLabelIds, repoVariables, writeIssues } from "../shared/gh-graphql";
import { statusMarker } from "../shared/marker";
import { renderRunSummary } from "../shared/run-summary";
import { readWorkflowRuns } from "../shared/workflow-runs-github";
import { planRequeue, type RequeueAction, type WaitingItem } from "./requeue-plan";
import { readWaitingItem, waitingLabelNames, waitingQuery, type WaitingNode } from "./waiting-items";

const startedAt = Date.now();
const now = new Date(startedAt);

const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const budget = loadBudget();

type WaitingPage = {
  repository: Record<string, { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: WaitingNode[] }>;
};

const readWaiting = (field: "issues" | "pullRequests", kind: WaitingItem["kind"]): WaitingItem[] => {
  const items: WaitingItem[] = [];
  let after: string | null = null;
  do {
    const page: WaitingPage = ghGraphql<WaitingPage>({
      query: waitingQuery(field),
      variables: { ...repoVariables(factoryRepo), labels: waitingLabelNames, after },
    });
    const connection = page.repository[field]!;
    items.push(...connection.nodes.map((node) => readWaitingItem(node, { repo: factoryRepo, kind, factoryAppLogin })));
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after !== null);
  return items;
};

const plan = planRequeue({
  budget,
  runCounts: countAgentRuns([{ repo: factoryRepo, runs: readWorkflowRuns(factoryRepo, now) }], now),
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

// Two GraphQL calls for every restart: the waiting labels come off first, then
// the trigger label goes back on, so its own gate run starts with an App label.
// A run that stops between the two leaves items as a human cancel would, never
// waiting a second time beside a run already working them.
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
