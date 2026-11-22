// The push guard's host step. Run it after the agent run and before any push:
//   REPO_DIR             the target repo's checkout holding the agent's commits
//   PUSH_BASE, PUSH_HEAD the commit before the agent ran, and the agent's last commit
//   CLAUDE_TOKEN_SHA256  sha256 hex of the Claude token, from the relay's host step
// It writes `verdict` (push or refuse) and `reasons` to $GITHUB_OUTPUT and
// push-guard.json to OUTPUT_DIR. It exits non-zero only when it cannot scan.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { containsClaudeToken } from "./claude-token-search";
import { required, writeJson } from "./common";
import { installGitleaks, runGitleaks } from "./gitleaks";
import { pushVerdict, refusalText } from "./push-guard";

const sha256Hex = /^[0-9a-fA-F]{64}$/;

const git = (repoDir: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });

const resolveCommit = (repoDir: string, revision: string): string =>
  git(repoDir, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]).trim();

const changedPaths = (bareRepoDir: string, range: string): string[] => {
  const output = git(bareRepoDir, ["log", "-m", "--no-renames", "--name-only", "-z", "--format=", range]);
  return [...new Set(output.split(/[\0\n]/).filter((line) => line !== ""))];
};

const commitsText = (bareRepoDir: string, range: string): string =>
  git(bareRepoDir, [
    "log", "-p", "-m", "--text", "--no-textconv", "--no-ext-diff", "--no-color", "--format=%H%n%B", range,
  ]);

const writeOutputs = (outputs: Readonly<Record<string, string>>): void => {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  for (const [name, value] of Object.entries(outputs)) {
    const delimiter = `EOF_${randomUUID()}`;
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
};

const repoDir = required("REPO_DIR");
const tokenSha256 = required("CLAUDE_TOKEN_SHA256");
if (!sha256Hex.test(tokenSha256)) throw new Error("CLAUDE_TOKEN_SHA256 is not a sha256 hex digest");
const range = `${resolveCommit(repoDir, required("PUSH_BASE"))}..${resolveCommit(repoDir, required("PUSH_HEAD"))}`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-guard-"));
const bareRepoDir = path.join(workDir, "repo.git");
execFileSync("git", ["clone", "--bare", "--quiet", "--", path.resolve(repoDir), bareRepoDir]);

const gitleaksPath = await installGitleaks(path.join(workDir, "bin"));
const verdict = pushVerdict({
  changedPaths: changedPaths(bareRepoDir, range),
  tokenFound: containsClaudeToken(commitsText(bareRepoDir, range), tokenSha256),
  secretFindings: runGitleaks(gitleaksPath, bareRepoDir, range, path.join(workDir, "gitleaks.json")),
});
const reasons = verdict.verdict === "refuse" ? refusalText(verdict.reasons) : "";

console.log(verdict.verdict === "push" ? `The push guard passed ${range}` : reasons);
writeJson("push-guard.json", verdict);
writeOutputs({ verdict: verdict.verdict, reasons });
