import { createHash } from "node:crypto";

const tokenShaped = /sk-ant-[A-Za-z0-9_-]+/g;
const shortestToken = 20;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const prefixesOf = (candidate: string): string[] =>
  Array.from({ length: candidate.length - shortestToken + 1 }, (_, index) =>
    candidate.slice(0, shortestToken + index)
  );

export const containsClaudeToken = (text: string, tokenSha256: string): boolean => {
  const wanted = tokenSha256.toLowerCase();
  return Array.from(text.matchAll(tokenShaped), ([candidate]) => candidate).some((candidate) =>
    prefixesOf(candidate).some((prefix) => sha256(prefix) === wanted)
  );
};
