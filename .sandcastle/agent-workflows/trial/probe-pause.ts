// Trial probe: a real Claude Code run inside bwrap(), against limit-stub.mjs
// in the relay's place, so Claude answers with a forced usage limit. Run it in
// the target checkout with no token in the environment:
//   AGENT_IO_DIR, OUTPUT_DIR  as in an agent run; OUTPUT_DIR gets agent-end.json
// It writes what Claude Code said to the step summary, since the budget
// pause's error fixtures were never captured from a real run.
import * as sandcastle from "@ai-hero/sandcastle";
import { runAgentStep } from "../shared/agent-step";
import { required, sandboxedAgent } from "../shared/common";
import { writeStepSummary } from "../shared/gh";

const { agentEnd } = await runAgentStep("explore", (logging) =>
  sandcastle.run({
    name: "limit-probe",
    ...sandboxedAgent("explore", { mounts: [required("AGENT_IO_DIR")] }),
    cwd: process.cwd(),
    logging,
    prompt: "Reply with the single word ready.",
  })
);

const said = agentEnd.kind === "finished" ? "nothing: the run finished" : agentEnd.message;
writeStepSummary(`### What Claude Code said on a forced usage limit\n\nThe agent ${agentEnd.kind}.\n\n\`\`\`\n${said}\n\`\`\``);
