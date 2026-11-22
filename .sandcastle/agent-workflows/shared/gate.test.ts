import { describe, expect, it } from "vitest";
import adminPermission from "./fixtures/collaborator-permission-admin.json" with { type: "json" };
import runList from "./fixtures/workflow-runs.json" with { type: "json" };
import { decideGate, type GateInput, type WorkflowRun } from "./gate";
import type { LockKey } from "./run-name";

const repo = "owner/repo";
const ticket5: LockKey = { scope: "ticket", repo, number: 5 };
const thisRunId = 900;
const now = new Date("2026-11-22T10:00:00Z");

const realRun = runList.workflow_runs[0]!;

const run = (fields: Partial<WorkflowRun> & Pick<WorkflowRun, "id" | "display_title">): WorkflowRun => ({
  ...realRun,
  status: "in_progress",
  conclusion: null,
  created_at: "2026-11-22T09:00:00Z",
  ...fields,
});

const thisGateRun = run({
  id: thisRunId,
  display_title: "[ticket owner/repo#5] implement (no agent)",
  created_at: "2026-11-22T10:00:00Z",
});

const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  budget: { dailyRuns: 8, concurrentRuns: 1 },
  runLists: [{ repo, runs: [thisGateRun] }],
  budgetPause: { open: false },
  task: "implement",
  item: {
    labels: ["agent:implement"],
    labeller: {
      login: adminPermission.user.login,
      type: adminPermission.user.type,
      permission: adminPermission.permission,
    },
  },
  lockKey: ticket5,
  thisRunId,
  factoryAppLogin: "agent-factory[bot]",
  now,
  ...overrides,
});

describe("the gate decision", () => {
  it("proceeds when the label is trusted, budget is free and nothing holds the lock", () => {
    expect(decideGate(input())).toEqual({ kind: "proceed" });
  });

  it("pauses while the budget-pause ticket is open", () => {
    expect(decideGate(input({ budgetPause: { open: true } }))).toEqual({ kind: "paused" });
  });

  it("pauses rather than queues when the pause is open and the cap is full too", () => {
    const decision = decideGate(
      input({
        budgetPause: { open: true },
        budget: { dailyRuns: 1, concurrentRuns: 1 },
        runLists: [
          {
            repo,
            runs: [thisGateRun, run({ id: 1, display_title: "[pr owner/repo#9] review" })],
          },
        ],
      })
    );
    expect(decision).toEqual({ kind: "paused" });
  });

  describe("the daily cap", () => {
    const finished = (id: number, created_at: string, display_title = `[pr owner/repo#${id}] review`) =>
      run({ id, display_title, created_at, status: "completed", conclusion: "success" });

    const withRuns = (dailyRuns: number, ...runs: WorkflowRun[]) =>
      input({
        budget: { dailyRuns, concurrentRuns: 5 },
        runLists: [{ repo, runs: [thisGateRun, ...runs] }],
      });

    it("queues when today's agent runs have reached the cap", () => {
      expect(
        decideGate(withRuns(2, finished(1, "2026-11-22T01:00:00Z"), finished(2, "2026-11-22T02:00:00Z")))
      ).toEqual({ kind: "queued", reason: "daily cap" });
    });

    it("counts from midnight UTC: a run a second before it is yesterday's", () => {
      expect(
        decideGate(withRuns(2, finished(1, "2026-11-21T23:59:59Z"), finished(2, "2026-11-22T02:00:00Z")))
      ).toEqual({ kind: "proceed" });
      expect(
        decideGate(withRuns(2, finished(1, "2026-11-22T00:00:00Z"), finished(2, "2026-11-22T02:00:00Z")))
      ).toEqual({ kind: "queued", reason: "daily cap" });
    });

    it("counts only agent runs, never gate runs, the requeue run or other workflows", () => {
      expect(
        decideGate(
          withRuns(
            1,
            finished(1, "2026-11-22T01:00:00Z", "[pr owner/repo#1] review (no agent)"),
            finished(2, "2026-11-22T01:00:00Z", "Requeue run"),
            run({ ...realRun, created_at: "2026-11-22T03:31:46Z" })
          )
        )
      ).toEqual({ kind: "proceed" });
    });

    it("counts an explore batch as one run, however many issues it covers", () => {
      expect(
        decideGate(withRuns(2, finished(1, "2026-11-22T01:00:00Z", "[repo owner/repo] explore")))
      ).toEqual({ kind: "proceed" });
    });

    it("adds up the agent runs of every repo's run list", () => {
      const decision = decideGate(
        input({
          budget: { dailyRuns: 2, concurrentRuns: 5 },
          runLists: [
            { repo, runs: [thisGateRun, finished(1, "2026-11-22T01:00:00Z")] },
            { repo: "owner/companion", runs: [finished(2, "2026-11-22T01:00:00Z", "[ticket owner/private#2] implement")] },
          ],
        })
      );
      expect(decision).toEqual({ kind: "queued", reason: "daily cap" });
    });
  });
});
