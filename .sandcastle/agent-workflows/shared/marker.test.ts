import { describe, expect, it } from "vitest";
import { markerForms, readMarker, writeMarker, type MarkerForm } from "./marker";

describe("the hidden marker", () => {
  it("names the trigger label the item restarts as, hidden in a comment", () => {
    expect(writeMarker("agent:implement")).toBe(
      "<!-- factory:restart-as v1 agent:implement -->"
    );
  });

  it("reads the trigger label back out of a comment body", () => {
    const body = `Queued: the daily cap is full.\n\n${writeMarker("agent:review")}`;
    expect(readMarker(body)).toBe("agent:review");
  });

  it.each([
    "Queued: the daily cap is full.",
    "<!-- factory:status -->",
    "<!-- factory:restart-as v1 agent:not-a-task -->",
    "<!-- factory:restart-as v1 factory:queued -->",
    "<!-- factory:restart-as v99 agent:implement -->",
    "`<!-- factory:restart-as v1 agent:implement` -->",
  ])("finds no marker in %j", (body) => {
    expect(readMarker(body)).toBeUndefined();
  });

  it("still reads a previous release's form once a new form is current", () => {
    const nextForm: MarkerForm = {
      write: (label) => `<!-- factory:marker v2 restart-as=${label} -->`,
      read: (body) =>
        /<!-- factory:marker v2 restart-as=(\S+) -->/.exec(body)?.[1],
    };
    const nextRelease = [nextForm, ...markerForms];
    const previousBody = writeMarker("agent:explore");

    expect(readMarker(previousBody, nextRelease)).toBe("agent:explore");
    expect(
      readMarker(writeMarker("agent:implement", nextRelease), nextRelease)
    ).toBe("agent:implement");
  });
});
