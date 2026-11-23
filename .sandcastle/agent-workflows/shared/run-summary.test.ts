import { describe, expect, it } from "vitest";
import { renderRunSummary, type OutcomeRecord } from "./run-summary";

const agentRun: OutcomeRecord = {
  task: "implement",
  targetRepo: "owner/repo",
  item: { kind: "issue", number: 5 },
  outcome: { kind: "done" },
  turns: 42,
  seconds: 725,
  model: "claude-opus-5-5",
  tokens: { input: 120345, output: 6789 },
  nextLabel: "agent:review",
};

describe("the run summary", () => {
  it("renders an agent run's outcome record as a table", () => {
    expect(renderRunSummary(agentRun)).toBe(
      [
        "## implement: done",
        "",
        "| | |",
        "|---|---|",
        "| Task | implement |",
        "| Item | [owner/repo#5](https://github.com/owner/repo/issues/5) |",
        "| Outcome | done |",
        "| Turns | 42 |",
        "| Time | 12m 5s |",
        "| Model | claude-opus-5-5 |",
        "| Tokens | 120,345 in, 6,789 out |",
        "| Next label | `agent:review` |",
        "",
      ].join("\n")
    );
  });

  it.each<[OutcomeRecord["outcome"], string]>([
    [{ kind: "done" }, "done"],
    [{ kind: "queued" }, "queued"],
    [{ kind: "paused" }, "paused"],
    [{ kind: "stopped", reason: "unclear ticket" }, "stopped: unclear ticket"],
    [{ kind: "failed try", try: 2, of: 3 }, "failed try 2 of 3"],
    [{ kind: "ceiling hit" }, "ceiling hit"],
  ])("renders the outcome %j with every required field", (outcome, written) => {
    const summary = renderRunSummary({ ...agentRun, outcome });
    expect(summary).toContain(`## implement: ${written}\n`);
    expect(summary).toContain(`| Outcome | ${written} |`);
    for (const field of ["Task", "Item", "Turns", "Time", "Model", "Tokens", "Next label"])
      expect(summary).toMatch(new RegExp(`^\\| ${field} \\| .+ \\|$`, "m"));
  });

  it("renders a gate run, which calls no model, in the same format", () => {
    const summary = renderRunSummary({
      task: "review",
      targetRepo: "owner/repo",
      item: { kind: "pr", number: 9 },
      outcome: { kind: "queued" },
      seconds: 14,
      nextLabel: "factory:queued",
    });
    expect(summary).toContain("| Item | [owner/repo#9](https://github.com/owner/repo/pull/9) |");
    expect(summary).toContain("| Turns | none |");
    expect(summary).toContain("| Time | 0m 14s |");
    expect(summary).toContain("| Model | none |");
    expect(summary).toContain("| Tokens | not reported |");
    expect(summary).toContain("| Next label | `factory:queued` |");
  });

  it("links the repo when the run worked on no single item, and says when it set no label", () => {
    const summary = renderRunSummary({
      task: "explore",
      targetRepo: "owner/repo",
      outcome: { kind: "done" },
      seconds: 60,
    });
    expect(summary).toContain("| Item | [owner/repo](https://github.com/owner/repo) |");
    expect(summary).toContain("| Next label | none |");
  });

  describe("the requeue run's budget gauge", () => {
    const requeueRun: OutcomeRecord = {
      task: "requeue",
      targetRepo: "owner/factory",
      outcome: { kind: "done" },
      seconds: 31,
    };

    it("renders counts against the cap and concurrency, an open pause with its reset, and items restarted", () => {
      const summary = renderRunSummary({
        ...requeueRun,
        gauge: {
          todaysRuns: 5,
          dailyRuns: 8,
          runsInFlight: 1,
          concurrentRuns: 1,
          budgetPause: { open: true, until: new Date("2026-11-22T15:00:00Z") },
          restarted: 2,
        },
      });
      expect(summary).toContain(
        [
          "### Budget gauge",
          "",
          "| | |",
          "|---|---|",
          "| Today's agent runs | 5 of 8 |",
          "| Runs in flight | 1 of 1 |",
          "| Budget pause | open until 2026-11-22 15:00 UTC |",
          "| Items restarted | 2 |",
          "",
        ].join("\n")
      );
    });

    it.each<[{ open: false } | { open: true; until?: Date }, string]>([
      [{ open: false }, "closed"],
      [{ open: true }, "open, no reset time"],
    ])("writes the pause %j as %s", (budgetPause, written) => {
      const summary = renderRunSummary({
        ...requeueRun,
        gauge: { todaysRuns: 0, dailyRuns: 8, runsInFlight: 0, concurrentRuns: 1, budgetPause, restarted: 0 },
      });
      expect(summary).toContain(`| Budget pause | ${written} |`);
    });

    it("leaves the gauge out of other runs' summaries", () => {
      expect(renderRunSummary(agentRun)).not.toContain("Budget gauge");
    });
  });

  it("keeps a stop reason from breaking the table", () => {
    const summary = renderRunSummary({ ...agentRun, outcome: { kind: "stopped", reason: "a | b" } });
    expect(summary).toContain("| Outcome | stopped: a \\| b |");
  });
});
