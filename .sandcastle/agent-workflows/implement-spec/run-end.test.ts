import { describe, expect, it } from "vitest";
import { decideAgentRunEnd } from "../implement/run-end";
import { reportBuild, reportSplit } from "./run-end";

const runUrl = "https://github.com/owner/repo/actions/runs/1";
const status = "<!-- factory:status -->";

describe("reporting a split", () => {
  it("on a written queue, asks for the label again to start building, and blocks nothing", () => {
    const report = reportSplit({ agentEnd: { kind: "finished" }, written: 4, spec: 7, hostStepFailed: false, runUrl });

    expect(report).toMatchObject({ block: false, outcome: { kind: "done" } });
    expect(report.comment).toContain("4 tickets");
    expect(report.comment).toContain("`spec:7`");
    expect(report.comment).toContain("Re-add `agent:implement-spec`");
    expect(report.comment).toContain(status);
  });

  it("on a crash, blocks the spec as a failed try and says how to retry", () => {
    const report = reportSplit({
      agentEnd: { kind: "crashed", message: "boom" },
      spec: 7,
      hostStepFailed: false,
      runUrl,
    });

    expect(report).toMatchObject({ block: true, outcome: { kind: "failed try", try: 1, of: 1 }, nextLabel: "agent:blocked" });
    expect(report.comment).toContain("boom");
    expect(report.comment).toContain("Re-add `agent:implement-spec`");
  });

  it("on a ceiling hit, blocks the spec and records the ceiling", () => {
    const report = reportSplit({
      agentEnd: { kind: "ceiling hit", message: "implement-spec hit its ceiling of 30 agent minutes" },
      spec: 7,
      hostStepFailed: false,
      runUrl,
    });

    expect(report).toMatchObject({ block: true, outcome: { kind: "ceiling hit" } });
  });

  it("on a Claude limit, pauses the spec to restart as implement-spec, as no try", () => {
    const report = reportSplit({
      agentEnd: { kind: "paused", pause: { kind: "out of credit" }, message: "Credit balance is too low" },
      spec: 7,
      hostStepFailed: false,
      runUrl,
    });

    expect(report).toMatchObject({ block: false, outcome: { kind: "paused" }, nextLabel: "factory:paused", pause: { kind: "out of credit" } });
    expect(report.comment).toContain("<!-- factory:restart-as v1 agent:implement-spec -->");
  });

  it("when a host step failed after the agent finished, blocks the spec as a failed try", () => {
    const report = reportSplit({ agentEnd: { kind: "finished" }, written: 2, spec: 7, hostStepFailed: true, runUrl });

    expect(report).toMatchObject({ block: true, outcome: { kind: "failed try", try: 1, of: 1 } });
  });
});

describe("reporting a build", () => {
  const done = decideAgentRunEnd({ agentEnd: { kind: "finished" }, commits: 2, treeClean: true, guard: { verdict: "push" } });
  const prUrl = "https://github.com/owner/repo/pull/30";

  it("once the draft PR is handed to review, closes the ticket so the queue moves on", () => {
    const report = reportBuild(done, { prUrl, handedOff: true, hostStepFailed: false, runUrl, spec: 7 });

    expect(report).toMatchObject({ block: false, close: true, outcome: { kind: "done" }, nextLabel: "agent:review" });
    expect(report.comment).toContain(prUrl);
  });

  it("on a failed build, blocks the ticket, keeps it open and says how to put it back", () => {
    const failed = decideAgentRunEnd({ agentEnd: { kind: "finished" }, commits: 0, treeClean: true });
    const report = reportBuild(failed, { handedOff: false, hostStepFailed: false, runUrl, spec: 7 });

    expect(report).toMatchObject({ block: true, close: false, outcome: { kind: "failed try" } });
    expect(report.comment).toContain("Take `agent:blocked` off");
    expect(report.comment).toContain("`agent:implement-spec` to #7");
  });

  it("on a ceiling hit, keeps the ticket open with its draft", () => {
    const ceiling = decideAgentRunEnd({
      agentEnd: { kind: "ceiling hit", message: "implement hit its ceiling of 45 agent minutes" },
      commits: 1,
      treeClean: true,
      guard: { verdict: "push" },
    });
    const report = reportBuild(ceiling, { prUrl, handedOff: false, hostStepFailed: false, runUrl, spec: 7 });

    expect(report).toMatchObject({ block: true, close: false, outcome: { kind: "ceiling hit" } });
  });

  it("on a Claude limit, frees the ticket and pauses the spec, which restarts as implement-spec", () => {
    const paused = decideAgentRunEnd({
      agentEnd: { kind: "paused", pause: { kind: "out of credit" }, message: "Credit balance is too low" },
      commits: 0,
      treeClean: true,
    });
    const report = reportBuild(paused, { handedOff: false, hostStepFailed: false, runUrl, spec: 7 });

    expect(report).toMatchObject({ block: false, close: false, outcome: { kind: "paused" }, pause: { kind: "out of credit" } });
    expect(report.comment).not.toContain("restart-as");
    expect(report.specPause).toEqual({
      label: "factory:paused",
      comment: expect.stringContaining("<!-- factory:restart-as v1 agent:implement-spec -->"),
    });
  });

  it("when the hand-off to review failed, keeps the ticket open and blocked", () => {
    const report = reportBuild(done, { prUrl, handedOff: false, hostStepFailed: true, runUrl, spec: 7 });

    expect(report).toMatchObject({ block: true, close: false });
    expect(report.comment).toContain("Add `agent:review`");
  });
});
