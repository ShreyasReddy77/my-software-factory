// The implement agent's host step. It holds no secret: the agent reaches
// Claude through the relay an earlier host step started.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md in, pr-body.md out
//   OUTPUT_DIR    where agent-end.json lands: how the agent ended, its turns and tokens
// Run it from the target repo's checkout, on the branch the agent commits to.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent } from "../shared/common";

const ioDir = required("AGENT_IO_DIR");

await runAgentStep("implement", (logging) =>
  sandcastle.run({
    name: "implement",
    ...sandboxedAgent("implement", { mounts: [ioDir] }),
    cwd: process.cwd(),
    logging,
    promptFile: path.join(import.meta.dirname, "prompt.md"),
    promptArgs: { AGENT_IO_DIR: ioDir },
  })
);
