// Trial probe: what an agent could read inside bwrap(), and what the
// credential relay answers it. Run in the target checkout, after the relay's
// host step, with no token in the environment:
//   CLAUDE_TOKEN_SHA256  sha256 hex of the Claude token, from the relay step
//   AGENT_IO_DIR         mounted into the sandbox, as in an agent run
// It prints what it checked and throws if anything leaked or the relay
// answered wrongly. It never prints what the sandbox showed.
import * as sandcastle from "@ai-hero/sandcastle";
import { required, sandboxedAgent } from "../shared/common";
import { relayPort } from "../shared/relay.mjs";
import { leaksIn, relayAsks, wrongRelayAnswers, type RelayAnswer, type RelayAsk } from "./probes";

const tokenSha256 = required("CLAUDE_TOKEN_SHA256");
const { sandbox: provider } = sandboxedAgent("explore", { mounts: [required("AGENT_IO_DIR")] });
await using sandbox = await sandcastle.createSandbox({
  branch: `trial-probe-${required("GITHUB_RUN_ID")}`,
  sandbox: provider,
});

const inSandbox = async (command: string): Promise<string> => {
  const result = await sandbox.exec(command);
  if (result.exitCode !== 0) throw new Error(`\`${command}\` exited ${result.exitCode} in the sandbox: ${result.stderr}`);
  return result.stdout;
};

const readable = {
  env: "env",
  "/proc/1/environ": "tr '\\0' '\\n' < /proc/1/environ",
  "every visible process's environ": "for f in /proc/[0-9]*/environ; do tr '\\0' '\\n' < \"$f\" 2>/dev/null || true; done",
  ".git/config": "cat \"$(git rev-parse --git-common-dir)/config\" && git config --list --show-origin",
};

const leaks: string[] = [];
for (const [where, command] of Object.entries(readable)) {
  const found = leaksIn(await inSandbox(command), tokenSha256);
  console.log(`${where}: ${found.length === 0 ? "no token" : `FOUND ${found.join(", ")}`}`);
  leaks.push(...found.map((what) => `${what} in ${where}`));
}
console.log(`Processes the sandbox sees: ${(await inSandbox("ls -d /proc/[0-9]* | wc -l")).trim()}`);

const statusLine = "\n%{http_code}";
const ask = async (relayAsk: RelayAsk): Promise<RelayAnswer> => {
  const output = await inSandbox(
    `curl -s -X ${relayAsk.method} -H 'content-type: application/json' -d '{}' -w '${statusLine}' ` +
      `http://127.0.0.1:${relayPort}${relayAsk.path}`
  );
  const lines = output.trimEnd().split("\n");
  return { ask: relayAsk, status: Number(lines.at(-1)), body: lines.slice(0, -1).join("\n") };
};

const answers: RelayAnswer[] = [];
for (const relayAsk of relayAsks) {
  const answer = await ask(relayAsk);
  console.log(`${relayAsk.method} ${relayAsk.path} -> ${answer.status}`);
  answers.push(answer);
}

const wrong = [...leaks, ...wrongRelayAnswers(answers)];
if (wrong.length > 0) throw new Error(`The sandbox probe failed:\n- ${wrong.join("\n- ")}`);
console.log("The sandbox probe passed: no token is readable inside bwrap(), and the relay refuses all but POST /v1/messages");
