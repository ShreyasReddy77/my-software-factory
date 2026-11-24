// What the trial probes count as a failure. Pure: the probe scripts gather
// the text and the answers, these decide.
import { containsClaudeToken } from "../shared/claude-token-search";
import type { PushVerdict, RefuseReason } from "../shared/push-guard";

const leakShapes: readonly { readonly what: string; readonly shape: RegExp }[] = [
  { what: "a Claude key", shape: /sk-ant-[\w-]{20,}/ },
  { what: "a GitHub token", shape: /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,}/ },
  {
    what: "a credential variable",
    shape: /^(?:CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_TOKEN|ANTHROPIC_API_KEY|GH_TOKEN|GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)=/m,
  },
  { what: "a git credential header", shape: /extraheader/i },
];

// Names what the agent could read that it must not: the Claude token itself,
// found by its hash, or anything shaped like a credential.
export const leaksIn = (text: string, tokenSha256: string): readonly string[] => [
  ...(containsClaudeToken(text, tokenSha256) ? ["the Claude token"] : []),
  ...leakShapes.filter(({ shape }) => shape.test(text)).map(({ what }) => what),
];

export type RelayAsk = { readonly method: "GET" | "POST"; readonly path: string; readonly relayed: boolean };

export const relayAsks: readonly RelayAsk[] = [
  { method: "GET", path: "/", relayed: false },
  { method: "GET", path: "/v1/messages", relayed: false },
  { method: "POST", path: "/v1/models", relayed: false },
  { method: "POST", path: "/v1/complete", relayed: false },
  { method: "POST", path: "/v1/messages/count_tokens", relayed: false },
  { method: "POST", path: "/api/oauth/profile", relayed: false },
  { method: "POST", path: "/v1/messages", relayed: true },
];

export type RelayAnswer = { readonly ask: RelayAsk; readonly status: number; readonly body: string };

const refusedByRelay = ({ status, body }: RelayAnswer): boolean => status === 404 && body.includes("not relayed");

// A refusal must come from the relay itself; a relayed ask must reach
// Anthropic, whatever Anthropic then says about its empty body.
export const wrongRelayAnswers = (answers: readonly RelayAnswer[]): readonly string[] =>
  answers
    .filter((answer) => refusedByRelay(answer) === answer.ask.relayed)
    .map(({ ask, status }) => `${ask.method} ${ask.path} got ${status}, expected ${ask.relayed ? "relayed" : "refused"}`);

export type GuardCase = {
  readonly name: string;
  readonly expected: readonly RefuseReason["kind"][];
};

// Wrong when the guard missed a planted reason or refused the clean change.
// An extra reason on planted work is fine: gitleaks may also know a token's shape.
export const guardCaseWrong = (guardCase: GuardCase, verdict: PushVerdict): string | undefined => {
  const got = verdict.verdict === "push" ? [] : verdict.reasons.map((reason) => reason.kind);
  const right = guardCase.expected.length === 0 ? got.length === 0 : guardCase.expected.every((kind) => got.includes(kind));
  return right ? undefined : `${guardCase.name}: expected [${guardCase.expected.join(", ")}], got [${got.join(", ")}]`;
};
