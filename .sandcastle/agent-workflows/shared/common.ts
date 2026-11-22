import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { bwrap } from "@ai-hero/sandcastle/sandboxes/bwrap";
import { loadBudget, type Budget } from "./budget";
import { relayPort } from "./relay.mjs";
import type { AgentTask } from "./tasks";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

export const outputDir = (): string => required("OUTPUT_DIR");

export const writeJson = (filename: string, value: unknown): void => {
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir(), filename),
    JSON.stringify(value, null, 2)
  );
};

const standInToken = "stand-in-not-a-real-token";

const relayEnv = (): Record<string, string> => ({
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${relayPort}`,
  ANTHROPIC_AUTH_TOKEN: standInToken,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
});

const printTail = " -p -";

const withMaxTurns = (agent: AgentProvider, maxTurns: number): AgentProvider => ({
  ...agent,
  buildPrintCommand: (options) => {
    const print = agent.buildPrintCommand(options);
    if (!print.command.endsWith(printTail))
      throw new Error(`Cannot add --max-turns to this Claude Code command: ${print.command}`);
    const head = print.command.slice(0, -printTail.length);
    return { ...print, command: `${head} --max-turns ${maxTurns}${printTail}` };
  },
});

export class CeilingHit extends Error {
  constructor(task: AgentTask, agentMinutes: number) {
    super(`${task} hit its ceiling of ${agentMinutes} agent minutes`);
    this.name = "CeilingHit";
  }
}

const ceilingSignal = (task: AgentTask, agentMinutes: number): AbortSignal => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new CeilingHit(task, agentMinutes)), agentMinutes * 60_000).unref();
  return controller.signal;
};

const secretNames = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);
const secretValue = /^(?:sk-ant-|gh[pousr]_|github_pat_)/;

const refuseSecretsIn = (hostEnv: NodeJS.ProcessEnv): void => {
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value && (secretNames.has(name) || secretValue.test(value)))
      throw new Error(
        `The host step launching the sandbox holds a secret in ${name}; /proc/1/environ would show it to the agent`
      );
  }
};

export type SandboxedAgentOptions = {
  readonly budget?: Budget;
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly sandboxProvider?: typeof bwrap;
  readonly mounts?: readonly string[];
};

// The agent, sandbox and ceiling every factory run passes to Sandcastle. The
// agent reaches Claude only through the relay an earlier host step started,
// with the model budget.yml names for the task.
export const sandboxedAgent = (
  task: AgentTask,
  { budget = loadBudget(), hostEnv = process.env, sandboxProvider = bwrap, mounts = [] }: SandboxedAgentOptions = {}
) => {
  refuseSecretsIn(hostEnv);
  const line = budget.tasks[task];
  return {
    agent: withMaxTurns(sandcastle.claudeCode(line.model), line.maxTurns),
    sandbox: sandboxProvider({
      env: relayEnv(),
      ...(mounts.length > 0 ? { mounts: mounts.map((dir) => ({ hostPath: dir, sandboxPath: dir })) } : {}),
    }),
    signal: ceilingSignal(task, line.agentMinutes),
  };
};
