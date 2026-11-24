// Trial probe: the push guard on commits with planted work. In a scratch repo
// it commits a stand-in Claude token, a key shaped like a real Anthropic key,
// a workflow file, and a clean change, and runs the real guard-push.ts on
// each, as an agent run does. Throws when the guard passes planted work,
// misses the planted reason, or refuses the clean change.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PushVerdict } from "../shared/push-guard";
import { guardCaseWrong, type GuardCase } from "./probes";

const randomKey = (length: number): string => randomBytes(length).toString("base64url").slice(0, length);
const token = `sk-ant-oat01-${randomKey(95)}`;
const keyShaped = `sk-ant-api03-${randomKey(93)}AA`;

type Planted = GuardCase & { readonly files: Readonly<Record<string, string>> };

const cases: readonly Planted[] = [
  { name: "clean change", expected: [], files: { "notes.md": "A plain change.\n" } },
  { name: "the Claude token", expected: ["token found"], files: { "config.ts": `export const key = "${token}";\n` } },
  { name: "a real-shaped Anthropic key", expected: ["secret found"], files: { "settings.env": `ANTHROPIC_API_KEY=${keyShaped}\n` } },
  { name: "a workflow file", expected: ["workflow path changed"], files: { ".github/workflows/sneak.yml": "on: push\n" } },
];

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-probe-"));
const repoDir = path.join(workDir, "repo");
const git = (...args: string[]): string =>
  execFileSync("git", ["-C", repoDir, "-c", "user.name=probe", "-c", "user.email=probe@example.com", ...args], { encoding: "utf8" });

fs.mkdirSync(repoDir);
git("init", "--quiet", "--initial-branch=main");
fs.writeFileSync(path.join(repoDir, "README.md"), "Guard probe\n");
git("add", "-A");
git("commit", "--quiet", "-m", "base");
const base = git("rev-parse", "HEAD").trim();

const guardScript = path.join(import.meta.dirname, "../shared/guard-push.ts");
const tsx = path.join(import.meta.dirname, "../../node_modules/.bin/tsx");
const tokenSha256 = createHash("sha256").update(token).digest("hex");

const verdictOf = (planted: Planted): PushVerdict => {
  git("checkout", "--quiet", "-B", "probe", base);
  for (const [file, text] of Object.entries(planted.files)) {
    fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true });
    fs.writeFileSync(path.join(repoDir, file), text);
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", planted.name);
  const outputDir = fs.mkdtempSync(path.join(workDir, "output-"));
  execFileSync(tsx, [guardScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      REPO_DIR: repoDir,
      PUSH_BASE: base,
      PUSH_HEAD: "HEAD",
      CLAUDE_TOKEN_SHA256: tokenSha256,
      OUTPUT_DIR: outputDir,
      GITHUB_OUTPUT: path.join(outputDir, "github-output"),
    },
  });
  return JSON.parse(fs.readFileSync(path.join(outputDir, "push-guard.json"), "utf8")) as PushVerdict;
};

const wrong = cases.flatMap((planted) => {
  const verdict = verdictOf(planted);
  console.log(`${planted.name}: ${verdict.verdict}`);
  return [guardCaseWrong(planted, verdict) ?? []].flat();
});
if (wrong.length > 0) throw new Error(`The push guard probe failed:\n- ${wrong.join("\n- ")}`);
console.log("The push guard probe passed: it refused each planted secret and workflow file, and passed the clean change");
