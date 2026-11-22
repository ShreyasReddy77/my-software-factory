// Writes the batch the agent reads to $AGENT_IO_DIR/issues.json: each issue's
// number, age and text, with only trusted authors' comments, in one call.
//   GH_TOKEN          App token for TARGET_REPO: Issues read
//   TARGET_REPO       owner/repo; BATCH the gate run's batch, a JSON array of numbers
//   FACTORY_APP_SLUG  the App's slug, from the token step
import * as fs from "node:fs";
import * as path from "node:path";
import { restActor } from "../shared/batch";
import { required } from "../shared/common";
import { readIssues } from "../shared/gh-graphql";
import { renderTicket } from "../shared/ticket";

type BatchIssueText = {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly comments: {
    readonly nodes: readonly {
      readonly author: { readonly login: string; readonly __typename: string } | null;
      readonly authorAssociation: string;
      readonly body: string;
      readonly createdAt: string;
    }[];
  };
};

const selection =
  "number title body createdAt comments(first: 100) { nodes { author { login __typename } authorAssociation body createdAt } }";
const batch = JSON.parse(required("BATCH")) as number[];
const factoryAppLogin = `${required("FACTORY_APP_SLUG")}[bot]`;

const issues = readIssues<BatchIssueText>(required("TARGET_REPO"), batch, selection).map((issue) => ({
  number: issue.number,
  createdAt: issue.createdAt,
  text: renderTicket(
    issue,
    issue.comments.nodes.map((comment) => ({
      user: comment.author ? restActor(comment.author) : null,
      author_association: comment.authorAssociation,
      body: comment.body,
      created_at: comment.createdAt,
    })),
    factoryAppLogin
  ),
}));

fs.writeFileSync(path.join(required("AGENT_IO_DIR"), "issues.json"), JSON.stringify(issues, null, 2));
console.log(`Batch: ${JSON.stringify(batch)}`);
