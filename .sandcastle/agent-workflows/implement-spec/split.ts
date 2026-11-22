// The split's host step: an agent reads the spec and answers with its queue,
// on implement-spec's budget line. It holds no secret and writes no code.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md (the spec) in
//   OUTPUT_DIR    gets queue.json on success, and agent-end.json always
// It records a ceiling hit or a crash rather than failing, so the report
// step after it can say how the split ended.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { classifyAgentEnd, type AgentEnd } from "../implement/run-end";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { agentLog } from "./agent-log";
import { specDecompositionSchema } from "./decomposition-schema";

const ioDir = required("AGENT_IO_DIR");
const log = agentLog("split");

const runAgent = async (): Promise<AgentEnd> => {
  try {
    const result = await runWithExtraction({
      name: "split",
      ...sandboxedAgent("implement-spec", { mounts: [ioDir] }),
      cwd: process.cwd(),
      logging: log.logging,
      promptFile: path.join(import.meta.dirname, "split-prompt.md"),
      promptArgs: { AGENT_IO_DIR: ioDir },
      output: sandcastle.Output.object({ tag: "queue", schema: specDecompositionSchema }),
      extractionPrompt: extractionPrompt("queue", specDecompositionSchema),
    });
    writeJson("queue.json", result.output);
    return { kind: "finished" };
  } catch (error) {
    console.error(error);
    return classifyAgentEnd(error, new Date());
  }
};

const agentEnd = await runAgent();
console.log(`\nThe split ${agentEnd.kind === "finished" ? "finished" : `ended: ${agentEnd.kind}, ${agentEnd.message}`}`);
writeJson("agent-end.json", { agentEnd, ...log.usage() });
