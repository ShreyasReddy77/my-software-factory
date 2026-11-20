// Spike for "Test a Claude credential relay outside the bwrap sandbox".
// Not factory code: it is thrown away once the findings are recorded.
//
// Runs Claude Code under bwrap() with only a stand-in token and
// ANTHROPIC_BASE_URL pointing at the relay, which an earlier step started.
// This step's own environment holds no credential at all.
//
//   tsx run.ts <variant>
//     oauth-env   CLAUDE_CODE_OAUTH_TOKEN=<stand-in>  (Claude Code's subscription path)
//     auth-token  ANTHROPIC_AUTH_TOKEN=<stand-in>     (the gateway path; relay adds the OAuth beta)
//     api-key     ANTHROPIC_API_KEY=<stand-in>        (relay swaps x-api-key)
import * as fs from "node:fs";
import { claudeCode, createSandbox } from "@ai-hero/sandcastle";
import { bwrap } from "@ai-hero/sandcastle/sandboxes/bwrap";

const variant = process.argv[2];
const relay = "http://127.0.0.1:8787";
const standIn = "stand-in-not-a-real-token";
const credentialEnv: Record<string, Record<string, string>> = {
  "oauth-env": { CLAUDE_CODE_OAUTH_TOKEN: standIn },
  "auth-token": { ANTHROPIC_AUTH_TOKEN: standIn },
  "api-key": { ANTHROPIC_API_KEY: standIn },
};
if (!credentialEnv[variant]) throw new Error(`unknown variant ${variant}`);

const repo = process.env.GITHUB_WORKSPACE!;
const results: Record<string, unknown> = { variant };
const time = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try {
    return await f();
  } finally {
    results[label] = Math.round(performance.now() - start);
  }
};

const sandbox = await time("create_ms", () =>
  createSandbox({
    branch: `spike/relay-${variant}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    cwd: repo,
    sandbox: bwrap({
      env: {
        ANTHROPIC_BASE_URL: relay,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...credentialEnv[variant],
      },
    }),
  }),
);

const probes = await time("probes_ms", () => sandbox.exec(`bash spike/claude-relay/probes.sh probe ${relay}`));
results.probes = probes.stdout.trim().split("\n");
results.probes_stderr = probes.stderr.trim().slice(0, 2000);

try {
  const run = await time("agent_ms", () =>
    sandbox.run({
      agent: claudeCode("haiku"),
      prompt:
        "Create a file named relay-proof.txt containing exactly the text `relay ok`. " +
        "Then run `git add relay-proof.txt && git commit -m 'spike: relay proof'`. " +
        "When the commit exists, output <promise>COMPLETE</promise>.",
      maxIterations: 1,
    }),
  );
  results.agent = {
    completionSignal: run.completionSignal ?? null,
    commits: run.commits.map((c) => c.sha),
    stdout_tail: run.stdout.slice(-3000),
  };
} catch (e) {
  results.agent = { error: String(e).slice(0, 3000) };
}

const proof = await sandbox.exec("git log --oneline -2 && cat relay-proof.txt");
results.proof = proof.stdout.trim() + proof.stderr.trim();

// After the agent ran, so Claude Code's own files in the private home count too.
const dump = await sandbox.exec(`bash spike/claude-relay/probes.sh dump ${sandbox.worktreePath}/.relay-dump`);
results.dump = dump.stdout.trim();
fs.copyFileSync(`${sandbox.worktreePath}/.relay-dump`, `/tmp/relay-dump-${variant}`);

await time("close_ms", () => sandbox.close());
fs.writeFileSync(`/tmp/result-${variant}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
