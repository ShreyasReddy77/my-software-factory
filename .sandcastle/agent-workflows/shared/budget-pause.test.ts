import { describe, expect, it } from "vitest";
import errors from "./fixtures/pause-errors.json" with { type: "json" };
import { classifyPause, pauseItemText, pauseTicketBody, pauseTitle, readBudgetPause } from "./budget-pause";

// A Sunday afternoon, UTC: the runner's clock.
const now = new Date("2026-11-22T14:00:00Z");
const timed = { kind: "usage limit", resetsAt: "2026-11-22T15:45:00.000Z" } as const;

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

describe("the words a pause is reported in", () => {
  it("titles the budget-pause ticket with the reset time", () => {
    expect(pauseTitle(timed)).toBe("Claude usage paused until 2026-11-22 15:45 UTC");
  });

  it("titles a credit pause with no time", () => {
    expect(pauseTitle({ kind: "out of credit" })).toBe("Out of Claude credit");
  });

  it("tells the item it is paused until the reset", () => {
    expect(pauseItemText(timed)).toBe("Paused: usage limit, resets at 2026-11-22 15:45 UTC");
  });

  it("tells the item it is paused with no reset when credit ran out", () => {
    expect(pauseItemText({ kind: "out of credit" })).toBe("Paused: out of Claude credit, no reset time");
  });

  it("says when a usage limit showed no reset time", () => {
    expect(pauseItemText({ kind: "usage limit" })).toBe("Paused: usage limit, reset time unknown");
    expect(pauseTitle({ kind: "usage limit" })).toBe("Claude usage paused, reset time unknown");
  });
});

describe("reading the budget-pause ticket from the factory's open issues", () => {
  const app = "my-factory[bot]";
  const ticketOf = (pause: Parameters<typeof pauseTicketBody>[0], number = 7, login = app) => ({
    number,
    title: pauseTitle(pause),
    body: pauseTicketBody(pause),
    user: { login },
  });

  it("finds no pause when no budget-pause ticket is open", () => {
    expect(readBudgetPause([{ number: 3, title: "Fix the login page", body: "", user: { login: app } }], app)).toEqual({
      open: false,
    });
  });

  it("reads an open timed pause and its reset", () => {
    expect(readBudgetPause([ticketOf(timed)], app)).toEqual({
      open: true,
      ticket: 7,
      until: new Date("2026-11-22T15:45:00Z"),
    });
  });

  it("reads an open credit pause, which has no reset", () => {
    expect(readBudgetPause([ticketOf({ kind: "out of credit" })], app)).toEqual({ open: true, ticket: 7 });
  });

  it("ignores a look-alike ticket someone other than the factory opened", () => {
    expect(readBudgetPause([ticketOf({ kind: "out of credit" }, 9, "stranger")], app)).toEqual({ open: false });
  });

  it("ignores pull requests", () => {
    expect(readBudgetPause([{ ...ticketOf(timed), pull_request: {} }], app)).toEqual({ open: false });
  });

  it("reads the lowest-numbered ticket when two are open", () => {
    expect(readBudgetPause([ticketOf({ kind: "out of credit" }, 12), ticketOf(timed, 8)], app)).toMatchObject({
      ticket: 8,
    });
  });
});
