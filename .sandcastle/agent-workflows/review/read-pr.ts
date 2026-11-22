// Reads the PR under review and writes its spec, the ticket it closes, to
// $AGENT_IO_DIR/review-spec.md. That ticket is the one thing taken from the PR.
//   GH_TOKEN          App token for TARGET_REPO: Pull requests read, Issues read
//   TARGET_REPO       owner/repo; PR the pull request's number
//   FACTORY_APP_SLUG  the App's slug, from the token step
// It writes head-ref, head-sha, base-ref and title to $GITHUB_OUTPUT.
import * as fs from "node:fs";
import * as path from "node:path";
import { required } from "../shared/common";
import { ghApi, ghPages, writeOutputs } from "../shared/gh";
import { renderTicket, type Issue, type IssueComment } from "../shared/ticket";
import { closedTicket } from "./review-end";

type PullRequest = {
  readonly title: string;
  readonly body: string | null;
  readonly head: { readonly ref: string; readonly sha: string; readonly repo: { readonly full_name: string } | null };
  readonly base: { readonly ref: string };
};

const repo = required("TARGET_REPO");
const pr = ghApi([`repos/${repo}/pulls/${Number(required("PR"))}`]) as PullRequest;
if (pr.head.repo?.full_name.toLowerCase() !== repo.toLowerCase())
  throw new Error("This PR comes from a fork; the factory reviews same-repo PRs only");

const ticket = closedTicket(pr.body);
const spec =
  ticket === undefined
    ? "No spec available: this PR does not say which ticket it closes."
    : renderTicket(
        ghApi([`repos/${repo}/issues/${ticket}`]) as Issue,
        ghPages<IssueComment[]>(`repos/${repo}/issues/${ticket}/comments?per_page=100`).flat(),
        `${required("FACTORY_APP_SLUG")}[bot]`
      );

fs.writeFileSync(path.join(required("AGENT_IO_DIR"), "review-spec.md"), spec);
console.log(spec);
writeOutputs({ "head-ref": pr.head.ref, "head-sha": pr.head.sha, "base-ref": pr.base.ref, title: pr.title });
