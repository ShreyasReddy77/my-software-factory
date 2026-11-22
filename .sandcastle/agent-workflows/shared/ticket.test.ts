import { describe, expect, it } from "vitest";
import { renderTicket, type IssueComment } from "./ticket";

const issue = { number: 5, title: "Add a retry", body: "Retry failed pushes once." };
const factoryAppLogin = "my-factory[bot]";

const comment = (fields: Partial<IssueComment>): IssueComment => ({
  user: { login: "owner", type: "User" },
  author_association: "OWNER",
  body: "Use exponential backoff.",
  created_at: "2026-11-22T09:00:00Z",
  ...fields,
});

describe("the ticket text an agent reads", () => {
  it("is the title and body when there are no comments", () => {
    expect(renderTicket(issue, [], factoryAppLogin)).toBe("# Add a retry\n\nRetry failed pushes once.");
  });

  it("adds comments from people with write access and from the factory's App", () => {
    const text = renderTicket(
      issue,
      [
        comment({}),
        comment({ user: { login: factoryAppLogin, type: "Bot" }, author_association: "NONE", body: "Explore's findings." }),
      ],
      factoryAppLogin
    );

    expect(text).toBe(
      "# Add a retry\n\nRetry failed pushes once.\n\n## Comments\n" +
        "\n### owner (2026-11-22T09:00:00Z)\n\nUse exponential backoff.\n" +
        `\n### ${factoryAppLogin} (2026-11-22T09:00:00Z)\n\nExplore's findings.\n`
    );
  });

  it.each([
    ["a stranger", comment({ user: { login: "stranger", type: "User" }, author_association: "NONE" })],
    ["a contributor", comment({ user: { login: "drive-by", type: "User" }, author_association: "CONTRIBUTOR" })],
    ["another bot", comment({ user: { login: "dependabot[bot]", type: "Bot" }, author_association: "MEMBER" })],
    ["the factory's status line", comment({ body: "Claimed. <!-- factory:status -->" })],
  ])("drops a comment from %s", (_, dropped) => {
    expect(renderTicket(issue, [dropped], factoryAppLogin)).toBe("# Add a retry\n\nRetry failed pushes once.");
  });

  it("reads an issue with no body", () => {
    expect(renderTicket({ ...issue, body: null }, [], factoryAppLogin)).toBe("# Add a retry\n\n");
  });
});
