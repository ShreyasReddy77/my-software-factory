import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseRunName } from "../shared/run-name";

// Workflow YAML can't run outside Actions, so these read the requeue run's
// file and every agent run's last job.

type Step = {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
};
type Job = Record<string, unknown> & { readonly steps?: readonly Step[]; readonly needs?: string | string[] };
type Workflow = Record<string, unknown> & { readonly jobs: Record<string, Job> };

const workflowsDir = path.join(import.meta.dirname, "../../../.github/workflows");
const read = (file: string): string => fs.readFileSync(path.join(workflowsDir, file), "utf8");
const load = (file: string): Workflow => parseYaml(read(file)) as Workflow;

const mints = (steps: readonly Step[]): Step[] =>
  steps.filter((step) => step.uses?.startsWith("actions/create-github-app-token@"));

describe("the requeue run's workflow", () => {
  const workflow = load("requeue.yml");
  const jobs = Object.values(workflow.jobs);
  const steps = jobs.flatMap((job) => job.steps ?? []);
  const on = workflow.on as { schedule?: { cron: string }[]; workflow_dispatch?: unknown };

  it("runs hourly and whenever an agent run starts it", () => {
    expect(on.schedule).toEqual([{ cron: "0 * * * *" }]);
    expect(Object.keys(on)).toContain("workflow_dispatch");
  });

  it("keeps one run going and one waiting, in a plain concurrency group", () => {
    expect(workflow.concurrency).toEqual({ group: "requeue-run", "cancel-in-progress": false });
  });

  it("is named as a run that holds no lock and never counts as an agent run", () => {
    expect(workflow["run-name"]).toBe("Requeue run");
    expect(parseRunName(String(workflow["run-name"]))).toBeUndefined();
  });

  it("sets timeout-minutes and runs on ubuntu-24.04", () => {
    for (const job of jobs) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"]).toBeDefined();
    }
  });

  it("checks out without keeping a credential", () => {
    const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step.with?.["persist-credentials"]).toBe(false);
  });

  it("restarts with one App token for the factory: issues and PRs write, the run list read", () => {
    const [mint, ...others] = mints(steps);
    expect(others).toEqual([]);
    expect(mint?.with).toEqual(
      expect.objectContaining({
        repositories: "my-software-factory",
        "permission-issues": "write",
        "permission-pull-requests": "write",
        "permission-actions": "read",
      })
    );
    expect(Object.keys(mint?.with ?? {})).not.toContain("permission-workflows");
    const host = steps.find((step) => step.run?.includes("requeue/requeue.ts"));
    expect(host?.env?.GH_TOKEN).toBe("${{ steps.token.outputs.token }}");
  });
});

describe.each([
  "implement-agent.yml",
  "implement-spec-agent.yml",
  "review-agent-run.yml",
  "explore-agent-run.yml",
])("%s's last job", (file) => {
  const workflow = load(file);
  const jobNames = Object.keys(workflow.jobs);
  const requeue = workflow.jobs.requeue;

  it("starts the requeue run however the other jobs ended", () => {
    expect(jobNames.at(-1)).toBe("requeue");
    expect(requeue?.if).toBe("always()");
    expect([requeue?.needs].flat().sort()).toEqual(jobNames.filter((name) => name !== "requeue").sort());
    expect(requeue?.["runs-on"]).toBe("ubuntu-24.04");
    expect(requeue?.["timeout-minutes"]).toBeDefined();
  });

  it("starts it by workflow_dispatch with an App token that may only start runs", () => {
    const steps = requeue?.steps ?? [];
    const [mint, ...others] = mints(steps);
    expect(others).toEqual([]);
    expect(mint?.with).toEqual(
      expect.objectContaining({ repositories: "my-software-factory", "permission-actions": "write" })
    );
    expect(Object.keys(mint?.with ?? {}).filter((input) => input.startsWith("permission-"))).toEqual([
      "permission-actions",
    ]);
    const start = steps.find((step) => step.run?.includes("gh workflow run requeue.yml"));
    expect(start?.env?.GH_TOKEN).toBe("${{ steps.token.outputs.token }}");
    expect(read(file)).not.toContain("The requeue run does not exist yet");
  });
});
