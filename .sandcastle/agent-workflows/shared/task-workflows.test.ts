import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { triggerLabel } from "./labels";
import { writeRunName, type LockKey } from "./run-name";
import type { AgentTask } from "./tasks";

// Workflow YAML can't run outside Actions, so these read every task's files
// and check the rules that keep tokens narrow, locks readable and each
// workflow a thin entry file plus a reusable workflow.

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

const repoRoot = path.join(import.meta.dirname, "../../..");
const workflowsDir = path.join(repoRoot, ".github/workflows");
const read = (file: string): string => fs.readFileSync(path.join(workflowsDir, file), "utf8");
const load = (file: string): Workflow => parseYaml(read(file)) as Workflow;
const setupAction = parseYaml(fs.readFileSync(path.join(repoRoot, ".github/actions/setup-factory/action.yml"), "utf8")) as {
  readonly runs: { readonly using: string; readonly steps: readonly Step[] };
};
const factory = "ShreyasReddy77/my-software-factory/.github/workflows";

const fillExpressions = (template: string, values: Record<string, string>): string =>
  template.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => values[expression] ?? `<${expression}>`);

type TaskFiles = {
  readonly task: AgentTask;
  readonly itemExpression: string;
  readonly gateWith?: Record<string, string>;
  readonly dispatchInputs: readonly string[];
  readonly runNameInput: string;
  readonly lockKey: LockKey;
  readonly launches: readonly string[];
};

const tasks: readonly TaskFiles[] = [
  {
    task: "review",
    itemExpression: "github.event.pull_request.number",
    dispatchInputs: ["pr"],
    runNameInput: "inputs.pr",
    lockKey: { scope: "pr", repo: "owner/repo", number: 5 },
    launches: ["review/review.ts"],
  },
  {
    task: "explore",
    itemExpression: "github.event.issue.number",
    dispatchInputs: ["batch"],
    runNameInput: "inputs.batch",
    lockKey: { scope: "repo", repo: "owner/repo" },
    launches: ["explore/explore.ts"],
  },
  {
    task: "implement",
    itemExpression: "github.event.issue.number",
    dispatchInputs: ["issue"],
    runNameInput: "inputs.issue",
    lockKey: { scope: "ticket", repo: "owner/repo", number: 5 },
    launches: ["implement/implement.ts"],
  },
  {
    task: "implement-spec",
    itemExpression: "github.event.issue.number",
    gateWith: { gate_script: "implement-spec/gate-run.ts" },
    dispatchInputs: ["mode", "spec", "issue"],
    runNameInput: "inputs.issue",
    lockKey: { scope: "ticket", repo: "owner/repo", number: 5 },
    launches: ["implement-spec/split.ts", "implement-spec/build.ts"],
  },
];

const refOf = (job: Job): string => String(job.uses).split("@")[1] ?? "";

const expectThinEntry = (workflow: Workflow, reusable: string): void => {
  expect(Object.keys(workflow).sort()).toEqual(["jobs", "name", "on", "permissions", "run-name"]);
  for (const job of Object.values(workflow.jobs))
    expect(Object.keys(job).every((key) => ["if", "uses", "with", "secrets"].includes(key))).toBe(true);
  const calls = Object.values(workflow.jobs).map((job) => String(job.uses));
  expect(calls.map((call) => call.split("@")[1]).sort()).toEqual(["main", "stable"]);
  expect(new Set(calls.map((call) => call.split("@")[0]))).toEqual(new Set([`${factory}/${reusable}`]));
};

describe("the factory's workflow files", () => {
  it("are entry files, named agent-<task>.yml and <task>-agent.yml, or reusable ones named *-run.yml", () => {
    const files = fs.readdirSync(workflowsDir).sort();
    for (const file of files)
      expect(file).toMatch(/^(agent-[a-z-]+|[a-z-]+-agent|requeue)\.yml$|^[a-z-]+-run\.yml$/);
    expect(files).not.toContain("implement-gate.yml");
    expect(files).not.toContain("implement-spec-gate.yml");
  });

  it("share one setup step: a composite action that checks out without keeping a credential", () => {
    expect(setupAction.runs.using).toBe("composite");
    const checkouts = setupAction.runs.steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  });

  it("let the gate run comment on and label a PR, since review gates PRs", () => {
    const mint = Object.values(load("gate-run.yml").jobs)
      .flatMap((job) => job.steps ?? [])
      .find((step) => step.uses?.startsWith("actions/create-github-app-token@"));
    expect(mint?.with?.["permission-issues"]).toBe("write");
    expect(mint?.with?.["permission-pull-requests"]).toBe("write");
  });
});

