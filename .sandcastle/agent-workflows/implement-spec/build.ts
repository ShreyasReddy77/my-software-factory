// A queue ticket's build host step, on implement's budget line. It holds no
// secret: the agent reaches Claude through the relay an earlier step started.
//   AGENT_IO_DIR  a folder shared with the sandbox: ticket.md and spec.md in, pr-body.md out
//   OUTPUT_DIR    where agent-end.json lands: how the agent ended, its turns and tokens
// Run it from the target repo's checkout, on the branch the agent commits to.
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent } from "../shared/common";

const ioDir = required("AGENT_IO_DIR");

await runAgentStep("build", (logging) =>
  sandcastle.run({
    name: "build",
    ...sandboxedAgent("implement", { mounts: [ioDir] }),
    cwd: process.cwd(),
    logging,
    promptFile: path.join(import.meta.dirname, "build-prompt.md"),
    promptArgs: { AGENT_IO_DIR: ioDir },
  })
);
