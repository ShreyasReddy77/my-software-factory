import * as path from "node:path";
import type { RunOptions } from "@ai-hero/sandcastle";
import { required } from "../shared/common";
import { readResultEvent, type RunUsage } from "../shared/result-event";

// The agent's stream goes to a log file in OUTPUT_DIR and its text to the
// step log; the last result event's turns and tokens land in `usage`.
export const agentLog = (name: string): { logging: RunOptions["logging"]; usage: () => RunUsage } => {
  let usage: RunUsage = {};
  return {
    logging: {
      type: "file",
      path: path.join(required("OUTPUT_DIR"), `${name}.log`),
      onAgentStreamEvent: (event) => {
        if (event.type === "text") process.stdout.write(event.message);
        else if (event.type === "toolCall") console.log(`\n[${event.name}] ${event.formattedArgs}`);
        else usage = readResultEvent(event.line) ?? usage;
      },
    },
    usage: () => usage,
  };
};
