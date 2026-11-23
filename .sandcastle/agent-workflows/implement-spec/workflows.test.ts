import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

// What only implement-spec's workflows promise; the rules every task's files
// keep are in shared/task-workflows.test.ts.

type Step = { readonly run?: string; readonly if?: string };
type Job = Record<string, unknown> & { readonly steps?: readonly Step[] };
type Workflow = Record<string, unknown> & { readonly jobs: Record<string, Job> };

const workflowsDir = path.join(import.meta.dirname, "../../../.github/workflows");
const read = (file: string): string => fs.readFileSync(path.join(workflowsDir, file), "utf8");
const load = (file: string): Workflow => parseYaml(read(file)) as Workflow;

const files = ["agent-implement-spec.yml", "implement-spec-agent.yml", "implement-spec-agent-run.yml"];
const agent = load("implement-spec-agent-run.yml");
const stepsOf = (job: string): readonly Step[] => agent.jobs[job]?.steps ?? [];

describe("implement-spec's workflows", () => {
  it("are started only by a label: no schedule and no dispatch button", () => {
    expect(Object.keys(load("agent-implement-spec.yml").on as object)).toEqual(["issues"]);
    expect(read("agent-implement-spec.yml")).not.toMatch(/^\s*(schedule|workflow_dispatch):/m);
  });

  it("split on implement-spec's line and build on implement's, one job each", () => {
    expect(agent.jobs.split?.if).toBe("inputs.mode == 'split'");
    expect(agent.jobs.build?.if).toBe("inputs.mode == 'build'");
    expect(stepsOf("split").some((s) => s.run?.includes("implement-spec/split.ts"))).toBe(true);
    expect(stepsOf("build").some((s) => s.run?.includes("implement-spec/build.ts"))).toBe(true);
    for (const job of ["split", "build"]) expect(agent.jobs[job]?.["timeout-minutes"]).toBe("${{ fromJSON(inputs.job_timeout) }}");
  });

  it("never start themselves again: the only run they start is the requeue run", () => {
    for (const file of files)
      expect(read(file)).not.toMatch(/gh workflow run (?!requeue\.yml )|actions\/workflows\/[^ ]*\/dispatches/);
  });

  it("never push from the split", () => {
    expect(stepsOf("split").some((step) => step.run?.includes("push"))).toBe(false);
  });

  it("end each job with a report that runs however the job ended", () => {
    for (const job of ["split", "build"]) {
      const last = stepsOf(job).at(-1);
      expect(last?.if).toBe("always()");
      expect(last?.run).toContain("implement-spec/report.ts");
    }
  });
});
