import { describe, expect, it } from "vitest";
import { readResultEvent } from "./result-event";

// Shaped from Claude Code's headless docs (stream-json `result` event), not
// yet captured from a real run: replace with a real line from the first trial.
const resultLine = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 81234,
  num_turns: 12,
  result: "Done.",
  session_id: "abc",
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 100,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 30000,
    output_tokens: 4000,
  },
});

describe("reading Claude Code's result event", () => {
  it("takes the run's turns and tokens, counting cached input as input", () => {
    expect(readResultEvent(resultLine)).toEqual({ turns: 12, tokens: { input: 32100, output: 4000 } });
  });

  it("ignores every other stream line", () => {
    expect(readResultEvent(JSON.stringify({ type: "assistant", message: {} }))).toBeUndefined();
    expect(readResultEvent("not json")).toBeUndefined();
  });

  it("keeps the turns when usage is missing", () => {
    expect(readResultEvent(JSON.stringify({ type: "result", num_turns: 3 }))).toEqual({ turns: 3 });
  });
});
