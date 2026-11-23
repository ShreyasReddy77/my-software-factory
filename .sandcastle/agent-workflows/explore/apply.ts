// The apply job's host step. It runs no agent: it checks the plan the explore
// agent returned, and only then writes it, survivors first.
//   GH_TOKEN     App token for TARGET_REPO: Issues write
//   TARGET_REPO  owner/repo; BATCH the gate run's batch, a JSON array of numbers
//   PLAN         plan.json from the explore job, as text; RUN_URL this run's page
// A plan that breaks any rule is refused whole: nothing is written, and the
// finish job marks the batch blocked.
import { required } from "../shared/common";
import { ghApi } from "../shared/gh";
import { readIssues, readLabelIds, writeIssues } from "../shared/gh-graphql";
import { labels, triggerLabel } from "../shared/labels";
import { checkPlan, planApply, type ExplorePlan } from "./apply-plan";

const repo = required("TARGET_REPO");
const batch = JSON.parse(required("BATCH")) as number[];
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const plan = parseJson(process.env.PLAN ?? "");

const problems = checkPlan(plan, batch);
if (problems.length > 0) {
  console.error("Refusing the plan. Nothing was written, and the finish job marks the batch agent:blocked.");
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

const writes = planApply(plan as ExplorePlan, required("RUN_URL"));
const ids = readLabelIds(repo, [labels.inProgress, triggerLabel("implement"), labels.needsAHuman]);
const issueIds = readIssues<{ id: string }>(repo, writes.map((write) => write.number), "id");

writeIssues(
  writes.map((write, n) => ({
    issueId: issueIds[n]?.id ?? "",
    comment: write.comment,
    removeLabelIds: [ids[labels.inProgress]],
    ...(write.addLabel === undefined ? {} : { addLabelIds: [ids[write.addLabel as keyof typeof ids]] }),
  }))
);

// GraphQL's close reasons vary by GitHub version; REST's `duplicate` does not.
for (const write of writes.filter((candidate) => candidate.close))
  ghApi(["-X", "PATCH", `repos/${repo}/issues/${write.number}`, "-f", "state=closed", "-f", "state_reason=duplicate"]);

console.log(`Applied the plan to ${JSON.stringify(writes.map((write) => write.number))}.`);
