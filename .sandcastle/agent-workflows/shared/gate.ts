import type { Budget } from "./budget";
import { parseRunName, type LockKey, type RunName } from "./run-name";
import { triggerLabel } from "./labels";
import type { AgentTask } from "./tasks";

export type WorkflowRun = {
  readonly id: number;
  readonly display_title: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly created_at: string;
};

export type RunList = {
  readonly repo: string;
  readonly runs: readonly WorkflowRun[];
};

export type IssueEvent = {
  readonly event: string;
  readonly label?: { readonly name: string } | null;
  readonly actor: { readonly login: string; readonly type: string } | null;
};

export const findLabeller = (
  events: readonly IssueEvent[],
  label: string
): Pick<Labeller, "login" | "type"> | undefined => {
  const actor = events.findLast((event) => event.event === "labeled" && event.label?.name === label)?.actor;
  return actor ? { login: actor.login, type: actor.type } : undefined;
};

export type Labeller = {
  readonly login: string;
  readonly type: string;
  readonly permission: string;
};

export type GateItem = {
  readonly labels: readonly string[];
  readonly labeller: Labeller | undefined;
};

export type GateInput = {
  readonly budget: Pick<Budget, "dailyRuns" | "concurrentRuns">;
  readonly runLists: readonly RunList[];
  readonly budgetPause: { readonly open: boolean };
  readonly task: AgentTask;
  readonly item: GateItem;
  readonly lockKey: LockKey;
  readonly thisRunId: number;
  readonly factoryAppLogin: string;
  readonly now: Date;
};

export type GateDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "quiet end"; readonly reason: "trigger label missing" | "untrusted labeller" }
  | { readonly kind: "paused" }
  | { readonly kind: "queued"; readonly reason: "daily cap" | "concurrency" | "lock" };

type NamedRun = WorkflowRun & { readonly runName: RunName };

const namedRuns = (runLists: readonly RunList[]): NamedRun[] =>
  runLists.flatMap(({ runs }) =>
    runs.flatMap((run) => {
      const runName = parseRunName(run.display_title);
      return runName ? [{ ...run, runName }] : [];
    })
  );

const inFlight = (run: WorkflowRun): boolean => run.status !== "completed";

const sameLock = (a: LockKey, b: LockKey): boolean =>
  a.scope === b.scope &&
  a.repo.toLowerCase() === b.repo.toLowerCase() &&
  (a.scope === "repo" || b.scope === "repo" || a.number === b.number);

const startedBefore = (a: WorkflowRun, b: WorkflowRun | undefined): boolean => {
  if (b === undefined) return true;
  const [timeA, timeB] = [Date.parse(a.created_at), Date.parse(b.created_at)];
  return timeA !== timeB ? timeA < timeB : a.id < b.id;
};

const lockHeldByEarlierRun = (runs: readonly NamedRun[], input: GateInput): boolean => {
  const thisRun = runs.find((run) => run.id === input.thisRunId);
  return runs.some(
    (run) =>
      run.id !== input.thisRunId &&
      inFlight(run) &&
      sameLock(run.runName.lockKey, input.lockKey) &&
      startedBefore(run, thisRun)
  );
};

const writeAccess: readonly string[] = ["admin", "maintain", "write"];

export const trustedLabeller = (labeller: Labeller | undefined, factoryAppLogin: string): boolean => {
  if (labeller === undefined) return false;
  if (labeller.login === factoryAppLogin) return true;
  return labeller.type === "User" && writeAccess.includes(labeller.permission);
};

const midnightUtc = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

export type AgentRunCounts = { readonly todaysRuns: number; readonly runsInFlight: number };

// Today's agent runs are those created since midnight UTC; runs in flight are
// every agent run not yet completed, whenever it started, except the one
// whose last job is finishing it.
export const countAgentRuns = (
  runLists: readonly RunList[],
  now: Date,
  { finishingRunId }: { readonly finishingRunId?: number } = {}
): AgentRunCounts => {
  const agentRuns = namedRuns(runLists).filter((run) => run.runName.agentRun);
  const today = midnightUtc(now);
  return {
    todaysRuns: agentRuns.filter((run) => Date.parse(run.created_at) >= today).length,
    runsInFlight: agentRuns.filter((run) => inFlight(run) && run.id !== finishingRunId).length,
  };
};

export const decideGate = (input: GateInput): GateDecision => {
  if (!input.item.labels.includes(triggerLabel(input.task)))
    return { kind: "quiet end", reason: "trigger label missing" };
  if (!trustedLabeller(input.item.labeller, input.factoryAppLogin))
    return { kind: "quiet end", reason: "untrusted labeller" };
  if (input.budgetPause.open) return { kind: "paused" };
  const counts = countAgentRuns(input.runLists, input.now);
  if (counts.todaysRuns >= input.budget.dailyRuns) return { kind: "queued", reason: "daily cap" };
  if (counts.runsInFlight >= input.budget.concurrentRuns) return { kind: "queued", reason: "concurrency" };
  const runs = namedRuns(input.runLists);
  if (lockHeldByEarlierRun(runs, input)) return { kind: "queued", reason: "lock" };
  return { kind: "proceed" };
};
