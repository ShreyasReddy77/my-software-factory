// Writes the split's queue as issues on the spec's repo, in one call. No agent
// runs here.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; SPEC the spec's number
//   OUTPUT_DIR   holds queue.json from the split
// It writes `written`, the number of tickets created, to $GITHUB_OUTPUT.
import { required } from "../shared/common";
import { ghApi, writeOutputs } from "../shared/gh";
import { ghGraphql, readLabelIds, repoVariables } from "../shared/gh-graphql";
import { createIssuesMutation } from "../shared/issue-writes";
import { specQueueLabel } from "../shared/labels";
import { readJson } from "../shared/run-files";
import { queueIssues } from "./queue";
import { specQueueSchema } from "./queue-schema";

const repo = required("TARGET_REPO");
const spec = Number(required("SPEC"));
const label = specQueueLabel(spec);

const queue = specQueueSchema.parse(readJson("queue.json"));

try {
  ghApi([
    "-X", "POST", `repos/${repo}/labels`,
    "-f", `name=${label}`, "-f", "color=BFD4F2",
    "-f", `description=A ticket in the queue for spec #${spec}`,
  ]);
} catch {
  console.log(`${label} already exists`);
}

const repositoryId = ghGraphql<{ repository: { id: string } }>({
  query: "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }",
  variables: repoVariables(repo),
}).repository.id;
const labelId = readLabelIds(repo, [label])[label];
if (labelId === undefined) throw new Error(`No label id for ${label}`);

let written = 0;
try {
  const issues = queueIssues(queue, spec);
  const created = ghGraphql<Record<string, { issue: { number: number } } | null>>(
    createIssuesMutation(repositoryId, issues.map(({ title, body }) => ({ title, body, labelIds: [labelId] })))
  );
  written = Object.values(created).filter((field) => field !== null).length;
  issues.forEach((issue, n) => console.log(`Created #${created[`n${n}`]?.issue.number}: ${issue.title}`));
} finally {
  writeOutputs({ written: String(written) });
}
