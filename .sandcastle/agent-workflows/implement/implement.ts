import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { sandboxedAgent } from "../shared/common";

// The agent edits files and commits them itself, so the repo's pre-commit
// hook runs on its work and it has to fix whatever the hook rejects. It does
// not push or open the PR, and it holds no GitHub token to do either — the
// workflow steps after this one do, where you can read them.
await sandcastle.run({
  name: "implement",
  ...sandboxedAgent("implement"),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
});
