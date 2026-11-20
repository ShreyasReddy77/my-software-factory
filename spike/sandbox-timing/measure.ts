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

// Probes, each printing one line. Any token found is printed only as a
// fingerprint, never in full.
const probes = `
set +e
echo "whoami: $(whoami) uid=$(id -u)"
echo "env names: $(env | cut -d= -f1 | sort | tr '\n' ' ')"
echo "token-like env: $(env | grep -iE 'token|secret|pat|auth|key' | cut -d= -f1 | tr '\n' ' ')"
echo "extraheader: $(git config --get-regexp 'http\..*extraheader' | sed -E 's/(AUTHORIZATION: basic ).{6}.*/\1<redacted>/I')"
echo "credential helper: $(git config --get-regexp credential)"
echo "git-credentials file: $(ls ~/.git-credentials 2>&1)"
echo "runner _temp readable: $(ls ${RUNNER_TEMP:-/home/runner/work/_temp} 2>&1 | head -5 | tr '\n' ' ')"
echo "runner .credentials: $(ls -la /home/runner/runners 2>&1 | head -3 | tr '\n' ' ')"
echo "proc 1 environ token-like: $(tr '\0' '\n' < /proc/1/environ 2>&1 | grep -ciE 'token|secret')"
echo "host procs visible: $(ls /proc | grep -cE '^[0-9]+$')"
echo "egress api.github.com: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://api.github.com 2>&1)"
echo "egress example.com: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://example.com 2>&1)"
echo "docker socket: $(ls -la /var/run/docker.sock 2>&1)"
echo "sudo: $(sudo -n true 2>&1 && echo yes || echo no)"
`;

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
