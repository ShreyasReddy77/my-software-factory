import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBudget } from "./budget";

const validBudget = `
credential: subscription
daily_runs: 8
concurrent_runs: 1
priority:
  - [merge]
  - [fix-ci, address-review]
  - [review]
  - [implement, implement-spec]
  - [explore, map, lesson-draft, self-improvement]
tasks:
  explore: { model: claude-sonnet-5-5, max_turns: 30, agent_minutes: 15 }
  implement: { model: claude-opus-5-5, max_turns: 80, agent_minutes: 45 }
  implement-spec: { model: claude-opus-5-5, max_turns: 50, agent_minutes: 30 }
  review: { model: claude-opus-5-5, max_turns: 30, agent_minutes: 15 }
`;

const withLine = (from: string, to: string): string => {
  expect(validBudget).toContain(from);
  return validBudget.replace(from, to);
};

describe("loading budget.yml", () => {
  it("turns a valid file into a typed budget", () => {
    expect(parseBudget(validBudget)).toEqual({
      credential: "subscription",
      dailyRuns: 8,
      concurrentRuns: 1,
      priority: [
        ["merge"],
        ["fix-ci", "address-review"],
        ["review"],
        ["implement", "implement-spec"],
        ["explore", "map", "lesson-draft", "self-improvement"],
      ],
      tasks: {
        explore: { model: "claude-sonnet-5-5", maxTurns: 30, agentMinutes: 15 },
        implement: { model: "claude-opus-5-5", maxTurns: 80, agentMinutes: 45 },
        "implement-spec": { model: "claude-opus-5-5", maxTurns: 50, agentMinutes: 30 },
        review: { model: "claude-opus-5-5", maxTurns: 30, agentMinutes: 15 },
      },
    });
  });

  it("refuses an agent task missing from tasks:", () => {
    const text = withLine(
      "  review: { model: claude-opus-5-5, max_turns: 30, agent_minutes: 15 }\n",
      ""
    );
    expect(() => parseBudget(text)).toThrow(/review.*missing from tasks:/);
  });

  it.each(["opus", "sonnet", "claude-opus-latest", "opusplan", "best"])(
    "refuses the alias %j in place of a full model ID",
    (alias) => {
      const text = withLine("model: claude-opus-5-5, max_turns: 80", `model: ${alias}, max_turns: 80`);
      expect(() => parseBudget(text)).toThrow(/implement.*full model ID/);
    }
  );

  it.each(["claude-sonnet-4-5-20250929", "claude-3-5-haiku-20241022", "claude-haiku-4-5"])(
    "accepts the full model ID %j",
    (model) => {
      const text = withLine("model: claude-opus-5-5, max_turns: 80", `model: ${model}, max_turns: 80`);
      expect(parseBudget(text).tasks.implement.model).toBe(model);
    }
  );

  it.each(["claude-fable-5", "fable", "claude-Fable-5-0"])(
    "refuses the Fable model %j",
    (model) => {
      const text = withLine("model: claude-sonnet-5-5", `model: ${model}`);
      expect(() => parseBudget(text)).toThrow(/explore.*Fable/);
    }
  );

  it.each(["oauth", "max", "API-KEY", ""])("refuses the unknown credential %j", (credential) => {
    const text = withLine("credential: subscription", `credential: ${credential}`);
    expect(() => parseBudget(text)).toThrow(/credential/);
  });

  it("accepts an API key as the credential", () => {
    const text = withLine("credential: subscription", "credential: api-key");
    expect(parseBudget(text).credential).toBe("api-key");
  });

  it("accepts tasks a later release adds, since budget.yml is read from main", () => {
    const text = `${validBudget}  fix-ci: { model: claude-opus-5-5, max_turns: 80, agent_minutes: 45 }\n`;
    expect(parseBudget(text).tasks.implement.maxTurns).toBe(80);
  });

  it.each([
    ["daily_runs: 8", "daily_runs: 0"],
    ["concurrent_runs: 1", "concurrent_runs: 1.5"],
    ["max_turns: 80", "max_turns: -1"],
    ["agent_minutes: 45", "agent_minutes: soon"],
    ["daily_runs: 8", "daily_run: 8"],
  ])("refuses %j changed to %j", (from, to) => {
    expect(() => parseBudget(withLine(from, to))).toThrow();
  });

  it("refuses text that is not YAML", () => {
    expect(() => parseBudget("credential: [subscription")).toThrow();
  });
});

describe("the factory's budget.yml", () => {
  const shipped = parseBudget(
    fs.readFileSync(path.join(import.meta.dirname, "../../../budget.yml"), "utf8")
  );

  it("starts on Pro: a subscription, 8 agent runs a day, one at a time", () => {
    expect(shipped).toMatchObject({
      credential: "subscription",
      dailyRuns: 8,
      concurrentRuns: 1,
    });
  });

  it("starts with the digest's ceilings", () => {
    expect(shipped.tasks).toMatchObject({
      explore: { maxTurns: 30, agentMinutes: 15 },
      implement: { maxTurns: 80, agentMinutes: 45 },
      "implement-spec": { maxTurns: 50, agentMinutes: 30 },
      review: { maxTurns: 30, agentMinutes: 15 },
    });
  });
});
