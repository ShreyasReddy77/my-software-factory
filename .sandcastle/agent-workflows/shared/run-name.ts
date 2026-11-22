export type LockKey =
  | { readonly scope: "ticket"; readonly repo: string; readonly number: number }
  | { readonly scope: "pr"; readonly repo: string; readonly number: number }
  | { readonly scope: "repo"; readonly repo: string };

export type RunName = {
  readonly task: string;
  readonly lockKey: LockKey;
  readonly agentRun: boolean;
};

const noAgentSuffix = " (no agent)";

const writeLockKey = (lockKey: LockKey): string =>
  lockKey.scope === "repo"
    ? `repo ${lockKey.repo}`
    : `${lockKey.scope} ${lockKey.repo}#${lockKey.number}`;

export const writeRunName = (runName: RunName): string =>
  `[${writeLockKey(runName.lockKey)}] ${runName.task}` +
  (runName.agentRun ? "" : noAgentSuffix);

const repoPattern = "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+";
const runNamePattern = new RegExp(
  `^\\[(?:(?<numbered>ticket|pr) (?<numberedRepo>${repoPattern})#(?<number>[1-9][0-9]*)` +
    `|repo (?<repo>${repoPattern}))\\] (?<task>[a-z][a-z-]*)(?<noAgent> \\(no agent\\))?$`
);

const readLockKey = (groups: Record<string, string | undefined>): LockKey => {
  if (groups.repo !== undefined) return { scope: "repo", repo: groups.repo };
  return {
    scope: groups.numbered === "pr" ? "pr" : "ticket",
    repo: groups.numberedRepo ?? "",
    number: Number(groups.number),
  };
};

export const parseRunName = (name: string): RunName | undefined => {
  const groups = runNamePattern.exec(name)?.groups;
  if (groups?.task === undefined) return undefined;
  return {
    task: groups.task,
    lockKey: readLockKey(groups),
    agentRun: groups.noAgent === undefined,
  };
};
