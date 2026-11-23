import { describe, expect, it } from "vitest";
import { addUsage } from "./agent-step";

describe("an agent run's usage over its passes", () => {
  it("adds the extraction pass's turns and tokens to the work's", () => {
    expect(
      addUsage({ turns: 12, tokens: { input: 1000, output: 200 } }, { turns: 1, tokens: { input: 1100, output: 30 } })
    ).toEqual({ turns: 13, tokens: { input: 2100, output: 230 } });
  });

  it("keeps what one pass reported when the other reported nothing", () => {
    expect(addUsage({}, { turns: 2 })).toEqual({ turns: 2 });
    expect(addUsage({ tokens: { input: 5, output: 1 } }, {})).toEqual({ tokens: { input: 5, output: 1 } });
  });
});
