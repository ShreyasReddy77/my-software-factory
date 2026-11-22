import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// v0's personal access token gave way to the factory's App. Its name is built
// from parts here so this file is not itself a mention of it.
const retiredPat = ["FACTORY", "PAT"].join("_");

const repoRoot = path.join(import.meta.dirname, "../../..");
const trackedFiles = (): readonly string[] =>
  execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "" && fs.existsSync(path.join(repoRoot, file)));

describe("the retired personal access token", () => {
  it("is named nowhere in the repo", () => {
    const mentions = trackedFiles().filter((file) =>
      fs.readFileSync(path.join(repoRoot, file), "utf8").includes(retiredPat),
    );
    expect(mentions).toEqual([]);
  });
});
