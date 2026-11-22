import { describe, expect, it } from "vitest";
import { classifyAgentEnd, decideAgentRunEnd, reportAgentRun, type AgentRunFacts } from "./run-end";
import { CeilingHit } from "../shared/common";

const built: AgentRunFacts = {
  agentEnd: { kind: "finished" },
  commits: 3,
  treeClean: true,
  guard: { verdict: "push" },
};

const failedTry = { kind: "failed try", try: 1, of: 1 } as const;

describe("how an agent run ends", () => {
  it("pushes a finished, clean, guarded run and hands its PR to review", () => {
    expect(decideAgentRunEnd(built)).toEqual({ push: true, handOffToReview: true, outcome: { kind: "done" }, why: "" });
  });

  it("pushes a run that hit its ceiling as a draft, without review, as a ceiling hit", () => {
    const end = decideAgentRunEnd({ ...built, agentEnd: { kind: "ceiling hit", message: "implement hit its ceiling of 45 agent minutes" } });

    expect(end).toEqual({
      push: true,
      handOffToReview: false,
      outcome: { kind: "ceiling hit" },
      why: "implement hit its ceiling of 45 agent minutes",
    });
  });

  it("pushes nothing when the ceiling came before any commit", () => {
    const end = decideAgentRunEnd({ ...built, agentEnd: { kind: "ceiling hit", message: "max turns" }, commits: 0, guard: undefined });

    expect(end).toMatchObject({ push: false, outcome: { kind: "ceiling hit" } });
  });

  it("pushes nothing and counts a failed try when the push guard refuses", () => {
    const end = decideAgentRunEnd({ ...built, guard: { verdict: "refuse", reasons: "A change under .github/workflows/: x.yml" } });

    expect(end).toEqual({
      push: false,
      handOffToReview: false,
      outcome: failedTry,
      why: "The push guard refused the agent's commits, so nothing was pushed.\n\nA change under .github/workflows/: x.yml",
    });
  });

  it("never pushes past a refusal, even at the ceiling", () => {
    const end = decideAgentRunEnd({
      ...built,
      agentEnd: { kind: "ceiling hit", message: "ceiling" },
      guard: { verdict: "refuse", reasons: "secret" },
    });

    expect(end).toMatchObject({ push: false, outcome: failedTry });
  });

  it("counts a failed try when the agent finished without committing", () => {
    const end = decideAgentRunEnd({ ...built, commits: 0, guard: undefined });

    expect(end).toMatchObject({ push: false, outcome: failedTry, why: expect.stringContaining("without committing") });
  });

  it("counts a failed try when the agent left uncommitted changes", () => {
    const end = decideAgentRunEnd({ ...built, treeClean: false });

    expect(end).toMatchObject({ push: false, outcome: failedTry, why: expect.stringContaining("uncommitted") });
  });

  it("counts a crash as a failed try and pushes nothing", () => {
    const end = decideAgentRunEnd({ ...built, agentEnd: { kind: "crashed", message: "Agent exited with code 1" } });

    expect(end).toMatchObject({ push: false, outcome: failedTry, why: expect.stringContaining("Agent exited with code 1") });
  });

  it("refuses to push commits the push guard never scanned", () => {
    const end = decideAgentRunEnd({ ...built, guard: undefined });

    expect(end).toMatchObject({ push: false, outcome: failedTry });
  });
});

describe("telling a ceiling from a crash", () => {
  it("reads the launcher's time ceiling as a ceiling hit", () => {
    expect(classifyAgentEnd(new CeilingHit("implement", 45))).toEqual({
      kind: "ceiling hit",
      message: "implement hit its ceiling of 45 agent minutes",
    });
  });

  it("reads Claude Code's max-turns stop as a ceiling hit", () => {
    expect(classifyAgentEnd(new Error("Agent failed: error_max_turns"))).toMatchObject({ kind: "ceiling hit" });
  });

  it("reads anything else as a crash", () => {
    expect(classifyAgentEnd(new Error("spawn claude ENOENT"))).toEqual({ kind: "crashed", message: "spawn claude ENOENT" });
  });
});

const runUrl = "https://github.com/owner/repo/actions/runs/7";

describe("reporting an agent run on its ticket", () => {
  it("links the PR and names agent:review next when the run built and handed off", () => {
    const report = reportAgentRun(decideAgentRunEnd(built), {
      prUrl: "https://github.com/owner/repo/pull/9",
      handedOff: true,
      hostStepFailed: false,
      runUrl,
    });

    expect(report).toEqual({
      block: false,
      outcome: { kind: "done" },
      nextLabel: "agent:review",
      comment: expect.stringContaining("https://github.com/owner/repo/pull/9"),
    });
    expect(report.comment).toContain("<!-- factory:status -->");
  });

  it("blocks the ticket at a ceiling hit and says to re-add the trigger to retry", () => {
    const end = decideAgentRunEnd({ ...built, agentEnd: { kind: "ceiling hit", message: "ceiling of 45 agent minutes" } });

    const report = reportAgentRun(end, { prUrl: "https://github.com/owner/repo/pull/9", handedOff: false, hostStepFailed: false, runUrl });

    expect(report).toMatchObject({ block: true, outcome: { kind: "ceiling hit" }, nextLabel: "agent:blocked" });
    expect(report.comment).toContain("ceiling of 45 agent minutes");
    expect(report.comment).toContain("Re-add `agent:implement` to retry");
  });

  it("puts the push guard's reasons in the comment", () => {
    const end = decideAgentRunEnd({ ...built, guard: { verdict: "refuse", reasons: "gitleaks found aws-access-token" } });

    const report = reportAgentRun(end, { handedOff: false, hostStepFailed: false, runUrl });

    expect(report).toMatchObject({ block: true, outcome: failedTry, nextLabel: "agent:blocked" });
    expect(report.comment).toContain("gitleaks found aws-access-token");
  });

  it("counts a failed host step as a failed try even after a good agent run", () => {
    const report = reportAgentRun(decideAgentRunEnd(built), { handedOff: false, hostStepFailed: true, runUrl });

    expect(report).toMatchObject({ block: true, outcome: failedTry, nextLabel: "agent:blocked" });
    expect(report.comment).toContain(runUrl);
  });

  it("asks for agent:review by hand, not a rebuild, when only the hand-off failed", () => {
    const report = reportAgentRun(decideAgentRunEnd(built), {
      prUrl: "https://github.com/owner/repo/pull/9",
      handedOff: false,
      hostStepFailed: true,
      runUrl,
    });

    expect(report.comment).toContain("Add `agent:review` to it");
    expect(report.comment).not.toContain("Re-add `agent:implement`");
  });
});
