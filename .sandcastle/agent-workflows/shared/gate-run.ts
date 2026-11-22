// The gate run's host step: re-reads the item with its own App token, decides,
// and claims and starts the agent run, or queues, pauses or ends quietly.
//   GH_TOKEN          App token for TARGET_REPO: Issues write, Actions write
//   TASK              the agent task, e.g. implement
//   TARGET_REPO       owner/repo of the item; ISSUE its number
//   FACTORY_REPO      owner/repo the agent run's workflow lives in
//   FACTORY_REF       stable or main; FACTORY_SHA the commit this run pinned
//   AGENT_WORKFLOW    the agent run's workflow file, started by workflow_dispatch
//   FACTORY_APP_SLUG  the App's slug, from the token step
// It writes `claimed` (true once agent:in-progress is on) to $GITHUB_OUTPUT.
import { loadBudget } from "./budget";
import { required } from "./common";
import { decideGate, findLabeller, type IssueEvent, type Labeller, type WorkflowRun } from "./gate";
import { jobTimeoutMinutes, planGateRun, type GateAction } from "./gate-run-plan";
import { ghApi, ghPages, writeOutputs, writeStepSummary } from "./gh";
import { labels, triggerLabel } from "./labels";
import { renderRunSummary } from "./run-summary";
import { isAgentTask, lockScopes } from "./tasks";

const startedAt = Date.now();
const now = new Date(startedAt);

const taskName = required("TASK");
if (!isAgentTask(taskName)) throw new Error(`TASK ${taskName} is not an agent task`);
const task = taskName;
if (lockScopes[task] !== "ticket") throw new Error(`The gate run handles ticket locks only, not ${task}'s`);
const repo = required("TARGET_REPO");
const issueNumber = Number(required("ISSUE"));
const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const budget = loadBudget();

const issuePath = `repos/${repo}/issues/${issueNumber}`;

const readLabeller = (): Labeller | undefined => {
  const events = ghPages<IssueEvent[]>(`${issuePath}/events?per_page=100`).flat();
  const actor = findLabeller(events, triggerLabel(task));
  if (actor === undefined) return undefined;
  if (actor.type !== "User") return { ...actor, permission: "none" };
  try {
    const { permission } = ghApi([`repos/${repo}/collaborators/${actor.login}/permission`]) as { permission: string };
    return { ...actor, permission };
  } catch {
    return { ...actor, permission: "none" };
  }
};

// Yesterday onwards: in-flight runs started before midnight UTC still count.
const runListSince = (time: Date): string =>
  new Date(time.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);

const readRuns = (): WorkflowRun[] =>
  ghPages<{ workflow_runs: WorkflowRun[] }>(
    `repos/${factoryRepo}/actions/runs?per_page=100&created=>=${runListSince(now)}`
  ).flatMap((page) => page.workflow_runs);

// The budget-pause ticket arrives with the budget pause; until then no pause is open.
const readBudgetPause = (): { readonly open: boolean } => ({ open: false });

const issue = ghApi([issuePath]) as { labels: { name: string }[] };
const decision = decideGate({
  budget,
  runLists: [{ repo: factoryRepo, runs: readRuns() }],
  budgetPause: readBudgetPause(),
  task,
  item: { labels: issue.labels.map((label) => label.name), labeller: readLabeller() },
  lockKey: { scope: "ticket", repo, number: issueNumber },
  thisRunId: Number(required("GITHUB_RUN_ID")),
  factoryAppLogin,
  now,
});
console.log(`Gate decision: ${JSON.stringify(decision)}`);

const plan = planGateRun(decision, {
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

const removeLabel = (label: string): void => {
  try {
    ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(label)}`]);
  } catch {
    console.log(`${label} was already off #${issueNumber}`);
  }
};

const carryOut = (action: GateAction): void => {
  switch (action.kind) {
    case "comment":
      ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${action.body}`]);
      return;
    case "add label":
      ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${action.label}`]);
      if (action.label === labels.inProgress) writeOutputs({ claimed: "true" });
      return;
    case "remove label":
      removeLabel(action.label);
      return;
    case "dispatch agent run":
      ghApi([
        "-X", "POST", `repos/${action.factoryRepo}/actions/workflows/${action.workflow}/dispatches`,
        "-f", `ref=${action.ref}`,
        ...Object.entries(action.inputs).flatMap(([name, value]) => ["-f", `inputs[${name}]=${value}`]),
      ]);
      return;
  }
};

for (const action of plan.actions) carryOut(action);

writeStepSummary(renderRunSummary({ ...plan.record, seconds: Math.round((Date.now() - startedAt) / 1000) }));
