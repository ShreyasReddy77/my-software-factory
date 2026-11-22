import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { triggerLabel } from "../shared/labels";
import { writeRunName } from "../shared/run-name";

// Workflow YAML can't run outside Actions, so these read the files and check
// the rules that keep implement's tokens narrow and its locks readable.

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

const entry = load("agent-implement.yml");
const gate = load("implement-gate.yml");
const agent = load("implement-agent.yml");
const implementFiles = ["agent-implement.yml", "implement-gate.yml", "implement-agent.yml"];
const runJobs = [...Object.values(gate.jobs), ...Object.values(agent.jobs)];
const allSteps = runJobs.flatMap((job) => job.steps ?? []);

const fillExpressions = (template: string, values: Record<string, string>): string =>
  template.replaceAll(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => values[expression] ?? `<${expression}>`);

describe("implement's entry file", () => {
  it("holds only a trigger, permissions, a run name and calls", () => {
    expect(Object.keys(entry).sort()).toEqual(["jobs", "name", "on", "permissions", "run-name"]);
    for (const job of Object.values(entry.jobs))
      expect(Object.keys(job).every((key) => ["if", "uses", "with", "secrets"].includes(key))).toBe(true);
  });

  it("calls the gate run at @stable or at @main, one job each", () => {
    const calls = Object.values(entry.jobs).map((job) => String(job.uses));
    expect(calls.map((call) => call.split("@")[1]).sort()).toEqual(["main", "stable"]);
    expect(new Set(calls.map((call) => call.split("@")[0]))).toEqual(
      new Set(["ShreyasReddy77/my-software-factory/.github/workflows/implement-gate.yml"])
    );
    for (const job of Object.values(entry.jobs)) {
      expect(String(job.if)).toContain(`github.event.label.name == '${triggerLabel("implement")}'`);
      expect(job.with).toEqual({ factory_ref: String(job.uses).split("@")[1] });
    }
  });

  it("names a trigger label's run with its ticket lock key, as a run that calls no agent", () => {
    const format = /format\('([^']+)', github\.repository, github\.event\.issue\.number\)/.exec(String(entry["run-name"]));
    const name = format?.[1]?.replace("{0}", "owner/repo").replace("{1}", "5");

    expect(name).toBe(writeRunName({ task: "implement", lockKey: { scope: "ticket", repo: "owner/repo", number: 5 }, agentRun: false }));
    expect(String(entry["run-name"])).toContain(`github.event.label.name == '${triggerLabel("implement")}'`);
  });
});

describe("implement's agent run", () => {
  it("is named with its ticket lock key, as an agent run", () => {
    const name = fillExpressions(String(agent["run-name"]), { "github.repository": "owner/repo", "inputs.issue": "5" });

    expect(name).toBe(writeRunName({ task: "implement", lockKey: { scope: "ticket", repo: "owner/repo", number: 5 }, agentRun: true }));
  });

  it("takes its pinned commit, ticket and job timeout from the gate run", () => {
    const on = agent.on as { workflow_dispatch: { inputs: Record<string, unknown> } };
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(["factory_sha", "issue", "job_timeout"]);
    expect(agent.jobs.agent?.["timeout-minutes"]).toBe("${{ fromJSON(inputs.job_timeout) }}");
  });

  it("ends with a job that runs however the agent job ended", () => {
    const last = Object.values(agent.jobs).at(-1);
    expect(last?.if).toBe("always()");
  });
});

describe("implement's runs", () => {
  it("set timeout-minutes and run on ubuntu-24.04 in every job", () => {
    for (const job of runJobs) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"]).toBeDefined();
    }
  });

  it("keep no concurrency groups: locks come from run names", () => {
    for (const file of implementFiles) expect(read(file)).not.toMatch(/^\s*concurrency:/m);
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
    const launch = allSteps.find((step) => step.run?.includes("implement/implement.ts"));
    expect(launch).toBeDefined();
    expect(JSON.stringify(launch)).not.toMatch(/secrets\.|GH_TOKEN|outputs\.token/);
    expect(JSON.stringify(agent.jobs.agent?.env ?? {})).not.toMatch(/secrets\.|token/i);
  });

  it("scan with the push guard before any push", () => {
    const steps = agent.jobs.agent?.steps ?? [];
    const guard = steps.findIndex((step) => step.run?.includes("guard-push.ts"));
    const push = steps.findIndex((step) => step.run?.includes("git -c core.hooksPath=/dev/null"));
    expect(guard).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(guard);
    expect(String(steps[push]?.if)).toContain("steps.decide.outputs.push == 'true'");
  });
});
