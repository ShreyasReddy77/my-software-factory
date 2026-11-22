import { findLabeller, trustedLabeller, type IssueEvent } from "../shared/gate";
import { triggerLabel } from "../shared/labels";

// An open issue carrying agent:explore, with the label events that vouch for it.
export type BatchCandidate = {
  readonly id: string;
  readonly number: number;
  readonly timelineItems: {
    readonly nodes: readonly {
      readonly label?: { readonly name: string } | null;
      readonly actor?: { readonly login: string; readonly __typename: string } | null;
    }[];
  };
};

export type BatchIssue = { readonly id: string; readonly number: number };

// One call for the whole batch: up to 100 open agent:explore issues, oldest
// first, as v0's batch was, each with its latest label events.
export const batchQuery = `query($owner: String!, $name: String!, $label: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, labels: [$label], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes {
        id
        number
        timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
          nodes { ... on LabeledEvent { label { name } actor { login __typename } } }
        }
      }
    }
  }
}`;

// GraphQL names an App's bot `slug`; the REST API and the gate name it `slug[bot]`.
const asIssueEvents = (issue: BatchCandidate): IssueEvent[] =>
  issue.timelineItems.nodes.map(({ label, actor }) => ({
    event: "labeled",
    label: label ?? null,
    actor: actor
      ? {
          login: actor.__typename === "Bot" && !actor.login.endsWith("[bot]") ? `${actor.login}[bot]` : actor.login,
          type: actor.__typename,
        }
      : null,
  }));

const exploreLabeller = (issue: BatchCandidate) => findLabeller(asIssueEvents(issue), triggerLabel("explore"));

export const labellersToCheck = (issues: readonly BatchCandidate[]): string[] => [
  ...new Set(
    issues.flatMap((issue) => {
      const labeller = exploreLabeller(issue);
      return labeller?.type === "User" ? [labeller.login] : [];
    })
  ),
];

// Each issue is vouched for by whoever last labelled it agent:explore.
export const chooseBatch = (
  issues: readonly BatchCandidate[],
  permissions: Readonly<Record<string, string>>,
  factoryAppLogin: string
): BatchIssue[] =>
  issues
    .filter((issue) => {
      const labeller = exploreLabeller(issue);
      return (
        labeller !== undefined &&
        trustedLabeller({ ...labeller, permission: permissions[labeller.login] ?? "none" }, factoryAppLogin)
      );
    })
    .map(({ id, number }) => ({ id, number }))
    .sort((a, b) => a.number - b.number);
