import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { triggerLabel } from "../shared/labels";
import { writeRunName } from "../shared/run-name";

// Workflow YAML can't run outside Actions, so these read the files and check
// the rules that keep implement-spec label-started, its tokens narrow and its
// locks readable.

type Step = {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
};
type Job = Record<string, unknown> & { readonly steps?: readonly Step[] };
type Workflow = Record<string, unknown> & { readonly jobs: Record<string, Job> };

const workflowsDir = path.join(import.meta.dirname, "../../../.github/workflows");
const read = (file: string): string => fs.readFileSync(path.join(workflowsDir, file), "utf8");
const load = (file: string): Workflow => parseYaml(read(file)) as Workflow;

const factory = "ShreyasReddy77/my-software-factory/.github/workflows";
const labelEntry = load("agent-implement-spec.yml");
const runEntry = load("agent-implement-spec-run.yml");
const gate = load("implement-spec-gate.yml");
const agent = load("implement-spec-agent.yml");
const files = ["agent-implement-spec.yml", "agent-implement-spec-run.yml", "implement-spec-gate.yml", "implement-spec-agent.yml"];
const runJobs = [...Object.values(gate.jobs), ...Object.values(agent.jobs)];
const allSteps = runJobs.flatMap((job) => job.steps ?? []);
const stepsOf = (job: string): readonly Step[] => agent.jobs[job]?.steps ?? [];

const fillExpressions = (template: string, values: Record<string, string>): string =>
  template.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => values[expression] ?? `<${expression}>`);

const thinEntry = (entry: Workflow): void => {
  expect(Object.keys(entry).sort()).toEqual(["jobs", "name", "on", "permissions", "run-name"]);
  for (const job of Object.values(entry.jobs))
    expect(Object.keys(job).every((key) => ["if", "uses", "with", "secrets"].includes(key))).toBe(true);
};

const callsAtStableAndMain = (entry: Workflow, reusable: string): void => {
  const calls = Object.values(entry.jobs).map((job) => String(job.uses));
  expect(calls.map((call) => call.split("@")[1]).sort()).toEqual(["main", "stable"]);
  expect(new Set(calls.map((call) => call.split("@")[0]))).toEqual(new Set([`${factory}/${reusable}`]));
};

describe("implement-spec's label entry file", () => {
  it("is started only by a label: no schedule and no dispatch button", () => {
    expect(Object.keys(labelEntry.on as object)).toEqual(["issues"]);
    expect(read("agent-implement-spec.yml")).not.toMatch(/^\s*(schedule|workflow_dispatch):/m);
  });

  it("holds only a trigger, permissions, a run name and calls to the gate run at @stable or @main", () => {
    thinEntry(labelEntry);
    callsAtStableAndMain(labelEntry, "implement-spec-gate.yml");
    for (const job of Object.values(labelEntry.jobs)) {
      expect(String(job.if)).toContain(`github.event.label.name == '${triggerLabel("implement-spec")}'`);
      expect(job.with).toEqual({ factory_ref: String(job.uses).split("@")[1] });
    }
  });

  it("names a trigger label's run with the spec's lock key, as a run that calls no agent", () => {
    const format = /format\('([^']+)', github\.repository, github\.event\.issue\.number\)/.exec(String(labelEntry["run-name"]));
    const name = format?.[1]?.replace("{0}", "owner/repo").replace("{1}", "7");

    expect(name).toBe(writeRunName({ task: "implement-spec", lockKey: { scope: "ticket", repo: "owner/repo", number: 7 }, agentRun: false }));
  });
});

describe("implement-spec's gate run", () => {
  it("starts the agent run's entry file, never itself", () => {
    const step = allSteps.find((s) => s.run?.includes("implement-spec/gate-run.ts"));
    expect(step?.env?.AGENT_WORKFLOW).toBe("agent-implement-spec-run.yml");
  });
});

