// The review agent's host step. It holds no secret: the agent reaches Claude
// through the relay an earlier host step started.
//   AGENT_IO_DIR  shared with the sandbox: review-spec.md in, review-verdict.md out
//   OUTPUT_DIR    gets agent-end.json and review-comments.json
//   BASE_REF, PR_NUMBER, BRANCH  the PR's base, number and head branch
// Run it from the target repo's checkout, on the PR's branch. The agent fixes
// and commits, writes the verdict, and hands back the findings it left.
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import type { z } from "zod/v4";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { diffLines } from "./diff-lines";
import { reviewSchema } from "./review-schema";

const BASE_REF = required("BASE_REF");
const ioDir = required("AGENT_IO_DIR");

const { result } = await runAgentStep("review", (logging) =>
  runWithExtraction({
    name: "review",
    ...sandboxedAgent("review", { mounts: [ioDir] }),
    cwd: process.cwd(),
    logging,
    promptFile: path.join(import.meta.dirname, "prompt.md"),
    promptArgs: { PR_NUMBER: required("PR_NUMBER"), BRANCH: required("BRANCH"), BASE_REF, AGENT_IO_DIR: ioDir },
    output: sandcastle.Output.object({ tag: "comments", schema: reviewSchema }),
    extractionPrompt: extractionPrompt("comments", reviewSchema),
  })
);

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// The diff after the agent's commits: the comments land on that.
const hunks = diffLines(git("diff", `origin/${BASE_REF}...HEAD`));
const found: z.infer<typeof reviewSchema>["comments"] = result?.output.comments ?? [];
const comments = found.filter(({ path: file, line }) => {
  if (hunks.get(file)?.has(line)) return true;
  console.error(`Dropping the comment on ${file}:${line}: not in the diff.`);
  return false;
});

// The request body for POST /repos/{owner}/{repo}/pulls/{n}/reviews.
writeJson("review-comments.json", {
  commit_id: git("rev-parse", "HEAD").trim(),
  event: "COMMENT",
  body: "The findings this review left for you, on their lines. The verdict is in its own comment.",
  comments: comments.map((comment) => ({ ...comment, side: "RIGHT" })),
});
