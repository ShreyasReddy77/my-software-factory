import { describe, expect, it } from "vitest";
import { containsClaudeToken } from "./claude-token-search";

const fakeToken = `sk-ant-oat01-${"Ab3_-".repeat(18)}`;
const otherToken = `sk-ant-api03-${"Zy9-_".repeat(18)}`;
// sha256 of fakeToken, computed independently with `printf %s "$token" | sha256sum`.
const fakeTokenSha256 = "9691706e15575295471e618c5c12b700eeaede05e1ab3ec9befc581ea89de55b";

describe("Claude token search", () => {
  it.each([
    ["on a line of its own", fakeToken],
    ["in an env file", `CLAUDE_CODE_OAUTH_TOKEN=${fakeToken}\n`],
    ["quoted in code", `const token = "${fakeToken}";`],
    ["after another token", `${otherToken} and ${fakeToken}`],
    ["with more token characters after it", `${fakeToken}xyz`],
  ])("finds the token %s", (_where, text) => {
    expect(containsClaudeToken(text, fakeTokenSha256)).toBe(true);
  });

  it.each([
    ["no token at all", "const answer = 42;"],
    ["a different token", `ANTHROPIC_API_KEY=${otherToken}`],
    ["the token cut short", fakeToken.slice(0, -1)],
  ])("finds nothing in %s", (_where, text) => {
    expect(containsClaudeToken(text, fakeTokenSha256)).toBe(false);
  });

  it("accepts the hash in upper case", () => {
    expect(containsClaudeToken(fakeToken, fakeTokenSha256.toUpperCase())).toBe(true);
  });
});
