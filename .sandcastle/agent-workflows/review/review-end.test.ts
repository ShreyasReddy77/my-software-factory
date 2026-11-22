import { describe, expect, it } from "vitest";
import { closedTicket, decideReviewEnd, reportReview, type ReviewReportFacts } from "./review-end";

describe("the ticket a PR closes, which is the review's spec", () => {
  it.each([
    ["Built it.\n\nCloses #12. Built unattended.", 12],
    ["fixes #3 and closes #4", 3],
    ["RESOLVES #7", 7],
  ])("is read from %j", (body, number) => {
    expect(closedTicket(body)).toBe(number);
  });

  it("is missing when the body names none", () => {
    expect(closedTicket("See #12 for context.")).toBeUndefined();
    expect(closedTicket(null)).toBeUndefined();
  });
});

const finished = { kind: "finished" } as const;
const clean = { verdict: "push" } as const;

describe("whether the review's fixes are pushed", () => {
  it("pushes a finished review's clean commits", () => {
    expect(decideReviewEnd({ agentEnd: finished, commits: 2, guard: clean })).toMatchObject({
      push: true,
      outcome: { kind: "done" },
    });
  });

  it("has nothing to push when the review fixed nothing, and is still done", () => {
    expect(decideReviewEnd({ agentEnd: finished, commits: 0 })).toEqual({ push: false, outcome: { kind: "done" }, why: "" });
  });

  it("pushes what a review at its ceiling committed, and records the ceiling", () => {
    const end = decideReviewEnd({ agentEnd: { kind: "ceiling hit", message: "review hit its ceiling" }, commits: 1, guard: clean });

    expect(end).toEqual({ push: true, outcome: { kind: "ceiling hit" }, why: "review hit its ceiling" });
  });

  it("pushes nothing the push guard refused, as a failed try", () => {
    const end = decideReviewEnd({ agentEnd: finished, commits: 1, guard: { verdict: "refuse", reasons: "- the Claude token" } });

    expect(end.push).toBe(false);
    expect(end.outcome).toEqual({ kind: "failed try", try: 1, of: 1 });
    expect(end.why).toContain("- the Claude token");
  });

  it("pushes nothing the push guard never scanned", () => {
    expect(decideReviewEnd({ agentEnd: finished, commits: 1 }).push).toBe(false);
  });

  it("pushes nothing when Claude's usage paused, and is not a try", () => {
    const pause = { kind: "usage limit", resetsAt: "2026-11-22T15:45:00.000Z" } as const;
    const end = decideReviewEnd({ agentEnd: { kind: "paused", pause, message: "You've hit your limit" }, commits: 1, guard: clean });

    expect(end).toEqual({ push: false, outcome: { kind: "paused" }, why: "You've hit your limit", pause });
  });

  it("pushes nothing after a crash", () => {
    const end = decideReviewEnd({ agentEnd: { kind: "crashed", message: "boom" }, commits: 3, guard: clean });

    expect(end).toMatchObject({ push: false, outcome: { kind: "failed try", try: 1, of: 1 } });
  });
});

describe("the review's report on its PR", () => {
  const verdict = "## Standards: PASS\nFine.\n\n## Spec: PASS\nFine.";
  const facts: ReviewReportFacts = {
    verdict,
    pushRejected: false,
    hostStepFailed: false,
    branch: "agent/issue-5-1",
    fallbackBranch: "agent/issue-5-1-2",
    runUrl: "https://github.com/owner/repo/actions/runs/2",
  };
  const done = { push: true, outcome: { kind: "done" }, why: "" } as const;

  it("marks the PR ready once a real verdict is posted, pass or fail", () => {
    const failing = verdict.replace("Standards: PASS", "Standards: CHANGES REQUESTED");

    expect(reportReview(done, facts)).toMatchObject({ ready: true, block: false });
    expect(reportReview(done, { ...facts, verdict: failing })).toMatchObject({ ready: true, block: false });
  });

  it("keeps the PR a draft when there is no verdict, and says how to retry", () => {
    const report = reportReview(done, { ...facts, verdict: "" });

    expect(report.ready).toBe(false);
    expect(report.comment).toContain("The review run produced no verdict. See the logs. Re-add `agent:review` to retry.");
  });

  it("blocks the PR when the push was rejected, naming the branch the fixes went to", () => {
    const report = reportReview(done, { ...facts, pushRejected: true, fallbackUrl: "https://github.com/owner/repo/pull/8" });

    expect(report.block).toBe(true);
    expect(report.comment).toContain("The fixes are on `agent/issue-5-1-2`, opened as https://github.com/owner/repo/pull/8.");
  });

  it("blocks and keeps a draft after a failed host step, a ceiling or a refused push", () => {
    expect(reportReview(done, { ...facts, hostStepFailed: true })).toMatchObject({ ready: false, block: true });
    const refused = { push: false, outcome: { kind: "failed try", try: 1, of: 1 }, why: "The push guard refused." } as const;
    const report = reportReview(refused, facts);
    expect(report).toMatchObject({ ready: false, block: true });
    expect(report.comment).toContain("The push guard refused.");
  });

  it("signs the verdict with what the run saw, and hides nothing from the next run", () => {
    const report = reportReview(done, facts);

    expect(report.comment).toContain("saw the diff, the standards and the ticket, and nothing else.");
    expect(report.comment).not.toContain("factory:status");
  });

  it("on a pause, labels the PR factory:paused with a marker to restart it, keeps it a draft and blocks nothing", () => {
    const pause = { kind: "usage limit", resetsAt: "2026-11-22T15:45:00.000Z" } as const;
    const report = reportReview({ push: false, outcome: { kind: "paused" }, why: "limit", pause }, { ...facts, verdict: "" });

    expect(report).toMatchObject({ ready: false, block: false, nextLabel: "factory:paused", outcome: { kind: "paused" } });
    expect(report.comment).toContain("Paused: usage limit, resets at 2026-11-22 15:45 UTC");
    expect(report.comment).toContain("<!-- factory:restart-as v1 agent:review -->");
    expect(report.comment).toContain("<!-- factory:status -->");
  });

  it("records the next label it set for the run summary", () => {
    expect(reportReview(done, facts).nextLabel).toBeUndefined();
    expect(reportReview(done, { ...facts, hostStepFailed: true }).nextLabel).toBe("agent:blocked");
  });
});
