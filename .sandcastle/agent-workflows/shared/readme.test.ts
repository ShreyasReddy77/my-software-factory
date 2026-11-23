import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const sandcastlePackage = JSON.parse(
  readFileSync(join(repoRoot, ".sandcastle", "package.json"), "utf8"),
) as { readonly scripts: Readonly<Record<string, string>> };

describe("README", () => {
  it("says how to run the factory's tests", () => {
    expect(readme).toContain("## Running the tests");
    expect(readme).toContain("npm test --prefix .sandcastle");
  });

  it("points at a test script that exists", () => {
    expect(sandcastlePackage.scripts.test).toBeDefined();
  });
});
