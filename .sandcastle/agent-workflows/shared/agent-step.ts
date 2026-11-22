import * as path from "node:path";
import type { RunOptions } from "@ai-hero/sandcastle";
import { classifyAgentEnd, describeAgentEnd, type AgentEnd } from "./agent-end";
import { required, writeJson } from "./common";
import { readResultEvent, type RunUsage } from "./result-event";

export const addUsage = (a: RunUsage, b: RunUsage): RunUsage => {
  const turns = a.turns === undefined && b.turns === undefined ? undefined : (a.turns ?? 0) + (b.turns ?? 0);
  const tokens =
    a.tokens === undefined && b.tokens === undefined
      ? undefined
      : {
          input: (a.tokens?.input ?? 0) + (b.tokens?.input ?? 0),
          output: (a.tokens?.output ?? 0) + (b.tokens?.output ?? 0),
        };
  return { ...(turns === undefined ? {} : { turns }), ...(tokens === undefined ? {} : { tokens }) };
};

// Runs an agent's work, streams it to the log and to $OUTPUT_DIR/<name>.log,
// and records how it ended, with the turns and tokens summed over every pass,
// in $OUTPUT_DIR/agent-end.json. It never throws: see CODING_STANDARDS.md.
export const runAgentStep = async <Result>(
  name: string,
  work: (logging: RunOptions["logging"]) => Promise<Result>
): Promise<{ readonly agentEnd: AgentEnd; readonly result?: Result }> => {
  let usage: RunUsage = {};
  const logging: RunOptions["logging"] = {
    type: "file",
    path: path.join(required("OUTPUT_DIR"), `${name}.log`),
    onAgentStreamEvent: (event) => {
      if (event.type === "text") process.stdout.write(event.message);
      else if (event.type === "toolCall") console.log(`\n[${event.name}] ${event.formattedArgs}`);
      else usage = addUsage(usage, readResultEvent(event.line) ?? {});
    },
  };
  let outcome: { agentEnd: AgentEnd; result?: Result };
  try {
    outcome = { agentEnd: { kind: "finished" }, result: await work(logging) };
  } catch (error) {
    console.error(error);
    outcome = { agentEnd: classifyAgentEnd(error, new Date()) };
  }
  const { agentEnd } = outcome;
  console.log(`\nThe ${name} agent ${describeAgentEnd(agentEnd)}`);
  writeJson("agent-end.json", { agentEnd, ...usage });
  return outcome;
};
