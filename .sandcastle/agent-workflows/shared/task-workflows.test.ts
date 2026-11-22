import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { triggerLabel } from "./labels";
import { writeRunName, type LockKey } from "./run-name";
import type { AgentTask } from "./tasks";

// Workflow YAML can't run outside Actions, so these read review's and
// explore's files and check the rules that keep tokens narrow and locks readable.

type Step = {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
};
type Job = Record<string, unknown> & { readonly steps?: readonly Step[]; readonly uses?: string };
type Workflow = Record<string, unknown> & { readonly jobs: Record<string, Job> };

const workflowsDir = path.join(import.meta.dirname, "../../../.github/workflows");
const read = (file: string): string => fs.readFileSync(path.join(workflowsDir, file), "utf8");
const load = (file: string): Workflow => parseYaml(read(file)) as Workflow;
const factory = "ShreyasReddy77/my-software-factory/.github/workflows";

const fillExpressions = (template: string, values: Record<string, string>): string =>
  template.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => values[expression] ?? `<${expression}>`);

const tasks: readonly { task: AgentTask; itemExpression: string; itemInput: string; lockKey: LockKey; launch: string }[] = [
  {
    task: "review",
    itemExpression: "github.event.pull_request.number",
    itemInput: "pr",
    lockKey: { scope: "pr", repo: "owner/repo", number: 5 },
    launch: "review/review.ts",
  },
  {
    task: "explore",
    itemExpression: "github.event.issue.number",
    itemInput: "batch",
    lockKey: { scope: "repo", repo: "owner/repo" },
    launch: "explore/explore.ts",
  },
];

const expectThinEntry = (workflow: Workflow, reusable: string): void => {
  expect(Object.keys(workflow).sort()).toEqual(["jobs", "name", "on", "permissions", "run-name"]);
  for (const job of Object.values(workflow.jobs))
    expect(Object.keys(job).every((key) => ["if", "uses", "with", "secrets"].includes(key))).toBe(true);
  const calls = Object.values(workflow.jobs).map((job) => String(job.uses));
  expect(calls.map((call) => call.split("@")[1]).sort()).toEqual(["main", "stable"]);
  expect(new Set(calls.map((call) => call.split("@")[0]))).toEqual(new Set([`${factory}/${reusable}`]));
};