describe("implement-spec's agent run entry file", () => {
  it("is started by the gate run's dispatch and holds only a trigger, permissions, a run name and calls", () => {
    expect(Object.keys(runEntry.on as object)).toEqual(["workflow_dispatch"]);
    thinEntry(runEntry);
  });

  it("calls the agent workflow at the ref the gate run pinned, @stable or @main", () => {
    callsAtStableAndMain(runEntry, "implement-spec-agent.yml");
    for (const job of Object.values(runEntry.jobs))
      expect(String(job.if)).toBe(`inputs.factory_ref == '${String(job.uses).split("@")[1]}'`);
  });

  it("is named with the lock key of the issue it works, as an agent run", () => {
    const name = fillExpressions(String(runEntry["run-name"]), { "github.repository": "owner/repo", "inputs.issue": "12" });

    expect(name).toBe(writeRunName({ task: "implement-spec", lockKey: { scope: "ticket", repo: "owner/repo", number: 12 }, agentRun: true }));
  });

  it("takes everything the gate run passes", () => {
    const on = runEntry.on as { workflow_dispatch: { inputs: Record<string, unknown> } };
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(["factory_ref", "factory_sha", "issue", "job_timeout", "mode", "spec"]);
  });
});

describe("implement-spec's agent run", () => {
  it("splits on implement-spec's line and builds on implement's, one job each", () => {
    expect(agent.jobs.split?.if).toBe("inputs.mode == 'split'");
    expect(agent.jobs.build?.if).toBe("inputs.mode == 'build'");
    expect(stepsOf("split").some((s) => s.run?.includes("implement-spec/split.ts"))).toBe(true);
    expect(stepsOf("build").some((s) => s.run?.includes("implement-spec/build.ts"))).toBe(true);
    for (const job of ["split", "build"]) expect(agent.jobs[job]?.["timeout-minutes"]).toBe("${{ fromJSON(inputs.job_timeout) }}");
  });

  it("never starts itself again: the only run it starts is the requeue run", () => {
    for (const file of files)
      expect(read(file)).not.toMatch(/gh workflow run (?!requeue\.yml )|actions\/workflows\/[^ ]*\/dispatches/);
  });

  it("scans the build's commits with the push guard before any push", () => {
    const steps = stepsOf("build");
    const guard = steps.findIndex((step) => step.run?.includes("guard-push.ts"));
    const push = steps.findIndex((step) => step.run?.includes("git -c core.hooksPath=/dev/null"));
    expect(guard).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(guard);
    expect(String(steps[push]?.if)).toContain("steps.decide.outputs.push == 'true'");
  });

  it("never pushes from the split", () => {
    expect(stepsOf("split").some((step) => step.run?.includes("push"))).toBe(false);
  });

  it("ends each job with a report that runs however the job ended", () => {
    for (const job of ["split", "build"]) {
      const last = stepsOf(job).at(-1);
      expect(last?.if).toBe("always()");
      expect(last?.run).toContain("implement-spec/report.ts");
    }
  });
});

describe("implement-spec's runs", () => {
  it("set timeout-minutes and run on ubuntu-24.04 in every job", () => {
    for (const job of runJobs) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"]).toBeDefined();
    }
  });

  it("keep no concurrency groups: locks come from run names", () => {
    for (const file of files) expect(read(file)).not.toMatch(/^\s*concurrency:/m);
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
    expect(holders.length).toBe(2);
    for (const step of holders) expect(step.run).toContain("start-relay.sh");
  });

  it("launch each agent from a host step with no secret or token in its env", () => {
    for (const script of ["implement-spec/split.ts", "implement-spec/build.ts"]) {
      const launch = allSteps.find((step) => step.run?.includes(script));
      expect(launch).toBeDefined();
      expect(JSON.stringify(launch)).not.toMatch(/secrets\.|GH_TOKEN|outputs\.token/);
    }
    for (const job of Object.values(agent.jobs)) expect(JSON.stringify(job.env ?? {})).not.toMatch(/secrets\.|token/i);
  });
});
