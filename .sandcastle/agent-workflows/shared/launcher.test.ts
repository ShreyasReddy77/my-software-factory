import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Budget, Credential } from "./budget";
import type { bwrap } from "@ai-hero/sandcastle/sandboxes/bwrap";
import { CeilingHit, sandboxedAgent } from "./common";
import type { AgentTask } from "./tasks";

const budget = (credential: Credential): Budget => ({
  credential,
  dailyRuns: 8,
  concurrentRuns: 1,
  priority: [["implement"]],
  tasks: {
    explore: { model: "claude-sonnet-5-5", maxTurns: 30, agentMinutes: 15 },
    implement: { model: "claude-opus-5-5", maxTurns: 80, agentMinutes: 45 },
    "implement-spec": { model: "claude-opus-5-5", maxTurns: 50, agentMinutes: 30 },
    review: { model: "claude-opus-5-5", maxTurns: 30, agentMinutes: 15 },
  },
});

const bwrapStub = ((options) => ({ name: "bwrap", env: options?.env ?? {} })) as typeof bwrap;

const launch = (task: AgentTask, credential: Credential = "subscription", hostEnv: NodeJS.ProcessEnv = cleanHost) =>
  sandboxedAgent(task, { budget: budget(credential), hostEnv, sandboxProvider: bwrapStub });

const cleanHost = { PATH: "/usr/bin", HOME: "/home/runner", GITHUB_REPOSITORY: "o/r" };

describe("the agent launcher", () => {
  it.each(["subscription", "api-key"] as const)(
    "passes only the stand-in token and the relay URL into the sandbox (%s)",
    (credential) => {
      const { agent, sandbox } = launch("implement", credential);

      expect({ ...sandbox.env, ...agent.env }).toEqual({
        ANTHROPIC_BASE_URL: "http://127.0.0.1:8787",
        ANTHROPIC_AUTH_TOKEN: "stand-in-not-a-real-token",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      });
    }
  );

  it("caps the agent at the task's max_turns from budget.yml", () => {
    const { agent } = launch("review");

    const { command, stdin } = agent.buildPrintCommand({ prompt: "Review it.", dangerouslySkipPermissions: true });

    expect(command).toMatch(/^claude --print .*--model '?claude-opus-5-5'? --max-turns 30 -p -$/);
    expect(stdin).toBe("Review it.");
  });

  it("keeps the turn cap when Sandcastle resumes the session for extraction", () => {
    const { agent } = launch("implement");

    const { command } = agent.buildPrintCommand({
      prompt: "Extract.",
      dangerouslySkipPermissions: true,
      resumeSession: "session-1",
    });

    expect(command).toMatch(/--resume '?session-1'? --max-turns 80 -p -$/);
    expect(agent.sessionStorage).toBeDefined();
  });

  it("stops the agent when the task's agent_minutes run out, with a reason the run can tell from a crash", () => {
    vi.useFakeTimers();
    try {
      const { signal } = launch("review");

      vi.advanceTimersByTime(15 * 60_000 - 1);
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(1);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(CeilingHit);
      expect(signal.reason.message).toBe("review hit its ceiling of 15 agent minutes");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the agent only the run's own folders beyond its worktree, at their host paths", () => {
    const { sandbox } = sandboxedAgent("implement", {
      budget: budget("subscription"),
      hostEnv: cleanHost,
      sandboxProvider: ((options) => ({ mounts: options?.mounts })) as typeof bwrap,
      mounts: ["/home/runner/work/_temp/agent-io"],
    });

    expect(sandbox).toEqual({
      mounts: [{ hostPath: "/home/runner/work/_temp/agent-io", sandboxPath: "/home/runner/work/_temp/agent-io" }],
    });
  });

  it.each([
    ["CLAUDE_CODE_OAUTH_TOKEN", "anything"],
    ["ANTHROPIC_API_KEY", "anything"],
    ["ANTHROPIC_AUTH_TOKEN", "anything"],
    ["GH_TOKEN", "anything"],
    ["GITHUB_TOKEN", "anything"],
    ["SOME_NAME", "sk-ant-oat01-abc"],
    ["OTHER_NAME", "ghs_abc123"],
    ["THIRD_NAME", "github_pat_abc"],
  ])("refuses to launch from a host step whose env holds a secret (%s)", (name, value) => {
    const launching = () => launch("implement", "subscription", { ...cleanHost, [name]: value });

    expect(launching).toThrow(`The host step launching the sandbox holds a secret in ${name}`);
    expect(launching).not.toThrow(value);
  });
});

describe("model IDs", () => {
  const factoryRoot = path.join(import.meta.dirname, "../../..");
  const codeDirs = [".sandcastle", ".github"];
  const skipped = new Set(["node_modules", "worktrees", "logs"]);

  const filesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return skipped.has(entry.name) ? [] : filesUnder(full);
      return [full];
    });

  it("appear in no factory code outside budget.yml", () => {
    const offenders = codeDirs
      .flatMap((dir) => filesUnder(path.join(factoryRoot, dir)))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith("package-lock.json"))
      .filter((file) => /claude-(?:opus|sonnet|haiku|fable|\d)/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(factoryRoot, file));
    expect(offenders).toEqual([]);
  });
});
