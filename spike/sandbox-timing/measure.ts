// Spike for "Measure Sandcastle sandboxes on a hosted Actions runner".
// Not factory code: it is thrown away once the numbers are recorded.
//
// No agent runs here. The "trivial task" is a shell command inside the
// sandbox that commits, so the spike measures the sandbox and spends no
// Claude budget.
import * as fs from "node:fs";
import { createSandbox } from "@ai-hero/sandcastle";
import { bwrap } from "@ai-hero/sandcastle/sandboxes/bwrap";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const kind = process.argv[2];
const repo = process.env.GITHUB_WORKSPACE!;
const provider =
  kind === "bwrap"
    ? bwrap({ env: { SPIKE_DECLARED: "visible-on-purpose" } })
    : docker({ imageName: "sandcastle:spike", env: { SPIKE_DECLARED: "visible-on-purpose" } });

const results: Record<string, unknown> = { kind };
const time = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  const value = await f();
  results[label] = Math.round(performance.now() - start);
  return value;
};

// The probes live in probes.sh, which the worktree carries into the sandbox.
const probes = "bash spike/sandbox-timing/probes.sh";

const runOnce = async (n: number) => {
  const branch = `spike/${kind}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${n}`;
  const sandbox = await time(`create_${n}_ms`, () => createSandbox({ branch, sandbox: provider, cwd: repo }));
  const trivial = await time(`exec_trivial_${n}_ms`, () => sandbox.exec("true"));
  results[`exec_trivial_${n}_exit`] = trivial.exitCode;
  if (n === 1) {
    const probe = await sandbox.exec(probes);
    results.probes = probe.stdout.trim().split("\n");
    results.probes_stderr = probe.stderr.trim();
  }
  const commit = await time(`commit_${n}_ms`, () =>
    sandbox.exec(`echo "${kind} ${n} $(date -u +%FT%TZ)" > spike-${kind}.txt && git add spike-${kind}.txt && git commit -q -m "spike: ${kind} ${n}" && git log --oneline -1`)
  );
  results[`commit_${n}`] = { exit: commit.exitCode, out: commit.stdout.trim(), err: commit.stderr.trim() };
  await time(`close_${n}_ms`, () => sandbox.close());
  return branch;
};

const branch1 = await time("total_cold_ms", () => runOnce(1));
await time("total_warm_ms", () => runOnce(2));
results.branch_to_push = branch1;
fs.writeFileSync(`/tmp/result-${kind}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
