export type SecretFinding = {
  readonly rule: string;
  readonly file: string;
  readonly commit: string;
  readonly line: number;
};

export type PushScan = {
  readonly changedPaths: readonly string[];
  readonly tokenFound: boolean;
  readonly secretFindings: readonly SecretFinding[];
};

export type RefuseReason =
  | { readonly kind: "secret found"; readonly findings: readonly SecretFinding[] }
  | { readonly kind: "token found" }
  | { readonly kind: "workflow path changed"; readonly paths: readonly string[] };

export type PushVerdict =
  | { readonly verdict: "push" }
  | { readonly verdict: "refuse"; readonly reasons: readonly RefuseReason[] };

const workflowsFolder = ".github/workflows/";

export const pushVerdict = (scan: PushScan): PushVerdict => {
  const reasons: RefuseReason[] = [];
  if (scan.secretFindings.length > 0)
    reasons.push({ kind: "secret found", findings: scan.secretFindings });
  if (scan.tokenFound) reasons.push({ kind: "token found" });
  const workflowPaths = scan.changedPaths.filter((path) => path.startsWith(workflowsFolder));
  if (workflowPaths.length > 0)
    reasons.push({ kind: "workflow path changed", paths: workflowPaths });
  return reasons.length === 0 ? { verdict: "push" } : { verdict: "refuse", reasons };
};

const reasonLine = (reason: RefuseReason): string => {
  switch (reason.kind) {
    case "secret found":
      return reason.findings
        .map(
          (finding) =>
            `- Secret found by gitleaks: ${finding.rule} in ${finding.file} line ${finding.line}` +
            ` (commit ${finding.commit.slice(0, 12)})`
        )
        .join("\n");
    case "token found":
      return "- Token found: the Claude token's value is in the agent's commits";
    case "workflow path changed":
      return `- Workflow path changed: ${reason.paths.join(", ")} (the factory never changes workflows)`;
  }
};

export const refusalText = (reasons: readonly RefuseReason[]): string =>
  ["The push guard refused to push the agent's commits:", ...reasons.map(reasonLine)].join("\n");
