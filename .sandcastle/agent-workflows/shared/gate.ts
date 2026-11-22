import type { Budget } from "./budget";
import { parseRunName, type LockKey, type RunName } from "./run-name";
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

const midnightUtc = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

export const decideGate = (input: GateInput): GateDecision => {
  if (input.budgetPause.open) return { kind: "paused" };
  const runs = namedRuns(input.runLists);
  const agentRuns = runs.filter((run) => run.runName.agentRun);
  const today = midnightUtc(input.now);
  const todaysRuns = agentRuns.filter((run) => Date.parse(run.created_at) >= today);
  if (todaysRuns.length >= input.budget.dailyRuns) return { kind: "queued", reason: "daily cap" };
  if (agentRuns.filter(inFlight).length >= input.budget.concurrentRuns)
    return { kind: "queued", reason: "concurrency" };
  if (lockHeldByEarlierRun(runs, input)) return { kind: "queued", reason: "lock" };
  return { kind: "proceed" };
};
