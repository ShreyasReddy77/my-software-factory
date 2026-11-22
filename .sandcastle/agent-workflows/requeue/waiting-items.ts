// The waiting items as GraphQL returns them, and what the requeue planner
// reads from each: its labels, its age and the trigger label it restarts as.
import { restActor } from "../shared/batch";
import { markerForms, readMarker, type MarkerForm } from "../shared/marker";
import type { WaitingItem } from "./requeue-plan";

type Author = { readonly login: string; readonly __typename: string } | null;

export type WaitingNode = {
  readonly id: string;
  readonly number: number;
  readonly createdAt: string;
  readonly labels: { readonly nodes: readonly { readonly name: string }[] };
  readonly comments: WaitingComments;
};

export type WaitingComments = {
  readonly pageInfo?: { readonly hasPreviousPage: boolean; readonly startCursor: string | null };
  readonly nodes: readonly { readonly body: string; readonly author: Author }[];
};

const commentsSelection = "pageInfo { hasPreviousPage startCursor } nodes { body author { login __typename } }";

// Older comments of one waiting item, for the rare item whose marker sits
// before its last 100 comments.
export const earlierCommentsQuery = `query($id: ID!, $before: String) {
  node(id: $id) {
    ... on Issue { comments(last: 100, before: $before) { ${commentsSelection} } }
    ... on PullRequest { comments(last: 100, before: $before) { ${commentsSelection} } }
  }
}`;

const connection = (field: "issues" | "pullRequests"): string => `
    ${field}(first: 100, after: $after, states: OPEN, labels: $labels, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        number
        createdAt
        labels(first: 100) { nodes { name } }
        comments(last: 100) { ${commentsSelection} }
      }
    }`;

// One query per kind and page: every open issue or PR carrying either waiting
// label, with the comments that hold its marker.
export const waitingQuery = (field: "issues" | "pullRequests"): string =>
  `query($owner: String!, $name: String!, $labels: [String!], $after: String) {
  repository(owner: $owner, name: $name) {${connection(field)}
  }
}`;

export type WaitingItemContext = {
  readonly repo: string;
  readonly kind: WaitingItem["kind"];
  readonly factoryAppLogin: string;
  readonly forms?: readonly [MarkerForm, ...MarkerForm[]];
};

// Only the App's own markers count: the App applies the label a marker names,
// so a marker anyone else wrote would let them choose it.
export const readWaitingItem = (node: WaitingNode, context: WaitingItemContext): WaitingItem => {
  const restartAs = node.comments.nodes
    .filter((comment) => comment.author !== null && restActor(comment.author).login === context.factoryAppLogin)
    .map((comment) => readMarker(comment.body, context.forms ?? markerForms))
    .findLast((label) => label !== undefined);
  return {
    repo: context.repo,
    id: node.id,
    kind: context.kind,
    number: node.number,
    createdAt: node.createdAt,
    labels: node.labels.nodes.map((label) => label.name),
    restartAs,
  };
};
