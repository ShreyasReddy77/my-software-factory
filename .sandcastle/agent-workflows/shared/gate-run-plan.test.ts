import { describe, expect, it } from "vitest";
import { jobTimeoutMinutes, planGateRun, type GateRunContext } from "./gate-run-plan";

const context: GateRunContext = {
  task: "implement",
  item: { repo: "owner/repo", number: 5 },
  agentRun: {
    factoryRepo: "owner/factory",
    workflow: "implement-agent.yml",
    ref: "main",
    factorySha: "0123456789abcdef0123456789abcdef01234567",
    jobTimeoutMinutes: 60,
  },
};

describe("the gate run's plan", () => {
  it("on proceed, writes the marker, claims the ticket, then starts the agent run", () => {
    const plan = planGateRun({ kind: "proceed" }, context);

    expect(plan.actions).toEqual([
      { kind: "comment", body: expect.stringContaining("<!-- factory:restart-as v1 agent:implement -->") },
      { kind: "add label", label: "agent:in-progress" },
      { kind: "remove label", label: "agent:implement" },
      {
        kind: "dispatch agent run",
        factoryRepo: "owner/factory",
        workflow: "implement-agent.yml",
        ref: "main",
        inputs: {
          factory_sha: "0123456789abcdef0123456789abcdef01234567",
          issue: "5",
          job_timeout: "60",
        },
      },
    ]);
  });

  it("on queued, writes the marker and swaps the trigger for factory:queued, starting nothing", () => {
    const plan = planGateRun({ kind: "queued", reason: "lock" }, context);

    expect(plan.actions).toEqual([
      { kind: "comment", body: expect.stringContaining("<!-- factory:restart-as v1 agent:implement -->") },
      { kind: "add label", label: "factory:queued" },
      { kind: "remove label", label: "agent:implement" },
    ]);
  });

  it("says in the queued comment why the ticket waits", () => {
    const comment = planGateRun({ kind: "queued", reason: "daily cap" }, context).actions[0];

    expect(comment).toMatchObject({ body: expect.stringContaining("daily cap") });
  });

  it("on paused, writes the marker and swaps the trigger for factory:paused", () => {
    const plan = planGateRun({ kind: "paused" }, context);

    expect(plan.actions.slice(1)).toEqual([
      { kind: "add label", label: "factory:paused" },
      { kind: "remove label", label: "agent:implement" },
    ]);
  });

  it.each(["trigger label missing", "untrusted labeller"] as const)(
    "on a quiet end (%s), touches nothing",
    (reason) => {
      expect(planGateRun({ kind: "quiet end", reason }, context).actions).toEqual([]);
    }
  );

  it("hides every comment it writes from the next run's ticket text", () => {
    const comment = planGateRun({ kind: "proceed" }, context).actions[0];

    expect(comment).toMatchObject({ body: expect.stringContaining("<!-- factory:status -->") });
  });
});

describe("the gate run's run summary", () => {
  it.each([
    [{ kind: "proceed" }, { kind: "done" }, "agent:in-progress"],
    [{ kind: "queued", reason: "concurrency" }, { kind: "queued" }, "factory:queued"],
    [{ kind: "paused" }, { kind: "paused" }, "factory:paused"],
  ] as const)("records %j as outcome %j with next label %s", (decision, outcome, nextLabel) => {
    expect(planGateRun(decision, context).record).toEqual({
      task: "implement gate run",
      targetRepo: "owner/repo",
      item: { kind: "issue", number: 5 },
      outcome,
      nextLabel,
    });
  });

  it("records a quiet end as stopped with its reason and no next label", () => {
    expect(planGateRun({ kind: "quiet end", reason: "untrusted labeller" }, context).record).toEqual({
      task: "implement gate run",
      targetRepo: "owner/repo",
      item: { kind: "issue", number: 5 },
      outcome: { kind: "stopped", reason: "quiet end, untrusted labeller" },
    });
  });
});

describe("the agent run's job timeout", () => {
  it("is the task's agent_minutes plus 15, so a run at its ceiling can still scan and push", () => {
    expect(jobTimeoutMinutes(45)).toBe(60);
  });
});

describe("the gate run's plan for review, under a per-PR lock", () => {
  const review: GateRunContext = {
    ...context,
    task: "review",
    item: { repo: "owner/repo", number: 9 },
    agentRun: { ...context.agentRun, workflow: "review-agent.yml", jobTimeoutMinutes: 30 },
  };

  it("on proceed, claims the PR and starts the agent run with the PR's number", () => {
    const plan = planGateRun({ kind: "proceed" }, review);

    expect(plan.actions.slice(1)).toEqual([
      { kind: "add label", label: "agent:in-progress" },
      { kind: "remove label", label: "agent:review" },
      {
        kind: "dispatch agent run",
        factoryRepo: "owner/factory",
        workflow: "review-agent.yml",
        ref: "main",
        inputs: { factory_sha: "0123456789abcdef0123456789abcdef01234567", pr: "9", job_timeout: "30" },
      },
    ]);
  });

  it("records the PR as the run summary's item, under review's own task name", () => {
    expect(planGateRun({ kind: "proceed" }, review).record.task).toBe("review gate run");
    expect(planGateRun({ kind: "queued", reason: "lock" }, review).record.item).toEqual({ kind: "pr", number: 9 });
  });
});

describe("the gate run's plan for explore, under a per-repo lock", () => {
  const explore: GateRunContext = {
    ...context,
    task: "explore",
    item: { repo: "owner/repo", number: 7 },
    agentRun: { ...context.agentRun, workflow: "explore-agent.yml", jobTimeoutMinutes: 30 },
    batch: [3, 7, 12],
  };

  it("on proceed, writes the marker on the labelled issue, claims the whole batch, then starts one agent run for it", () => {
    const plan = planGateRun({ kind: "proceed" }, explore);

    expect(plan.actions).toEqual([
      { kind: "comment", body: expect.stringContaining("<!-- factory:restart-as v1 agent:explore -->") },
      { kind: "claim batch", numbers: [3, 7, 12], add: "agent:in-progress", remove: "agent:explore" },
      {
        kind: "dispatch agent run",
        factoryRepo: "owner/factory",
        workflow: "explore-agent.yml",
        ref: "main",
        inputs: { factory_sha: "0123456789abcdef0123456789abcdef01234567", batch: "[3,7,12]", job_timeout: "30" },
      },
    ]);
  });

  it("says in the claim comment how many issues the batch holds", () => {
    const comment = planGateRun({ kind: "proceed" }, explore).actions[0];

    expect(comment).toMatchObject({ body: expect.stringContaining("3 issues") });
  });

  it("on queued, queues only the labelled issue; the rest keep agent:explore for the next batch", () => {
    const plan = planGateRun({ kind: "queued", reason: "lock" }, explore);

    expect(plan.actions.slice(1)).toEqual([
      { kind: "add label", label: "factory:queued" },
      { kind: "remove label", label: "agent:explore" },
    ]);
  });
});
