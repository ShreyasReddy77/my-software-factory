// The explore agent's host step. It holds no secret: the agent reaches Claude
// through the relay an earlier host step started.
//   AGENT_IO_DIR  a folder shared with the sandbox: issues.json in
//   OUTPUT_DIR    gets agent-end.json, and plan.json when the agent finished
// It records a ceiling hit or a crash rather than failing; the plan is
// missing then, and the apply job refuses to write.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { explorePlanSchema } from "./plan-schema";

const ioDir = required("AGENT_IO_DIR");

const { result } = await runAgentStep("explore", (logging) =>
  runWithExtraction({
    name: "explore",
    ...sandboxedAgent("explore", { mounts: [ioDir] }),
    cwd: process.cwd(),
    logging,
    promptFile: path.join(import.meta.dirname, "prompt.md"),
    promptArgs: { AGENT_IO_DIR: ioDir },
    output: sandcastle.Output.object({ tag: "plan", schema: explorePlanSchema }),
    extractionPrompt: extractionPrompt("plan", explorePlanSchema),
  })
);

if (result !== undefined) writeJson("plan.json", result.output);
