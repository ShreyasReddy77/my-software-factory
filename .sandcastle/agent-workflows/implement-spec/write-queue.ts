// Writes the split's queue as issues on the spec's repo. No agent runs here.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; SPEC the spec's number
//   OUTPUT_DIR   holds queue.json from the split
// It writes `written`, the number of tickets created, to $GITHUB_OUTPUT.
import * as fs from "node:fs";
import * as path from "node:path";
import { outputDir, required } from "../shared/common";
import { ghApi, writeOutputs } from "../shared/gh";
import { specQueueLabel } from "../shared/labels";
import { specDecompositionSchema } from "./decomposition-schema";
import { queueIssues } from "./queue";

const repo = required("TARGET_REPO");
const spec = Number(required("SPEC"));

const decomposition = specDecompositionSchema.parse(
  JSON.parse(fs.readFileSync(path.join(outputDir(), "queue.json"), "utf8"))
);

try {
  ghApi([
    "-X", "POST", `repos/${repo}/labels`,
    "-f", `name=${specQueueLabel(spec)}`, "-f", "color=BFD4F2",
    "-f", `description=A ticket in the queue for spec #${spec}`,
  ]);
} catch {
  console.log(`${specQueueLabel(spec)} already exists`);
}

let written = 0;
try {
  for (const issue of queueIssues(decomposition, spec)) {
    const created = ghApi([
      "-X", "POST", `repos/${repo}/issues`,
      "-f", `title=${issue.title}`, "-f", `body=${issue.body}`,
      ...issue.labels.flatMap((label) => ["-f", `labels[]=${label}`]),
    ]) as { number: number };
    written += 1;
    console.log(`Created #${created.number}: ${issue.title}`);
  }
} finally {
  writeOutputs({ written: String(written) });
}
