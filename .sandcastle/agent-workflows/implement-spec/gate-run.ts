// Implement-spec's gate run host step: re-reads the spec with its own App
// token, gates it, reads its queue, then splits the spec or claims and builds
// the queue's next ready ticket, or queues, pauses or ends quietly.
//   GH_TOKEN          App token for TARGET_REPO: Issues write, Actions write
//   TARGET_REPO       owner/repo of the spec; ISSUE the spec's number
//   FACTORY_REPO      owner/repo the agent run's workflow lives in
//   FACTORY_REF       stable or main; FACTORY_SHA the commit this run pinned
//   AGENT_WORKFLOW    the agent run's entry file, started by workflow_dispatch
//   FACTORY_APP_SLUG  the App's slug, from the token step
// A run that fails after a claim marks the claimed issue blocked before it exits.
import { loadBudget } from "../shared/budget";
import { readBudgetPauseTicket } from "../shared/budget-pause-github";
import { required } from "../shared/common";
import { decideGate, findLabeller, type IssueEvent, type Labeller, type WorkflowRun } from "../shared/gate";
import { ghApi, ghPages, writeStepSummary } from "../shared/gh";
import { labels, specQueueLabel, triggerLabel } from "../shared/labels";
import { statusMarker } from "../shared/marker";
import { renderRunSummary } from "../shared/run-summary";
import { planSpecGate, type SpecGateAction } from "./gate-plan";
import { surveyQueue, type QueueIssue } from "./queue";

const startedAt = Date.now();
const now = new Date(startedAt);
const task = "implement-spec";

const repo = required("TARGET_REPO");
const spec = Number(required("ISSUE"));
const factoryRepo = required("FACTORY_REPO");
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;
const budget = loadBudget();

const issuePath = (number: number): string => `repos/${repo}/issues/${number}`;

const readLabeller = (): Labeller | undefined => {
  const events = ghPages<IssueEvent[]>(`${issuePath(spec)}/events?per_page=100`).flat();
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
const runListSince = (time: Date): string => new Date(time.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);

const runs: WorkflowRun[] = ghPages<{ workflow_runs: WorkflowRun[] }>(
  `repos/${factoryRepo}/actions/runs?per_page=100&created=>=${runListSince(now)}`
).flatMap((page) => page.workflow_runs);

const budgetPause = readBudgetPauseTicket(factoryRepo, factoryAppLogin);

type ApiIssue = {
  number: number;
  state: "open" | "closed";
  labels: { name: string }[];
  body: string | null;
  pull_request?: unknown;
};

const readQueue = (): QueueIssue[] =>
  ghPages<ApiIssue[]>(
    `repos/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(specQueueLabel(spec))}`
  )
    .flat()
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({ ...issue, labels: issue.labels.map((label) => label.name) }));

const specIssue = ghApi([issuePath(spec)]) as { labels: { name: string }[] };
const item = { labels: specIssue.labels.map((label) => label.name), labeller: readLabeller() };

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

const removeLabel = (number: number, label: string): void => {
  try {
    ghApi(["-X", "DELETE", `${issuePath(number)}/labels/${encodeURIComponent(label)}`]);
  } catch {
    console.log(`${label} was already off #${number}`);
  }
};

let claimed: number | undefined;

const carryOut = (action: SpecGateAction): void => {
  switch (action.kind) {
    case "comment":
      ghApi(["-X", "POST", `${issuePath(action.on)}/comments`, "-f", `body=${action.body}`]);
      return;
    case "add label":
      ghApi(["-X", "POST", `${issuePath(action.on)}/labels`, "-f", `labels[]=${action.label}`]);
      if (action.label === labels.inProgress) claimed = action.on;
      return;
    case "remove label":
      removeLabel(action.on, action.label);
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

// A claim with no agent run behind it would hold agent:in-progress forever.
const releaseClaim = (number: number, error: unknown): void => {
  const reason = error instanceof Error ? error.message : String(error);
  ghApi(["-X", "POST", `${issuePath(number)}/labels`, "-f", `labels[]=${labels.blocked}`]);
  removeLabel(number, labels.inProgress);
  ghApi([
    "-X", "POST", `${issuePath(number)}/comments`, "-f",
    `body=The implement-spec gate run claimed this but could not start its agent run: ${reason}. ` +
      `Take \`${labels.blocked}\` off and re-add \`${triggerLabel(task)}\` to spec #${spec} to retry. ${statusMarker}`,
  ]);
};

try {
  for (const action of plan.actions) carryOut(action);
} catch (error) {
  if (claimed !== undefined) releaseClaim(claimed, error);
  throw error;
}

writeStepSummary(renderRunSummary({ ...plan.record, seconds: Math.round((Date.now() - startedAt) / 1000) }));
