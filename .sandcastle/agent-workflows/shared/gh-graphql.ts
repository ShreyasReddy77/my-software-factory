import { execFileSync } from "node:child_process";
import { issueWritesMutation, type GraphqlRequest, type IssueWrite } from "./issue-writes";

// `gh api graphql` with the GH_TOKEN its host step minted. The request goes on
// stdin as JSON, so no value passes through a shell or a command line.
export const ghGraphql = <Data>({ query, variables }: GraphqlRequest): Data => {
  const output = execFileSync("gh", ["api", "graphql", "--input", "-"], {
    input: JSON.stringify({ query, variables }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const response = JSON.parse(output) as { data?: Data; errors?: unknown[] };
  if (response.errors?.length || response.data === undefined)
    throw new Error(`GraphQL refused the request: ${JSON.stringify(response.errors)}`);
  return response.data;
};

export const repoVariables = (repo: string): { owner: string; name: string } => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, name };
};

// The node ids of labels, by name, in one call. A label the repo lacks fails
// loudly: docs/setup-checklist.md creates them once.
export const readLabelIds = <Name extends string>(repo: string, names: readonly Name[]): Record<Name, string> => {
  const fields = names.map((_, n) => `l${n}: label(name: $n${n}) { id }`).join(" ");
  const declarations = names.map((_, n) => `$n${n}: String!`).join(", ");
  const data = ghGraphql<{ repository: Record<string, { id: string } | null> }>({
    query: `query($owner: String!, $name: String!, ${declarations}) { repository(owner: $owner, name: $name) { ${fields} } }`,
    variables: { ...repoVariables(repo), ...Object.fromEntries(names.map((name, n) => [`n${n}`, name])) },
  });
  return Object.fromEntries(
    names.map((name, n) => {
      const label = data.repository[`l${n}`];
      if (!label) throw new Error(`${repo} has no label ${name}; create it as docs/setup-checklist.md says`);
      return [name, label.id];
    })
  ) as Record<Name, string>;
};

export const writeIssues = (writes: readonly IssueWrite[]): void => {
  if (writes.length > 0) ghGraphql(issueWritesMutation(writes));
};

// Swaps one label for another on every issue given, in two calls in all.
export const relabelIssues = (repo: string, issueIds: readonly string[], add: string, remove: string): void => {
  const ids = readLabelIds(repo, [add, remove]);
  const [addId, removeId] = [ids[add], ids[remove]];
  if (addId === undefined || removeId === undefined) throw new Error(`No label ids for ${add} and ${remove}`);
  writeIssues(issueIds.map((issueId) => ({ issueId, addLabelIds: [addId], removeLabelIds: [removeId] })));
};
