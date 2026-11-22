import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const relayScript = path.join(import.meta.dirname, "relay.mjs");
const children: ChildProcess[] = [];
afterEach(() => children.splice(0).forEach((child) => child.kill()));

const startRelayProcess = (args: string[], stdin: string, env: NodeJS.ProcessEnv = {}) => {
  const child = spawn(process.execPath, [relayScript, ...args], {
    env: { PATH: process.env.PATH, ...env },
  });
  children.push(child);
  child.stdin.end(stdin);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.on("data", () => {
      if (/relay ready on 127\.0\.0\.1:\d+/.test(output)) resolve(output);
    });
    child.on("exit", () => reject(new Error(output)));
  });
  return { ready, exited, output: () => output };
};

describe("the relay's host step", () => {
  it("hands later host steps the token's SHA-256 hash, never the token", async () => {
    const githubOutput = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relay-")), "output");

    const relay = startRelayProcess(["subscription", "0"], "sk-ant-oat01-real\n", {
      GITHUB_OUTPUT: githubOutput,
    });
    await relay.ready;

    const written = fs.readFileSync(githubOutput, "utf8");
    expect(written).toBe(
      "claude-token-sha256=11ea925949974735d194af7c497e70548990670ae4ee4096b1cb7a1dbe40685c\n"
    );
    expect(relay.output()).not.toContain("sk-ant-oat01-real");
  });

  it("refuses to start with no token on stdin", async () => {
    const relay = startRelayProcess(["subscription", "0"], "");

    expect(await relay.exited).not.toBe(0);
    expect(relay.output()).toContain("no token on stdin");
  });

  it("refuses a credential budget.yml cannot name", async () => {
    const relay = startRelayProcess(["oauth", "0"], "sk-ant-oat01-real");

    expect(await relay.exited).not.toBe(0);
    expect(relay.output()).toContain("usage:");
  });
});
