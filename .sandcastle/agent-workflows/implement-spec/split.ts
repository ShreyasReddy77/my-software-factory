// The split's host step: an agent reads the spec and answers with its queue,
// on implement-spec's budget line. It holds no secret and writes no code.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md (the spec) in
//   OUTPUT_DIR    gets queue.json on success, and agent-end.json always
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { specQueueSchema } from "./queue-schema";

const ioDir = required("AGENT_IO_DIR");

const { result } = await runAgentStep("split", (logging) =>
  runWithExtraction({
    name: "split",
    ...sandboxedAgent("implement-spec", { mounts: [ioDir] }),
    cwd: process.cwd(),
    logging,
    promptFile: path.join(import.meta.dirname, "split-prompt.md"),
    promptArgs: { AGENT_IO_DIR: ioDir },
    output: sandcastle.Output.object({ tag: "queue", schema: specQueueSchema }),
    extractionPrompt: extractionPrompt("queue", specQueueSchema),
  })
);

if (result !== undefined) writeJson("queue.json", result.output);
