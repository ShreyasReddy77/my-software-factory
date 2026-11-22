import { describe, expect, it } from "vitest";
import { classifyAgentEnd, pausedComment } from "./agent-end";
import { CeilingHit } from "./common";
import pauseErrors from "./fixtures/pause-errors.json" with { type: "json" };
import { readMarker } from "./marker";

const now = new Date("2026-11-22T14:00:00Z");

describe("telling a ceiling from a crash", () => {
  it("reads the launcher's time ceiling as a ceiling hit", () => {
    expect(classifyAgentEnd(new CeilingHit("implement", 45), now)).toEqual({
      kind: "ceiling hit",
      message: "implement hit its ceiling of 45 agent minutes",
    });
  });

  it("reads Claude Code's max-turns stop as a ceiling hit", () => {
    expect(classifyAgentEnd(new Error("Agent failed: error_max_turns"), now)).toMatchObject({ kind: "ceiling hit" });
  });

  it("reads anything else as a crash", () => {
    expect(classifyAgentEnd(new Error("spawn claude ENOENT"), now)).toEqual({ kind: "crashed", message: "spawn claude ENOENT" });
  });

  it("reads a Claude usage limit as a pause, with its reset", () => {
    expect(classifyAgentEnd(new Error(`Agent failed: ${pauseErrors.sessionLimit}`), now)).toEqual({
      kind: "paused",
      pause: { kind: "usage limit", resetsAt: "2026-11-22T15:45:00.000Z" },
      message: `Agent failed: ${pauseErrors.sessionLimit}`,
    });
  });

  it("reads running out of credit as a pause with no reset", () => {
    expect(classifyAgentEnd(new Error(pauseErrors.creditTooLow), now)).toMatchObject({
      kind: "paused",
      pause: { kind: "out of credit" },
    });
  });
});

describe("the comment on an item a Claude limit paused", () => {
  const comment = pausedComment({
    pause: { kind: "out of credit" },
    runUrl: "https://github.com/o/r/actions/runs/1",
    untouched: "written",
    restartTask: "implement-spec",
    restartWhat: "the spec",
  });

  it("says nothing was touched and that it is not a try", () => {
    expect(comment).toContain("Nothing was written, and this is not a try.");
  });

  it("names what restarts and leaves the marker the requeue run restarts it by", () => {
    expect(comment).toContain("restarts the spec as `agent:implement-spec`");
    expect(readMarker(comment)).toBe("agent:implement-spec");
  });
});
