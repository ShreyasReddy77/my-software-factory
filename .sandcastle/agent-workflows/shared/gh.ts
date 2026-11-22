import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

// The GitHub layer's only door to GitHub: `gh api` with the GH_TOKEN its host
// step minted. Arguments go to gh as an array, never through a shell.
export const ghApi = (args: readonly string[]): unknown => {
  const output = execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.trim() === "" ? undefined : JSON.parse(output);
};

// Every page of a list endpoint, as one array of pages.
export const ghPages = <Page>(endpoint: string): Page[] =>
  ghApi(["--paginate", "--slurp", endpoint]) as Page[];

export const writeOutputs = (outputs: Readonly<Record<string, string>>): void => {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  for (const [name, value] of Object.entries(outputs)) {
    const delimiter = `EOF_${randomUUID()}`;
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
};

export const writeStepSummary = (markdown: string): void => {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) fs.appendFileSync(summaryFile, `${markdown}\n`);
  else console.log(markdown);
};
