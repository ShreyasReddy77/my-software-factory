import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { credentialEnv } from "./common";

describe("the agent launcher's credential", () => {
  it("passes a subscription token as Claude Code's OAuth token, leaving ANTHROPIC_API_KEY unset", () => {
    expect(credentialEnv("subscription", "token-value")).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "token-value",
    });
  });

  it("passes an API key as ANTHROPIC_API_KEY", () => {
    expect(credentialEnv("api-key", "key-value")).toEqual({
      ANTHROPIC_API_KEY: "key-value",
    });
  });
});

describe("model IDs", () => {
  const factoryRoot = path.join(import.meta.dirname, "../../..");
  const codeDirs = [".sandcastle", ".github"];
  const skipped = new Set(["node_modules", "worktrees", "logs"]);

  const filesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return skipped.has(entry.name) ? [] : filesUnder(full);
      return [full];
    });

  it("appear in no factory code outside budget.yml", () => {
    const offenders = codeDirs
      .flatMap((dir) => filesUnder(path.join(factoryRoot, dir)))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith("package-lock.json"))
      .filter((file) => /claude-(?:opus|sonnet|haiku|fable|\d)/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(factoryRoot, file));
    expect(offenders).toEqual([]);
  });
});
