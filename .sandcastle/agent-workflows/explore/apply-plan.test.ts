import { describe, expect, it } from "vitest";
import { checkPlan, planApply } from "./apply-plan";
import { explorePlanSchema } from "./plan-schema";

const entry = (number: number, tag = "easy-call", extra: Record<string, unknown> = {}) => ({
  number,
  tag,
  comment: `Findings for #${number}.`,
  ...extra,
});

describe("checking the explore plan before anything is written", () => {
  it("passes a plan with one good entry per batch issue", () => {
    expect(checkPlan({ issues: [entry(3), entry(5, "blocked")] }, [3, 5])).toEqual([]);
  });

  it("refuses a plan that misses or repeats a batch issue", () => {
    expect(checkPlan({ issues: [entry(3), entry(3)] }, [3, 5])).toEqual([
      "The plan needs exactly one entry for each of [3,5].",
    ]);
  });

  it("refuses a tag it does not know, so the whole plan is refused", () => {
    expect(checkPlan({ issues: [entry(3, "ship-it")] }, [3])).toEqual([
      expect.stringContaining("not the shape the explore run promised"),
    ]);
  });

  it("refuses a duplicate of an issue that is not a surviving batch issue", () => {
    const plan = { issues: [entry(3, "easy-call", { duplicate_of: 5 }), entry(5, "easy-call", { duplicate_of: 3 })] };

    expect(checkPlan(plan, [3, 5])).toEqual([
      "#3 is a duplicate of #5, which is not a surviving issue in this batch.",
      "#5 is a duplicate of #3, which is not a surviving issue in this batch.",
    ]);
  });

  it("refuses a plan that is not JSON-shaped as promised", () => {
    expect(checkPlan(undefined, [3])).toHaveLength(1);
  });
});

describe("applying the explore plan", () => {
  const runUrl = "https://github.com/owner/repo/actions/runs/1";
  const plan = explorePlanSchema.parse({
    issues: [
      entry(9, "easy-call", { duplicate_of: 3 }),
      entry(5, "needs-a-human"),
      entry(3),
      entry(4, "blocked"),
    ],
  });

  it("writes survivors first, then duplicates, oldest first within each", () => {
    expect(planApply(plan, runUrl).map((write) => write.number)).toEqual([3, 4, 5, 9]);
  });

  it("hands an easy call to the implementer and every other tag to a human", () => {
    const writes = planApply(plan, runUrl);

    expect(writes.map((write) => [write.number, write.addLabel, write.close])).toEqual([
      [3, "agent:implement", false],
      [4, "needs-a-human", false],
      [5, "needs-a-human", false],
      [9, undefined, true],
    ]);
  });

  it("ends each comment with what happens next and the run's logs", () => {
    const [easy, blocked, , duplicate] = planApply(plan, runUrl);

    expect(easy?.comment).toBe(
      `Findings for #3.\n\n---\n\n_Easy call. Handed to the implementer. Nobody is being asked first._ [Logs](${runUrl})\n`
    );
    expect(blocked?.comment).toContain("Stopped at `blocked`. Settle the open questions, then label `agent:implement` yourself.");
    expect(duplicate?.comment).toContain("_Closed as duplicate of #3._");
  });

  it("leaves the findings comments readable by the implementer: no status marker", () => {
    for (const write of planApply(plan, runUrl)) expect(write.comment).not.toContain("factory:status");
  });
});
