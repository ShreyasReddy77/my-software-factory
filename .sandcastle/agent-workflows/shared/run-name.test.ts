import { describe, expect, it } from "vitest";
import { parseRunName, writeRunName } from "./run-name";

describe("run names", () => {
  it("writes an agent run's name with its lock key and task", () => {
    expect(
      writeRunName({
        task: "review",
        lockKey: { scope: "pr", repo: "owner/repo", number: 5 },
        agentRun: true,
      })
    ).toBe("[pr owner/repo#5] review");
  });

  it.each([
    {
      task: "implement",
      lockKey: { scope: "ticket", repo: "Owner-1/my.repo_x", number: 12 },
      agentRun: true,
    },
    {
      task: "review",
      lockKey: { scope: "pr", repo: "owner/repo", number: 5 },
      agentRun: false,
    },
    {
      task: "explore",
      lockKey: { scope: "repo", repo: "owner/repo" },
      agentRun: true,
    },
    {
      task: "implement-spec",
      lockKey: { scope: "ticket", repo: "owner/repo", number: 31 },
      agentRun: false,
    },
  ] as const)("reads back what it wrote: $task $lockKey.scope", (runName) => {
    expect(parseRunName(writeRunName(runName))).toEqual(runName);
  });

  it("tells an agent run from a no-agent run on the same lock", () => {
    const lockKey = { scope: "pr", repo: "owner/repo", number: 5 } as const;
    expect(parseRunName("[pr owner/repo#5] review")).toEqual({
      task: "review",
      lockKey,
      agentRun: true,
    });
    expect(parseRunName("[pr owner/repo#5] review (no agent)")).toEqual({
      task: "review",
      lockKey,
      agentRun: false,
    });
  });

  it.each([
    "",
    "Requeue run",
    "agent-implement",
    "review",
    "[pr owner/repo#5]",
    "[pr owner/repo] review",
    "[ticket owner/repo] implement",
    "[repo owner/repo#5] explore",
    "[pr ownerrepo#5] review",
    "[pr owner/repo#five] review",
    "[pr owner/repo#5] review (gate)",
    "[pr owner/repo#5] review extra",
    "[issue owner/repo#5] review",
    " [pr owner/repo#5] review",
    "[pr owner/repo#5] Review",
  ])("ignores a malformed name: %j", (name) => {
    expect(parseRunName(name)).toBeUndefined();
  });
});
