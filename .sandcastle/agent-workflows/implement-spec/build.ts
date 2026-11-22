import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { sandboxedAgent } from "../shared/common";

// Like the one-off implementer: the agent edits and commits, through the
// pre-commit hook; the workflow pushes and opens the PR.
await sandcastle.run({
  name: "build-ticket",
  ...sandboxedAgent("implement"),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "build-prompt.md"),
});