describe.each(tasks)("$task's workflows", ({ task, itemExpression, itemInput, lockKey, launch }) => {
  const entryFile = `agent-${task}.yml`;
  const agentEntryFile = `${task}-agent.yml`;
  const runFile = `${task}-agent-run.yml`;
  const entry = load(entryFile);
  const agentEntry = load(agentEntryFile);
  const run = load(runFile);
  const runJobs = [...Object.values(load("gate-run.yml").jobs), ...Object.values(run.jobs)];
  const allSteps = runJobs.flatMap((job) => job.steps ?? []);
  const filled = { "github.repository": "owner/repo", "inputs.pr": "5" };

  it("start with a thin entry file that calls the shared gate run at @stable or @main", () => {
    expectThinEntry(entry, "gate-run.yml");
    for (const job of Object.values(entry.jobs)) {
      expect(String(job.if)).toContain(`github.event.label.name == '${triggerLabel(task)}'`);
      expect(job.with).toEqual({
        factory_ref: String(job.uses).split("@")[1],
        task,
        item: `\${{ ${itemExpression} }}`,
        agent_workflow: agentEntryFile,
      });
    }
  });

  it("name a trigger label's gate run with the task's lock key, as a run that calls no agent", () => {
    const format = /format\('([^']+)', github\.repository(?:, [a-z_.]+)?\)/.exec(String(entry["run-name"]));
    const name = format?.[1]?.replace("{0}", "owner/repo").replace("{1}", "5");

    expect(name).toBe(writeRunName({ task, lockKey, agentRun: false }));
  });

  it("start the agent run from a thin entry file too, named with the lock key as an agent run", () => {
    expectThinEntry(agentEntry, runFile);
    expect(fillExpressions(String(agentEntry["run-name"]), filled)).toBe(writeRunName({ task, lockKey, agentRun: true }));
    const on = agentEntry.on as { workflow_dispatch: { inputs: Record<string, unknown> } };
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(["factory_sha", itemInput, "job_timeout"].sort());
  });

  it("set timeout-minutes and run on ubuntu-24.04 in every job, the agent's from the gate run", () => {
    for (const job of runJobs) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"]).toBeDefined();
    }
    expect(Object.values(run.jobs)[0]?.["timeout-minutes"]).toBe("${{ fromJSON(inputs.job_timeout) }}");
  });

  it("keep no concurrency groups", () => {
    for (const file of [entryFile, agentEntryFile, runFile, "gate-run.yml"]) {
      expect(read(file)).not.toMatch(/^\s*concurrency:/m);
    }
  });

  it("check out without keeping a credential", () => {
    const checkouts = allSteps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  });

  it("mint every App token for one repo and named permissions only, never workflows", () => {
    const mints = allSteps.filter((step) => step.uses?.startsWith("actions/create-github-app-token@"));
    expect(mints.length).toBeGreaterThan(0);
    for (const step of mints) {
      const inputs = Object.keys(step.with ?? {});
      expect(String(step.with?.repositories)).not.toContain(",");
      expect(inputs.some((input) => input.startsWith("permission-"))).toBe(true);
      expect(inputs).not.toContain("permission-workflows");
    }
  });

  it("hand the Claude token only to the relay's host step", () => {
    const holders = allSteps.filter((step) => JSON.stringify(step).includes("secrets.CLAUDE_CODE_OAUTH_TOKEN"));
    expect(holders.map((step) => step.run)).toEqual([expect.stringContaining("start-relay.sh")]);
  });

  it("launch the agent from a host step with no secret or token in its env", () => {
    const launchStep = allSteps.find((step) => step.run?.includes(launch));
    expect(launchStep).toBeDefined();
    expect(JSON.stringify(launchStep)).not.toMatch(/secrets\.|GH_TOKEN|outputs\.token/);
    for (const job of Object.values(run.jobs)) expect(JSON.stringify(job.env ?? {})).not.toMatch(/secrets\.|token/i);
    expect(JSON.stringify(run.env ?? {})).not.toMatch(/secrets\.|token/i);
  });
});

describe("review's agent run", () => {
  const steps = load("review-agent-run.yml").jobs.agent?.steps ?? [];

  it("scans with the push guard before any push", () => {
    const guard = steps.findIndex((step) => step.run?.includes("guard-push.ts"));
    const push = steps.findIndex((step) => step.run?.includes("git -c core.hooksPath=/dev/null"));
    expect(guard).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(guard);
    expect(String(steps[push]?.if)).toContain("steps.decide.outputs.push == 'true'");
    expect(steps[push]?.run).not.toMatch(/--force|-f /);
  });

  it("reports back however the run ended", () => {
    expect(steps.at(-1)?.if).toBe("always()");
  });
});

describe("explore's agent run", () => {
  const jobs = load("explore-agent-run.yml").jobs;

  it("gives the agent's job no write token: only the apply and finish jobs write", () => {
    const writes = (job: Job | undefined) =>
      (job?.steps ?? []).filter((step) => step.with?.["permission-issues"] === "write").length;
    expect(writes(jobs.explore)).toBe(0);
    expect(writes(jobs.apply)).toBe(1);
    expect(jobs.apply?.steps?.some((step) => step.run?.includes("claude") || step.run?.includes("start-relay"))).toBe(false);
  });

  it("finishes the batch however the other jobs ended", () => {
    expect(jobs.finish?.if).toBe("always()");
    expect(jobs.finish?.needs).toEqual(["explore", "apply"]);
  });
});