describe.each(tasks)("$task's workflows", ({ task, itemExpression, gateWith, dispatchInputs, runNameInput, lockKey, launches }) => {
  const entryFile = `agent-${task}.yml`;
  const agentEntryFile = `${task}-agent.yml`;
  const runFile = `${task}-agent-run.yml`;
  const entry = load(entryFile);
  const agentEntry = load(agentEntryFile);
  const run = load(runFile);
  const runJobs = [...Object.values(load("gate-run.yml").jobs), ...Object.values(run.jobs)];
  const allSteps = [...runJobs.flatMap((job) => job.steps ?? []), ...setupAction.runs.steps];
  const filled = { "github.repository": "owner/repo", [runNameInput]: "5" };

  it("start with a thin entry file that calls the shared gate run at @stable or @main", () => {
    expectThinEntry(entry, "gate-run.yml");
    for (const job of Object.values(entry.jobs)) {
      expect(String(job.if)).toContain(`github.event.label.name == '${triggerLabel(task)}'`);
      expect(job.with).toEqual({
        factory_ref: refOf(job),
        task,
        item: `\${{ ${itemExpression} }}`,
        agent_workflow: agentEntryFile,
        ...gateWith,
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
    expect(Object.keys(agentEntry.on as object)).toEqual(["workflow_dispatch"]);
    expect(fillExpressions(String(agentEntry["run-name"]), filled)).toBe(writeRunName({ task, lockKey, agentRun: true }));
    const on = agentEntry.on as { workflow_dispatch: { inputs: Record<string, unknown> } };
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(
      ["factory_ref", "factory_sha", ...dispatchInputs, "job_timeout"].sort()
    );
  });

  it("pick the agent run's ref from the factory_ref the gate run passed, never from the repository", () => {
    for (const job of Object.values(agentEntry.jobs)) expect(job.if).toBe(`inputs.factory_ref == '${refOf(job)}'`);
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

  it("set the factory up with the shared composite action, from the pinned checkout", () => {
    for (const job of Object.values(run.jobs).filter((j) => j.steps?.some((s) => s.run?.includes("tsx")))) {
      const steps = job.steps ?? [];
      const setup = steps.findIndex((step) => step.uses === "./factory/.github/actions/setup-factory");
      const checkout = steps.findIndex((step) => step.with?.path === "factory");
      expect(setup).toBeGreaterThan(checkout);
      expect(checkout).toBeGreaterThan(-1);
    }
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
    expect(holders.length).toBe(launches.length);
    for (const step of holders) expect(step.run).toContain("start-relay.sh");
  });

  it("launch each agent from a host step with no secret or token in its env", () => {
    for (const launch of launches) {
      const launchStep = allSteps.find((step) => step.run?.includes(launch));
      expect(launchStep).toBeDefined();
      expect(JSON.stringify(launchStep)).not.toMatch(/secrets\.|GH_TOKEN|outputs\.token/);
    }
    for (const job of Object.values(run.jobs)) expect(JSON.stringify(job.env ?? {})).not.toMatch(/secrets\.|token/i);
    expect(JSON.stringify(run.env ?? {})).not.toMatch(/secrets\.|token/i);
  });
});

describe.each([
  ["review", "agent"],
  ["implement", "agent"],
  ["implement-spec", "build"],
])("%s's %s job", (task, jobName) => {
  const steps = load(`${task}-agent-run.yml`).jobs[jobName]?.steps ?? [];

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

describe.each(["implement", "implement-spec"])("%s's build", (task) => {
  const steps = load(`${task}-agent-run.yml`).jobs[task === "implement" ? "agent" : "build"]?.steps ?? [];

  it("decides the push with the shared build end, and closes the ticket only through its PR's Closes line", () => {
    expect(steps.some((step) => step.run?.includes("shared/decide-build-end.ts"))).toBe(true);
    const openPr = steps.find((step) => step.run?.includes("gh pr create"));
    expect(openPr?.run).toContain("Closes #%s");
    expect(read(`${task}-agent-run.yml`)).not.toMatch(/gh issue close|state=closed/);
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
