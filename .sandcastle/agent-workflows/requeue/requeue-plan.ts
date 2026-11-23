// The requeue planner: which waiting items restart into the free slots, and
// whether a timed budget pause closes first. Pure: the caller passes the
// budget, the run counts, the waiting items, the pause ticket and the clock.
import type { Budget } from "../shared/budget";
import type { BudgetPauseState } from "../shared/budget-pause";
import type { AgentRunCounts } from "../shared/gate";
import { labels, taskOfTriggerLabel, triggerLabels, waitingLabels, type TriggerLabel } from "../shared/labels";
import { lockScopes } from "../shared/tasks";
import type { BudgetGauge } from "../shared/run-summary";

// An open issue or PR labelled factory:queued or factory:paused. restartAs is
// the trigger label its latest factory marker names, if it has one.
export type WaitingItem = {
  readonly repo: string;
  readonly id: string;
  readonly kind: "issue" | "pr";
  readonly number: number;
  readonly createdAt: string;
  readonly labels: readonly string[];
  readonly restartAs: TriggerLabel | undefined;
};

export type RequeueInput = {
  readonly budget: Pick<Budget, "dailyRuns" | "concurrentRuns" | "priority">;
  readonly runCounts: AgentRunCounts;
  readonly waiting: readonly WaitingItem[];
  readonly budgetPause: BudgetPauseState;
  readonly now: Date;
};

export type RequeueAction =
  | { readonly kind: "close pause ticket"; readonly ticket: number }
  | {
      readonly kind: "restart";
      readonly item: WaitingItem;
      readonly remove: readonly string[];
      readonly add: TriggerLabel;
    };

export type RequeuePlan = {
  readonly actions: readonly RequeueAction[];
  readonly gauge: BudgetGauge;
};

const taskOf = taskOfTriggerLabel;

const freeSlots = ({ budget, runCounts }: RequeueInput): number =>
  Math.max(0, Math.min(budget.dailyRuns - runCounts.todaysRuns, budget.concurrentRuns - runCounts.runsInFlight));

// A task missing from budget.yml's priority list goes last.
const priorityOf = (priority: RequeueInput["budget"]["priority"], label: TriggerLabel): number => {
  const group = priority.findIndex((tasks) => tasks.includes(taskOf(label)));
  return group === -1 ? priority.length : group;
};

type Restartable = WaitingItem & { readonly restartAs: TriggerLabel };

const inRestartOrder = (input: RequeueInput, items: readonly Restartable[]): Restartable[] =>
  [...items].sort(
    (a, b) =>
      priorityOf(input.budget.priority, a.restartAs) - priorityOf(input.budget.priority, b.restartAs) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.number - b.number
  );

// Work a human has to look at first, work an agent holds, and work whose
// gate run is already on its way.
const heldLabels: readonly string[] = [
  labels.blocked,
  labels.needsHuman,
  labels.needsAHuman,
  labels.inProgress,
  ...triggerLabels,
];

const isRestartable = (item: WaitingItem): item is Restartable =>
  item.restartAs !== undefined && !item.labels.some((label) => heldLabels.includes(label));

// A repo-locked task's gate run claims every waiting item of that repo as one
// batch, so they share one slot; every other item takes its own.
const slotKey = (item: Restartable): string => {
  const task = taskOf(item.restartAs);
  return lockScopes[task] === "repo"
    ? `${task} ${item.repo.toLowerCase()}`
    : `${item.kind} ${item.repo.toLowerCase()}#${item.number}`;
};

const chooseRestarts = (input: RequeueInput): Restartable[] => {
  const taken = new Set<string>();
  let slots = freeSlots(input);
  return inRestartOrder(input, input.waiting.filter(isRestartable)).filter((item) => {
    const key = slotKey(item);
    if (taken.has(key)) return true;
    if (slots === 0) return false;
    slots -= 1;
    taken.add(key);
    return true;
  });
};

// Only a timed pause whose reset has passed closes here; a pause with no reset
// (out of credit, or a limit that named none) stays until a human closes it.
const ticketToClose = (pause: BudgetPauseState, now: Date): number | undefined =>
  pause.open && pause.until !== undefined && pause.until.getTime() <= now.getTime() ? pause.ticket : undefined;

export const planRequeue = (input: RequeueInput): RequeuePlan => {
  const closing = ticketToClose(input.budgetPause, input.now);
  const budgetPause: BudgetPauseState = closing === undefined ? input.budgetPause : { open: false };
  const restarts: RequeueAction[] = budgetPause.open
    ? []
    : chooseRestarts(input).map((item) => ({
        kind: "restart",
        item,
        remove: item.labels.filter((label) => waitingLabels.includes(label)),
        add: item.restartAs,
      }));
  return {
    actions: [
      ...(closing === undefined ? [] : [{ kind: "close pause ticket" as const, ticket: closing }]),
      ...restarts,
    ],
    gauge: {
      todaysRuns: input.runCounts.todaysRuns,
      dailyRuns: input.budget.dailyRuns,
      runsInFlight: input.runCounts.runsInFlight,
      concurrentRuns: input.budget.concurrentRuns,
      budgetPause,
      restarted: restarts.length,
    },
  };
};
