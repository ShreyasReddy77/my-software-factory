import { describe, expect, it } from "vitest";
import { planExploreFinish } from "./finish-plan";

const runUrl = "https://github.com/owner/repo/actions/runs/1";
const finished = { kind: "finished" } as const;

describe("the end of an explore run", () => {
  it("is done when the agent finished and the plan was applied, blocking nothing", () => {
    const finish = planExploreFinish({ agentEnd: finished, jobResults: ["success", "success"], stillInProgress: [], runUrl });

    expect(finish).toMatchObject({ outcome: { kind: "done" }, block: [], pause: [] });
  });

  it("blocks only the batch issues apply did not get to, when any job failed", () => {
    const finish = planExploreFinish({ agentEnd: finished, jobResults: ["success", "failure"], stillInProgress: [4, 9], runUrl });

    expect(finish.block).toEqual([4, 9]);
    expect(finish.outcome).toEqual({ kind: "failed try", try: 1, of: 1 });
    expect(finish.comment).toBe(
      `Explore run **failed** — [logs](${runUrl}). Re-add \`agent:explore\` to retry. <!-- factory:status -->`
    );
  });

  it("records a ceiling hit as its own outcome, and still blocks the batch", () => {
    const finish = planExploreFinish({
      agentEnd: { kind: "ceiling hit", message: "explore hit its ceiling of 15 agent minutes" },
      jobResults: ["success", "failure"],
      stillInProgress: [4],
      runUrl,
    });

    expect(finish.outcome).toEqual({ kind: "ceiling hit" });
    expect(finish.block).toEqual([4]);
    expect(finish.comment).toContain("hit its ceiling");
  });

  it("on a Claude pause, pauses the batch issues with a marker each, blocking none and counting no try", () => {
    const pause = { kind: "out of credit" } as const;
    const finish = planExploreFinish({
      agentEnd: { kind: "paused", pause, message: "Credit balance is too low" },
      jobResults: ["success", "failure"],
      stillInProgress: [4, 9],
      runUrl,
    });

    expect(finish).toMatchObject({ outcome: { kind: "paused" }, block: [], pause: [4, 9], pauseReason: pause });
    expect(finish.comment).toContain("Paused: out of Claude credit, no reset time");
    expect(finish.comment).toContain("<!-- factory:restart-as v1 agent:explore -->");
  });

  it("counts a run whose agent job never recorded an end as a failed try", () => {
    const finish = planExploreFinish({ agentEnd: undefined, jobResults: ["failure", "skipped"], stillInProgress: [4], runUrl });

    expect(finish.outcome).toEqual({ kind: "failed try", try: 1, of: 1 });
  });
});
