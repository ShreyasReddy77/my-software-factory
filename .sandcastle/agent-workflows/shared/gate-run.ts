// The gate run's host step: re-reads the item with its own App token, decides,
// and claims and starts the agent run, or queues, pauses or ends quietly.
//   GH_TOKEN          App token for TARGET_REPO: Issues write, Actions write
//   TASK              the agent task, e.g. implement
//   TARGET_REPO       owner/repo of the item; ISSUE its number (a PR's number for review)
// Locks follow the task's scope: a ticket, a PR, or the repo. A per-repo task
// (explore) claims every open issue a trusted author labelled, as one batch.
//   FACTORY_REPO      owner/repo the agent run's workflow lives in
//   FACTORY_REF       stable or main; FACTORY_SHA the commit this run pinned
//   AGENT_WORKFLOW    the agent run's workflow file, started by workflow_dispatch
//   FACTORY_APP_SLUG  the App's slug, from the token step
// A run that fails after its claim marks the ticket blocked before it exits.
import { loadBudget } from "./budget";
import { readBudgetPauseTicket } from "./budget-pause-github";
import { required } from "./common";
import { decideGate, findLabeller, type IssueEvent, type Labeller, type WorkflowRun } from "./gate";
import { jobTimeoutMinutes, planGateRun, type GateAction } from "./gate-run-plan";
import { ghApi, ghPages, writeStepSummary } from "./gh";
import { ghGraphql, relabelIssues, repoVariables } from "./gh-graphql";
import { batchQuery, chooseBatch, labellersToCheck, type BatchCandidate, type BatchIssue } from "./batch";
import { labels, triggerLabel } from "./labels";
import { statusMarker } from "./marker";
import type { LockKey } from "./run-name";
import { renderRunSummary } from "./run-summary";
import { isAgentTask, lockScopes } from "./tasks";

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

const issuePath = `repos/${repo}/issues/${issueNumber}`;

const readPermission = (login: string): string => {
  try {
    return (ghApi([`repos/${repo}/collaborators/${login}/permission`]) as { permission: string }).permission;
  } catch {
    return "none";
  }
};

const readLabeller = (): Labeller | undefined => {
  const events = ghPages<IssueEvent[]>(`${issuePath}/events?per_page=100`).flat();
  const actor = findLabeller(events, triggerLabel(task));
  if (actor === undefined) return undefined;
  return { ...actor, permission: actor.type === "User" ? readPermission(actor.login) : "none" };
};

// A per-repo task works a batch: every open issue a trusted author labelled,
// the labelled item always among them. One permission lookup per labeller.
const readBatch = (trigger: BatchIssue): BatchIssue[] => {
  const data = ghGraphql<{ repository: { issues: { nodes: BatchCandidate[] } } }>({
    query: batchQuery,
    variables: { ...repoVariables(repo), label: triggerLabel(task) },
  });
  const candidates = data.repository.issues.nodes;
  const permissions = Object.fromEntries(labellersToCheck(candidates).map((login) => [login, readPermission(login)]));
  const batch = chooseBatch(candidates, permissions, factoryAppLogin);
  return batch.some((issue) => issue.number === trigger.number) ? batch : [trigger, ...batch];
};

const lockKey: LockKey =
  lockScopes[task] === "repo" ? { scope: "repo", repo } : { scope: lockScopes[task], repo, number: issueNumber };

// Yesterday onwards: in-flight runs started before midnight UTC still count.
const runListSince = (time: Date): string =>
  new Date(time.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);

const readRuns = (): WorkflowRun[] =>
  ghPages<{ workflow_runs: WorkflowRun[] }>(
    `repos/${factoryRepo}/actions/runs?per_page=100&created=>=${runListSince(now)}`
  ).flatMap((page) => page.workflow_runs);

const issue = ghApi([issuePath]) as { node_id: string; labels: { name: string }[] };
const decision = decideGate({
  budget,
  runLists: [{ repo: factoryRepo, runs: readRuns() }],
  budgetPause: readBudgetPauseTicket(factoryRepo, factoryAppLogin),
  task,
  item: { labels: issue.labels.map((label) => label.name), labeller: readLabeller() },
  lockKey,
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

const removeLabel = (label: string): void => {
  try {
    ghApi(["-X", "DELETE", `${issuePath}/labels/${encodeURIComponent(label)}`]);
  } catch {
    console.log(`${label} was already off #${issueNumber}`);
  }
};

let claimed = false;

const carryOut = (action: GateAction): void => {
  switch (action.kind) {
    case "comment":
      ghApi(["-X", "POST", `${issuePath}/comments`, "-f", `body=${action.body}`]);
      return;
    case "add label":
      ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${action.label}`]);
      claimed ||= action.label === labels.inProgress;
      return;
    case "remove label":
      removeLabel(action.label);
      return;
    case "claim batch": {
      claimed ||= action.add === labels.inProgress;
      relabelIssues(repo, (batch ?? []).map((member) => member.id), action.add, action.remove);
      return;
    }
    case "dispatch agent run":
      ghApi([
        "-X", "POST", `repos/${action.factoryRepo}/actions/workflows/${action.workflow}/dispatches`,
        "-f", `ref=${action.ref}`,
        ...Object.entries(action.inputs).flatMap(([name, value]) => ["-f", `inputs[${name}]=${value}`]),
      ]);
      return;
  }
};

// A claim with no agent run behind it would hold agent:in-progress forever.
const releaseClaim = (error: unknown): void => {
  const reason = error instanceof Error ? error.message : String(error);
  if (batch === undefined) {
    ghApi(["-X", "POST", `${issuePath}/labels`, "-f", `labels[]=${labels.blocked}`]);
    removeLabel(labels.inProgress);
  } else {
    relabelIssues(repo, batch.map((member) => member.id), labels.blocked, labels.inProgress);
  }
  ghApi([
    "-X", "POST", `${issuePath}/comments`, "-f",
    `body=The gate run claimed this ${batch === undefined ? "item" : "batch"} but could not start its agent run: ${reason}. ` +
      `Re-add \`${triggerLabel(task)}\` to retry. ${statusMarker}`,
  ]);
};

try {
  for (const action of plan.actions) carryOut(action);
} catch (error) {
  if (claimed) releaseClaim(error);
  throw error;
}

writeStepSummary(renderRunSummary({ ...plan.record, seconds: Math.round((Date.now() - startedAt) / 1000) }));
