import { statusMarker } from "./marker";

export type Issue = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
};

export type IssueComment = {
  readonly user: { readonly login: string; readonly type: string } | null;
  readonly author_association: string;
  readonly body: string;
  readonly created_at: string;
};

const writeAssociations: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];

const trustedComment = (comment: IssueComment, factoryAppLogin: string): boolean => {
  if (comment.body.includes(statusMarker) || comment.user === null) return false;
  if (comment.user.login === factoryAppLogin) return true;
  return comment.user.type === "User" && writeAssociations.includes(comment.author_association);
};

// Only a trusted author's words reach the agent: people with write access
// and the factory's own App. The factory's status lines are left out.
export const renderTicket = (issue: Issue, comments: readonly IssueComment[], factoryAppLogin: string): string => {
  const kept = comments.filter((comment) => trustedComment(comment, factoryAppLogin));
  const head = `# ${issue.title}\n\n${issue.body ?? ""}`;
  if (kept.length === 0) return head;
  const rendered = kept.map((comment) => `\n### ${comment.user?.login} (${comment.created_at})\n\n${comment.body}\n`);
  return `${head}\n\n## Comments\n${rendered.join("")}`;
};
