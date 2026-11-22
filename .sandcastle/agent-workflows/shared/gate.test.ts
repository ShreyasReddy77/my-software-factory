import { describe, expect, it } from "vitest";
import adminPermission from "./fixtures/collaborator-permission-admin.json" with { type: "json" };
import readPermission from "./fixtures/collaborator-permission-read.json" with { type: "json" };
import botLabelled from "./fixtures/issue-events-labeled-by-bot.json" with { type: "json" };
import personLabelled from "./fixtures/issue-events-labeled-by-person.json" with { type: "json" };
import runList from "./fixtures/workflow-runs.json" with { type: "json" };
import {
  countAgentRuns,
  decideGate,
  findLabeller,
  type GateInput,
  type GateItem,
  type IssueEvent,
  type WorkflowRun,
} from "./gate";
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

  describe("concurrency", () => {
    const withRuns = (concurrentRuns: number, ...runs: WorkflowRun[]) =>
      input({
        budget: { dailyRuns: 8, concurrentRuns },
        runLists: [{ repo, runs: [thisGateRun, ...runs] }],
      });

    it.each(["queued", "in_progress", "waiting", "pending", "requested"])(
      "queues when agent runs %s fill every slot",
      (status) => {
        expect(
          decideGate(withRuns(1, run({ id: 1, display_title: "[pr owner/repo#9] review", status })))
        ).toEqual({ kind: "queued", reason: "concurrency" });
      }
    );

    it("counts a run still going that started before midnight", () => {
      expect(
        decideGate(
          withRuns(
            1,
            run({ id: 1, display_title: "[pr owner/repo#9] review", created_at: "2026-11-21T23:50:00Z" })
          )
        )
      ).toEqual({ kind: "queued", reason: "concurrency" });
    });

    it("ignores finished runs and gate runs still going", () => {
      expect(
        decideGate(
          withRuns(
            1,
            run({ id: 1, display_title: "[pr owner/repo#9] review", status: "completed", conclusion: "failure" }),
            run({ id: 2, display_title: "[pr owner/repo#9] review (no agent)" })
          )
        )
      ).toEqual({ kind: "proceed" });
    });
  });

  describe("the lock", () => {
    const withRuns = (...runs: WorkflowRun[]) =>
      input({
        budget: { dailyRuns: 8, concurrentRuns: 5 },
        runLists: [{ repo, runs: [thisGateRun, ...runs] }],
      });

    it("queues when an agent run on the same lock key is still going", () => {
      expect(decideGate(withRuns(run({ id: 1, display_title: "[ticket owner/repo#5] implement" })))).toEqual({
        kind: "queued",
        reason: "lock",
      });
    });

    it("shares one lock between tasks on the same PR", () => {
      const reviewGate = run({
        id: thisRunId,
        display_title: "[pr owner/repo#5] review (no agent)",
        created_at: "2026-11-22T10:00:00Z",
      });
      const decision = decideGate(
        input({
          budget: { dailyRuns: 8, concurrentRuns: 5 },
          task: "review",
          item: { ...input().item, labels: ["agent:review"] },
          lockKey: { scope: "pr", repo, number: 5 },
          runLists: [{ repo, runs: [reviewGate, run({ id: 1, display_title: "[pr owner/repo#5] fix-ci" })] }],
        })
      );
      expect(decision).toEqual({ kind: "queued", reason: "lock" });
    });

    it("lets the earlier of two gate runs starting together go ahead, and queues the later", () => {
      const sameSecond = "2026-11-22T10:00:00Z";
      const earlier = run({ id: 899, display_title: "[ticket owner/repo#5] implement (no agent)", created_at: sameSecond });
      const later = run({ id: 901, display_title: "[ticket owner/repo#5] implement (no agent)", created_at: sameSecond });
      expect(decideGate(withRuns(earlier))).toEqual({ kind: "queued", reason: "lock" });
      expect(decideGate(withRuns(later))).toEqual({ kind: "proceed" });
    });

    it("ignores finished runs, other lock keys and names that don't parse", () => {
      expect(
        decideGate(
          withRuns(
            run({ id: 1, display_title: "[ticket owner/repo#5] implement", status: "completed", conclusion: "success" }),
            run({ id: 2, display_title: "[ticket owner/repo#6] implement (no agent)" }),
            run({ id: 3, display_title: "[ticket owner/other#5] implement (no agent)" }),
            run({ id: 4, display_title: "ignored" })
          )
        )
      ).toEqual({ kind: "proceed" });
    });

    it("treats this run as the newest when the list doesn't show it yet", () => {
      const decision = decideGate(
        input({
          budget: { dailyRuns: 8, concurrentRuns: 5 },
          runLists: [
            { repo, runs: [run({ id: 1, display_title: "[ticket owner/repo#5] implement (no agent)", created_at: "2026-11-22T09:59:59Z" })] },
          ],
        })
      );
      expect(decision).toEqual({ kind: "queued", reason: "lock" });
    });
  });

  describe("the trigger label", () => {
    const labelledBy = (events: readonly IssueEvent[], permission: string): GateItem => {
      const relabelled = events.map((event) => ({ ...event, label: { ...event.label, name: "agent:implement" } }));
      const labeller = findLabeller(relabelled, "agent:implement");
      return { labels: ["agent:implement"], labeller: labeller && { ...labeller, permission } };
    };

    it("ends quietly when the label is no longer on the item, even while a pause is open", () => {
      const item = { ...input().item, labels: ["agent:in-progress"] };
      expect(decideGate(input({ item, budgetPause: { open: true } }))).toEqual({
        kind: "quiet end",
        reason: "trigger label missing",
      });
    });

    it("proceeds on a label applied by a person with write access", () => {
      const item = labelledBy(personLabelled, adminPermission.permission);
      expect(item.labeller?.login).toBe(adminPermission.user.login);
      expect(decideGate(input({ item }))).toEqual({ kind: "proceed" });
    });

    it("ends quietly on a label applied by a person without write access", () => {
      const item = labelledBy(personLabelled, readPermission.permission);
      expect(decideGate(input({ item, budgetPause: { open: true } }))).toEqual({
        kind: "quiet end",
        reason: "untrusted labeller",
      });
    });

    it("ends quietly when no labelled event names the label", () => {
      expect(findLabeller(personLabelled, "agent:implement")).toBeUndefined();
      const item = labelledBy([], adminPermission.permission);
      expect(decideGate(input({ item }))).toEqual({ kind: "quiet end", reason: "untrusted labeller" });
    });

    it("trusts the factory's App as a labeller", () => {
      const appEvents = botLabelled.map((event) => ({ ...event, actor: { ...event.actor, login: "agent-factory[bot]" } }));
      expect(decideGate(input({ item: labelledBy(appEvents, "write") }))).toEqual({ kind: "proceed" });
    });

    it("refuses other bots, even with write access", () => {
      expect(decideGate(input({ item: labelledBy(botLabelled, "admin") }))).toEqual({
        kind: "quiet end",
        reason: "untrusted labeller",
      });
    });

    it("reads the latest labelled event for the label", () => {
      const [event] = personLabelled;
      const events: IssueEvent[] = [
        { ...event!, label: { ...event!.label, name: "agent:implement" } },
        { ...event!, event: "unlabeled", label: { ...event!.label, name: "agent:implement" } },
        { ...botLabelled[0]!, label: { ...botLabelled[0]!.label, name: "agent:implement" } },
        { ...event!, label: { ...event!.label, name: "agent:review" } },
      ];
      expect(findLabeller(events, "agent:implement")).toEqual({ login: "github-actions[bot]", type: "Bot" });
    });
  });
});

describe("counting agent runs", () => {
  it("counts today's agent runs from midnight UTC and every agent run in flight, however old", () => {
    const factoryRuns = [
      run({ id: 1, display_title: "[pr owner/repo#9] review", created_at: "2026-11-21T23:50:00Z" }),
      run({ id: 2, display_title: "[ticket owner/repo#5] implement", status: "completed", conclusion: "success" }),
      run({ id: 3, display_title: "[ticket owner/repo#6] implement", status: "completed", created_at: "2026-11-21T22:00:00Z" }),
      run({ id: 4, display_title: "[ticket owner/repo#6] implement (no agent)" }),
      run({ id: 5, display_title: "Requeue run" }),
    ];
    const otherRuns = [run({ id: 6, display_title: "[repo owner/other] explore", status: "queued" })];

    expect(countAgentRuns([{ repo, runs: factoryRuns }, { repo: "owner/other", runs: otherRuns }], now)).toEqual({
      todaysRuns: 2,
      runsInFlight: 2,
    });
  });
});
