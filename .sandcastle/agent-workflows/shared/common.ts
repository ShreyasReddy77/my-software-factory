import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { loadBudget, type Credential } from "./budget";
import type { AgentTask } from "./tasks";

export const outputDir = (): string => process.env.OUTPUT_DIR ?? "/tmp";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

export const writeJson = (filename: string, value: unknown): void => {
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir(), filename),
    JSON.stringify(value, null, 2)
  );
};

export const credentialEnv = (
  credential: Credential,
  claudeToken: string
): Readonly<Record<string, string>> =>
  credential === "subscription"
    ? { CLAUDE_CODE_OAUTH_TOKEN: claudeToken }
    : { ANTHROPIC_API_KEY: claudeToken };

// The one agent every factory workflow runs, with the model and credential
// budget.yml names for the task. The Claude token secret reaches this step as
// CLAUDE_CODE_OAUTH_TOKEN whichever credential it holds.
export const claudeAgent = (task: AgentTask) => {
  const budget = loadBudget();
  return sandcastle.claudeCode(budget.tasks[task].model, {
    env: credentialEnv(budget.credential, required("CLAUDE_CODE_OAUTH_TOKEN")),
  });
};
