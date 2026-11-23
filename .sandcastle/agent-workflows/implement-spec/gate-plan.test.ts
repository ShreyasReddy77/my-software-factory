import { describe, expect, it, vi } from "vitest";
import type { GateDecision } from "../shared/gate";
import type { LockKey } from "../shared/run-name";
import { planSpecGate, type SpecGateInput } from "./gate-plan";
import type { QueueSurvey } from "./queue";

const sha = "0123456789abcdef0123456789abcdef01234567";
const proceed: GateDecision = { kind: "proceed" };

const input = (survey: QueueSurvey, decide: (lockKey: LockKey) => GateDecision = () => proceed): SpecGateInput => ({
  spec: { repo: "owner/repo", number: 7 },
  decide,
  survey: () => survey,
  agentRun: { factoryRepo: "owner/factory", workflow: "implement-spec-agent.yml", ref: "main", factorySha: sha },
  agentMinutes: { split: 30, build: 45 },
});

const marker = "<!-- factory:restart-as v1 agent:implement-spec -->";

describe("implement-spec's gate run", () => {
  it("on a spec with no queue, claims the spec and starts the split on implement-spec's budget line", () => {
    const plan = planSpecGate(input({ kind: "no queue" }));

    expect(plan.actions).toEqual([
      { kind: "comment", on: 7, body: expect.stringContaining(marker) },
      { kind: "add label", on: 7, label: "agent:in-progress" },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
      {
        kind: "dispatch agent run",
        factoryRepo: "owner/factory",
        workflow: "implement-spec-agent.yml",
        ref: "main",
        inputs: { factory_ref: "main", factory_sha: sha, mode: "split", spec: "7", issue: "7", job_timeout: "45" },
      },
    ]);
    expect(plan.record).toMatchObject({ task: "implement-spec gate run", outcome: { kind: "done" }, nextLabel: "agent:in-progress" });
  });

  it("locks the split on the spec issue itself", () => {
    const decide = vi.fn(() => proceed);
    planSpecGate(input({ kind: "no queue" }, decide));

    expect(decide.mock.calls).toEqual([[{ scope: "ticket", repo: "owner/repo", number: 7 }]]);
  });

  it("on a ready ticket, claims that ticket and starts its build on implement's budget line", () => {
    const plan = planSpecGate(input({ kind: "ready", ticket: 12 }));

    expect(plan.actions).toEqual([
      { kind: "comment", on: 7, body: expect.stringContaining(marker) },
      { kind: "comment", on: 12, body: expect.stringContaining("#7") },
      { kind: "add label", on: 12, label: "agent:in-progress" },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
      {
        kind: "dispatch agent run",
        factoryRepo: "owner/factory",
        workflow: "implement-spec-agent.yml",
        ref: "main",
        inputs: { factory_ref: "main", factory_sha: sha, mode: "build", spec: "7", issue: "12", job_timeout: "60" },
      },
    ]);
    expect(plan.actions[0]).toMatchObject({ body: expect.stringContaining("#12") });
  });

  it("builds a ticket only when neither the spec's lock nor the ticket's is held", () => {
    const decide = vi.fn((lockKey: LockKey): GateDecision =>
      lockKey.scope === "ticket" && lockKey.number === 12 ? { kind: "queued", reason: "lock" } : proceed
    );
    const plan = planSpecGate(input({ kind: "ready", ticket: 12 }, decide));

    expect(decide.mock.calls.map(([key]) => key)).toEqual([
      { scope: "ticket", repo: "owner/repo", number: 7 },
      { scope: "ticket", repo: "owner/repo", number: 12 },
    ]);
    expect(plan.actions).toEqual([
      { kind: "comment", on: 7, body: expect.stringContaining(marker) },
      { kind: "add label", on: 7, label: "factory:queued" },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
    ]);
  });

  it("queues a second label on a spec whose lock an earlier run holds, without reading the queue", () => {
    const survey = vi.fn((): QueueSurvey => ({ kind: "no queue" }));
    const plan = planSpecGate({ ...input({ kind: "no queue" }, () => ({ kind: "queued", reason: "lock" })), survey });

    expect(survey).not.toHaveBeenCalled();
    expect(plan.actions.slice(1)).toEqual([
      { kind: "add label", on: 7, label: "factory:queued" },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
    ]);
    expect(plan.record.outcome).toEqual({ kind: "queued" });
  });

  it("ends quietly, touching nothing, on an untrusted label", () => {
    const plan = planSpecGate(input({ kind: "no queue" }, () => ({ kind: "quiet end", reason: "untrusted labeller" })));

    expect(plan.actions).toEqual([]);
    expect(plan.record.outcome).toEqual({ kind: "stopped", reason: "quiet end, untrusted labeller" });
  });

  it("on a drained queue, says so and takes the label off", () => {
    const plan = planSpecGate(input({ kind: "drained" }));

    expect(plan.actions).toEqual([
      { kind: "comment", on: 7, body: expect.stringContaining("every ticket") },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
    ]);
    expect(plan.record.outcome).toEqual({ kind: "stopped", reason: "queue drained" });
  });

  it("with nothing ready, names the tickets held and takes the label off", () => {
    const plan = planSpecGate(input({ kind: "nothing ready", open: [10, 11], held: [10] }));

    expect(plan.actions).toEqual([
      { kind: "comment", on: 7, body: expect.stringMatching(/#10.*#11|#11.*#10/s) },
      { kind: "remove label", on: 7, label: "agent:implement-spec" },
    ]);
    expect(plan.record.outcome).toEqual({ kind: "stopped", reason: "nothing ready" });
  });
});
