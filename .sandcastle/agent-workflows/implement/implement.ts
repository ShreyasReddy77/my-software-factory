// The implement agent's host step. It holds no secret: the agent reaches
// Claude through the relay an earlier host step started.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md in, pr-body.md out
//   OUTPUT_DIR    where agent-end.json lands: how the agent ended, its turns and tokens
// Run it from the target repo's checkout, on the branch the agent commits to.
// It records a ceiling hit or a crash rather than failing, so the host steps
// after it can still scan and push.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { required, sandboxedAgent, writeJson } from "../shared/common";
import { readResultEvent, type RunUsage } from "../shared/result-event";
import { classifyAgentEnd, type AgentEnd } from "./run-end";

const ioDir = required("AGENT_IO_DIR");
let usage: RunUsage = {};

const runAgent = async (): Promise<AgentEnd> => {
  try {
    await sandcastle.run({
      name: "implement",
      ...sandboxedAgent("implement", { mounts: [ioDir] }),
      cwd: process.cwd(),
      logging: {
        type: "file",
        path: path.join(required("OUTPUT_DIR"), "implement.log"),
        onAgentStreamEvent: (event) => {
          if (event.type === "text") process.stdout.write(event.message);
          else if (event.type === "toolCall") console.log(`\n[${event.name}] ${event.formattedArgs}`);
          else usage = readResultEvent(event.line) ?? usage;
        },
      },
      promptFile: path.join(import.meta.dirname, "prompt.md"),
      promptArgs: { AGENT_IO_DIR: ioDir },
    });
    return { kind: "finished" };
  } catch (error) {
    console.error(error);
    return classifyAgentEnd(error, new Date());
  }
};

const agentEnd = await runAgent();
console.log(`\nThe agent ${agentEnd.kind === "finished" ? "finished" : `ended: ${agentEnd.kind}, ${agentEnd.message}`}`);
writeJson("agent-end.json", { agentEnd, ...usage });
