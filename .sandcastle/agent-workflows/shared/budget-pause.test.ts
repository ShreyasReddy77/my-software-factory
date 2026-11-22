import { describe, expect, it } from "vitest";
import errors from "./fixtures/pause-errors.json" with { type: "json" };
import { classifyPause } from "./budget-pause";

// A Sunday afternoon, UTC: the runner's clock.
const now = new Date("2026-11-22T14:00:00Z");

describe("classifying a failed agent run's Claude error", () => {
  it("reads the session limit as a usage limit resetting at the next 3:45pm", () => {
    expect(classifyPause(errors.sessionLimit, now)).toEqual({
      kind: "usage limit",
      resetsAt: "2026-11-22T15:45:00.000Z",
    });
  });

  it("reads a reset time already past today as tomorrow's", () => {
    expect(classifyPause(errors.sessionLimit, new Date("2026-11-22T16:00:00Z"))).toEqual({
      kind: "usage limit",
      resetsAt: "2026-11-23T15:45:00.000Z",
    });
  });

  it("reads the weekly limit as a usage limit resetting on the coming Monday", () => {
    expect(classifyPause(errors.weeklyLimit, now)).toEqual({
      kind: "usage limit",
      resetsAt: "2026-11-23T00:00:00.000Z",
    });
  });

  it("reads a model-family limit as a usage limit", () => {
    expect(classifyPause(errors.opusLimit, now)).toEqual({ kind: "usage limit", resetsAt: "2026-11-22T20:00:00.000Z" });
  });

  it("keeps a usage limit that shows no reset time as a pause with no reset", () => {
    expect(classifyPause(errors.modelLimitNoReset, now)).toEqual({ kind: "usage limit" });
  });

  it.each([
    ["a credit balance too low", errors.creditTooLow],
    ["a spend limit", errors.spendLimit],
    ["exhausted usage credits", errors.usageCreditsExhausted],
  ])("reads %s as out of credit, with no reset", (_, text) => {
    expect(classifyPause(text, now)).toEqual({ kind: "out of credit" });
  });

  it.each([
    ["the 85% warning", errors.usageWarning],
    ["the server's own throttle", errors.serverThrottle],
    ["an overload", errors.overloaded],
    ["an unrelated crash", errors.unrelated],
  ])("does not pause on %s", (_, text) => {
    expect(classifyPause(text, now)).toEqual({ kind: "not a pause" });
  });
});
