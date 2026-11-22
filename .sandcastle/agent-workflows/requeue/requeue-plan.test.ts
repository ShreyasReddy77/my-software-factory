import { describe, expect, it } from "vitest";
import { planRequeue, type RequeueInput, type WaitingItem } from "./requeue-plan";

const repo = "owner/factory";
const now = new Date("2026-11-22T10:00:00Z");

const item = (number: number, fields: Partial<WaitingItem> = {}): WaitingItem => ({
  repo,
  id: `I_${number}`,
  kind: "issue",
  number,
  createdAt: `2026-11-${String(number).padStart(2, "0")}T00:00:00Z`,
  labels: ["factory:queued"],
  restartAs: "agent:implement",
  ...fields,
});

const input = (overrides: Partial<RequeueInput> = {}): RequeueInput => ({
  budget: {
    dailyRuns: 8,
    concurrentRuns: 1,
    priority: [["merge"], ["review"], ["implement", "implement-spec"], ["explore"]],
  },
  runCounts: { todaysRuns: 0, runsInFlight: 0 },
  waiting: [],
  budgetPause: { open: false },
  now,
  ...overrides,
});

const restartedNumbers = (plan: ReturnType<typeof planRequeue>): number[] =>
  plan.actions.flatMap((action) => (action.kind === "restart" ? [action.item.number] : []));

describe("the requeue planner", () => {
  it("restarts a queued item by swapping its waiting label for the marker's trigger label", () => {
    const plan = planRequeue(input({ waiting: [item(3)] }));

    expect(plan.actions).toEqual([
      { kind: "restart", item: item(3), remove: ["factory:queued"], add: "agent:implement" },
    ]);
  });

  it.each([
    { todaysRuns: 0, runsInFlight: 0, dailyRuns: 8, concurrentRuns: 3, restarted: 3 },
    { todaysRuns: 6, runsInFlight: 0, dailyRuns: 8, concurrentRuns: 3, restarted: 2 },
    { todaysRuns: 1, runsInFlight: 2, dailyRuns: 8, concurrentRuns: 3, restarted: 1 },
    { todaysRuns: 8, runsInFlight: 0, dailyRuns: 8, concurrentRuns: 3, restarted: 0 },
    { todaysRuns: 2, runsInFlight: 3, dailyRuns: 8, concurrentRuns: 3, restarted: 0 },
    { todaysRuns: 9, runsInFlight: 4, dailyRuns: 8, concurrentRuns: 3, restarted: 0 },
  ])(
    "with $todaysRuns of $dailyRuns runs today and $runsInFlight of $concurrentRuns in flight, restarts $restarted",
    ({ todaysRuns, runsInFlight, dailyRuns, concurrentRuns, restarted }) => {
      const plan = planRequeue(
        input({
          budget: { ...input().budget, dailyRuns, concurrentRuns },
          runCounts: { todaysRuns, runsInFlight },
          waiting: [item(1), item(2), item(3), item(4)],
        })
      );

      expect(restartedNumbers(plan)).toHaveLength(restarted);
      expect(plan.gauge.restarted).toBe(restarted);
    }
  );

  it("finishes before it starts: budget.yml's priority groups first, oldest first within each", () => {
    const plan = planRequeue(
      input({
        budget: { ...input().budget, concurrentRuns: 4 },
        waiting: [
          item(1, { restartAs: "agent:explore" }),
          item(5, { restartAs: "agent:implement-spec" }),
          item(2, { restartAs: "agent:implement" }),
          item(9, { kind: "pr", restartAs: "agent:review" }),
          item(4, { restartAs: "agent:implement" }),
          item(7, { kind: "pr", restartAs: "agent:review" }),
        ],
      })
    );

    expect(restartedNumbers(plan)).toEqual([7, 9, 2, 4]);
  });

  it("orders by when each item was opened, not by its number", () => {
    const plan = planRequeue(
      input({
        waiting: [item(2, { createdAt: "2026-11-20T00:00:00Z" }), item(8, { createdAt: "2026-11-01T00:00:00Z" })],
      })
    );

    expect(restartedNumbers(plan)).toEqual([8]);
  });

  it.each([
    ["agent:blocked", { labels: ["factory:queued", "agent:blocked"] }],
    ["factory:needs-human", { labels: ["factory:paused", "factory:needs-human"] }],
    ["explore's stop, needs-a-human", { labels: ["factory:queued", "needs-a-human"] }],
    ["an agent at work on it", { labels: ["factory:queued", "agent:in-progress"] }],
    ["its trigger label already back on", { labels: ["factory:queued", "agent:implement"] }],
    ["no factory marker", { restartAs: undefined }],
  ] as const)("never restarts an item with %s, and gives its slot to the next", (_, fields) => {
    const plan = planRequeue(input({ waiting: [item(1, fields), item(2)] }));

    expect(restartedNumbers(plan)).toEqual([2]);
  });

  it("removes every waiting label the item carries", () => {
    const plan = planRequeue(input({ waiting: [item(1, { labels: ["factory:queued", "factory:paused", "bug"] })] }));

    expect(plan.actions).toEqual([
      expect.objectContaining({ remove: ["factory:queued", "factory:paused"], add: "agent:implement" }),
    ]);
  });

  it("restarts a repo-locked task's waiting items together, in one slot, as the one batch they become", () => {
    const plan = planRequeue(
      input({
        waiting: [
          item(1, { restartAs: "agent:explore" }),
          item(2, { restartAs: "agent:explore" }),
          item(3, { restartAs: "agent:explore", repo: "owner/other" }),
        ],
      })
    );

    expect(restartedNumbers(plan)).toEqual([1, 2]);
    expect(plan.gauge.restarted).toBe(2);
  });

  describe("with a budget pause open", () => {
    const waiting = [item(1, { labels: ["factory:paused"] }), item(2)];

    it("closes a timed pause once its reset has passed, then restarts into the free slots", () => {
      const until = new Date("2026-11-22T09:59:00Z");
      const plan = planRequeue(input({ budgetPause: { open: true, ticket: 40, until }, waiting }));

      expect(plan.actions[0]).toEqual({ kind: "close pause ticket", ticket: 40 });
      expect(restartedNumbers(plan)).toEqual([1]);
      expect(plan.gauge.budgetPause).toEqual({ open: false });
    });

    it("closes a timed pause whose reset is exactly now", () => {
      const plan = planRequeue(input({ budgetPause: { open: true, ticket: 40, until: now }, waiting }));

      expect(plan.actions[0]).toEqual({ kind: "close pause ticket", ticket: 40 });
    });

    it("leaves a timed pause open before its reset, and every item waiting", () => {
      const until = new Date("2026-11-22T10:01:00Z");
      const plan = planRequeue(input({ budgetPause: { open: true, ticket: 40, until }, waiting }));

      expect(plan.actions).toEqual([]);
      expect(plan.gauge.budgetPause).toEqual({ open: true, ticket: 40, until });
    });

    it("never closes a pause with no reset time: out of credit, or a limit that named none; a human closes it", () => {
      const plan = planRequeue(
        input({ budgetPause: { open: true, ticket: 40 }, waiting, now: new Date("2027-01-01T00:00:00Z") })
      );

      expect(plan.actions).toEqual([]);
      expect(plan.gauge.budgetPause).toEqual({ open: true, ticket: 40 });
    });
  });
});
