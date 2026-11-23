import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod/v4";
import type { SecretFinding } from "./push-guard";

export const gitleaksVersion = "8.30.1";
const linuxX64Sha256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb";

export const installGitleaks = async (dir: string): Promise<string> => {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(`The push guard runs gitleaks on linux x64 only, not ${process.platform} ${process.arch}`);
  const tarball = `gitleaks_${gitleaksVersion}_linux_x64.tar.gz`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/${tarball}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== linuxX64Sha256)
    throw new Error(`${tarball} has sha256 ${actualSha256}, expected ${linuxX64Sha256}`);
  fs.mkdirSync(dir, { recursive: true });
  const archivePath = path.join(dir, tarball);
  fs.writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xzf", archivePath, "-C", dir, "gitleaks"]);
  return path.join(dir, "gitleaks");
};

const reportFinding = z.object({
  RuleID: z.string(),
  File: z.string(),
  Commit: z.string(),
  StartLine: z.number(),
});
const report = z.array(reportFinding);

const gitleaksEnv = (): NodeJS.ProcessEnv => {
  const { GITLEAKS_CONFIG, GITLEAKS_CONFIG_TOML, ...env } = process.env;
  return env;
};

// A bare clone, because gitleaks obeys any .gitleaksignore or .gitleaks.toml
// in the folder it scans, and the agent can write those.
export const runGitleaks = (
  gitleaksPath: string,
  bareRepoDir: string,
  range: string,
  reportPath: string
): SecretFinding[] => {
  const version = execFileSync(gitleaksPath, ["version"], { encoding: "utf8" }).trim();
  if (version.replace(/^v/, "") !== gitleaksVersion)
    throw new Error(`gitleaks is ${version}, the push guard is pinned to ${gitleaksVersion}`);
  execFileSync(
    gitleaksPath,
    [
      "git",
      bareRepoDir,
      `--log-opts=-m --no-textconv --no-ext-diff ${range}`,
      "--gitleaks-ignore-path",
      bareRepoDir,
      "--ignore-gitleaks-allow",
      "--report-format",
      "json",
      "--report-path",
      reportPath,
      "--redact",
      "--exit-code",
      "0",
      "--no-banner",
    ],
    { env: gitleaksEnv(), stdio: ["ignore", "inherit", "inherit"] }
  );
  const findings = report.parse(JSON.parse(fs.readFileSync(reportPath, "utf8"))).map((finding) => ({
    rule: finding.RuleID,
    file: finding.File,
    commit: finding.Commit,
    line: finding.StartLine,
  }));
  return [...new Map(findings.map((finding) => [JSON.stringify(finding), finding])).values()];
};
