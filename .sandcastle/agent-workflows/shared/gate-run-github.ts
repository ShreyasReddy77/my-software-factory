// A gate run's reads and writes on GitHub, for every task's gate run. Its
// GH_TOKEN is an App token for the item's repo: Issues write, Actions write.
import { findLabeller, type IssueEvent, type Labeller } from "./gate";
import type { GateAction } from "./gate-run-plan";
import { ghApi, ghPages } from "./gh";
import { relabelIssues } from "./gh-graphql";
import { labels, triggerLabel } from "./labels";
import { statusMarker } from "./marker";
import type { AgentTask } from "./tasks";

const issuePath = (repo: string, number: number): string => `repos/${repo}/issues/${number}`;

export const readPermission = (repo: string, login: string): string => {
  try {
    return (ghApi([`repos/${repo}/collaborators/${login}/permission`]) as { permission: string }).permission;
  } catch {
    return "none";
  }
};

export const readLabeller = (repo: string, number: number, task: AgentTask): Labeller | undefined => {
  const events = ghPages<IssueEvent[]>(`${issuePath(repo, number)}/events?per_page=100`).flat();
  const actor = findLabeller(events, triggerLabel(task));
  if (actor === undefined) return undefined;
  return { ...actor, permission: actor.type === "User" ? readPermission(repo, actor.login) : "none" };
};

const removeLabel = (repo: string, number: number, label: string): void => {
  try {
    ghApi(["-X", "DELETE", `${issuePath(repo, number)}/labels/${encodeURIComponent(label)}`]);
  } catch {
    console.log(`${label} was already off #${number}`);
  }
};

export type GateRunWrites = {
  readonly repo: string;
  readonly item: number;
  readonly actions: readonly GateAction[];
  readonly batch?: readonly { readonly id: string; readonly number: number }[];
  readonly retryText: string;
};

type Claim = { readonly kind: "item"; readonly number: number } | { readonly kind: "batch" };

const carryOut = ({ repo, batch }: GateRunWrites, action: GateAction): Claim | undefined => {
  switch (action.kind) {
    case "comment":
      ghApi(["-X", "POST", `${issuePath(repo, action.on)}/comments`, "-f", `body=${action.body}`]);
      return undefined;
    case "add label":
      ghApi(["-X", "POST", `${issuePath(repo, action.on)}/labels`, "-f", `labels[]=${action.label}`]);
      return action.label === labels.inProgress ? { kind: "item", number: action.on } : undefined;
    case "remove label":
      removeLabel(repo, action.on, action.label);
      return undefined;
    case "claim batch":
      relabelIssues(repo, (batch ?? []).map((member) => member.id), action.add, action.remove);
      return action.add === labels.inProgress ? { kind: "batch" } : undefined;
    case "dispatch agent run":
      ghApi([
        "-X", "POST", `repos/${action.factoryRepo}/actions/workflows/${action.workflow}/dispatches`,
        "-f", `ref=${action.ref}`,
        ...Object.entries(action.inputs).flatMap(([name, value]) => ["-f", `inputs[${name}]=${value}`]),
      ]);
      return undefined;
  }
};

const releaseClaim = (writes: GateRunWrites, claim: Claim, error: unknown): void => {
  const { repo, item, batch, retryText } = writes;
  const reason = error instanceof Error ? error.message : String(error);
  const commentOn = claim.kind === "item" ? claim.number : item;
  if (claim.kind === "item") {
    ghApi(["-X", "POST", `${issuePath(repo, claim.number)}/labels`, "-f", `labels[]=${labels.blocked}`]);
    removeLabel(repo, claim.number, labels.inProgress);
  } else {
    relabelIssues(repo, (batch ?? []).map((member) => member.id), labels.blocked, labels.inProgress);
  }
  ghApi([
    "-X", "POST", `${issuePath(repo, commentOn)}/comments`, "-f",
    `body=The gate run claimed this ${claim.kind} but could not start its agent run: ${reason}. ${retryText} ${statusMarker}`,
  ]);
};

// A claim with no agent run behind it would hold agent:in-progress forever,
// so a write that fails after a claim blocks what was claimed, then rethrows.
export const carryOutGatePlan = (writes: GateRunWrites): void => {
  let claim: Claim | undefined;
  try {
    for (const action of writes.actions) claim = carryOut(writes, action) ?? claim;
  } catch (error) {
    if (claim !== undefined) releaseClaim(writes, claim, error);
    throw error;
  }
};
