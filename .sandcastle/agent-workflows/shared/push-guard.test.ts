import { describe, expect, it } from "vitest";
import { pushVerdict, refusalText, type PushScan, type SecretFinding } from "./push-guard";

const cleanScan: PushScan = {
  changedPaths: ["src/app.ts", "README.md"],
  tokenFound: false,
  secretFindings: [],
};

const awsKey: SecretFinding = {
  rule: "aws-access-token",
  file: "config/deploy.env",
  commit: "0123456789abcdef0123456789abcdef01234567",
  line: 3,
};

describe("push guard verdict", () => {
  it("pushes a clean scan", () => {
    expect(pushVerdict(cleanScan)).toEqual({ verdict: "push" });
  });

  it("refuses when the Claude token is in the commits", () => {
    expect(pushVerdict({ ...cleanScan, tokenFound: true })).toEqual({
      verdict: "refuse",
      reasons: [{ kind: "token found" }],
    });
  });

  it("refuses when gitleaks finds a secret", () => {
    expect(pushVerdict({ ...cleanScan, secretFindings: [awsKey] })).toEqual({
      verdict: "refuse",
      reasons: [{ kind: "secret found", findings: [awsKey] }],
    });
  });

  it("refuses any change under .github/workflows/, naming each path", () => {
    const changedPaths = [
      "src/app.ts",
      ".github/workflows/agent-implement.yml",
      ".github/workflows/nested/helper.sh",
    ];
    expect(pushVerdict({ ...cleanScan, changedPaths })).toEqual({
      verdict: "refuse",
      reasons: [
        {
          kind: "workflow path changed",
          paths: [".github/workflows/agent-implement.yml", ".github/workflows/nested/helper.sh"],
        },
      ],
    });
  });

  it.each([".github/dependabot.yml", ".github/workflows-old/ci.yml", "docs/.github/workflows/ci.yml"])(
    "pushes a path outside the workflows folder: %s",
    (path) => {
      expect(pushVerdict({ ...cleanScan, changedPaths: [path] })).toEqual({ verdict: "push" });
    }
  );

  it("gives every reason that applies at once", () => {
    const verdict = pushVerdict({
      changedPaths: [".github/workflows/ci.yml"],
      tokenFound: true,
      secretFindings: [awsKey],
    });
    expect(verdict.verdict).toBe("refuse");
    expect(verdict.verdict === "refuse" && verdict.reasons.map((reason) => reason.kind)).toEqual([
      "secret found",
      "token found",
      "workflow path changed",
    ]);
  });
});

describe("push guard refusal text", () => {
  it("names each finding and path, and never a secret's value", () => {
    const verdict = pushVerdict({
      changedPaths: [".github/workflows/ci.yml"],
      tokenFound: true,
      secretFindings: [awsKey],
    });
    expect(verdict.verdict === "refuse" && refusalText(verdict.reasons)).toBe(
      [
        "The push guard refused to push the agent's commits:",
        "- Secret found by gitleaks: aws-access-token in config/deploy.env line 3 (commit 0123456789ab)",
        "- Token found: the Claude token's value is in the agent's commits",
        "- Workflow path changed: .github/workflows/ci.yml (the factory never changes workflows)",
      ].join("\n")
    );
  });
});
