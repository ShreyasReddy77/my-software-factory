// A queue ticket's build host step, on implement's budget line. It holds no
// secret: the agent reaches Claude through the relay an earlier step started.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md and spec.md in, pr-body.md out
//   OUTPUT_DIR    where agent-end.json lands: how the agent ended, its turns and tokens
// Run it from the target repo's checkout, on the branch the agent commits to.
// It records a ceiling hit or a crash rather than failing, so the push guard
// and the push still run.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { classifyAgentEnd, type AgentEnd } from "../implement/run-end";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { agentLog } from "./agent-log";

const ioDir = required("AGENT_IO_DIR");
const log = agentLog("build");

const runAgent = async (): Promise<AgentEnd> => {
  try {
    await sandcastle.run({
      name: "build",
      ...sandboxedAgent("implement", { mounts: [ioDir] }),
      cwd: process.cwd(),
      logging: log.logging,
      promptFile: path.join(import.meta.dirname, "build-prompt.md"),
      promptArgs: { AGENT_IO_DIR: ioDir },
    });
    return { kind: "finished" };
  } catch (error) {
    console.error(error);
    return classifyAgentEnd(error, new Date());
  }
};

const agentEnd = await runAgent();
console.log(`\nThe build ${agentEnd.kind === "finished" ? "finished" : `ended: ${agentEnd.kind}, ${agentEnd.message}`}`);
writeJson("agent-end.json", { agentEnd, ...log.usage() });
