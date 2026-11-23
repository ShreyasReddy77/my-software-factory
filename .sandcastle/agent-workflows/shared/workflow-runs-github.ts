// The run list the budget gates count: one paginated list call per repo. Its
// GH_TOKEN must reach the repo with Actions read.
import type { WorkflowRun } from "./gate";
import { ghPages } from "./gh";

// Yesterday onwards: in-flight runs started before midnight UTC still count.
const runListSince = (time: Date): string =>
  new Date(time.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);

export const readWorkflowRuns = (repo: string, now: Date): WorkflowRun[] =>
  ghPages<{ workflow_runs: WorkflowRun[] }>(
    `repos/${repo}/actions/runs?per_page=100&created=>=${runListSince(now)}`
  ).flatMap((page) => page.workflow_runs);
