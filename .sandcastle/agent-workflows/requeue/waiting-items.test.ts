import { describe, expect, it } from "vitest";
import { markerForms, writeMarker, type MarkerForm } from "../shared/marker";
import { readWaitingItem, type WaitingNode } from "./waiting-items";

const app = "agent-factory[bot]";
const appAuthor = { login: "agent-factory", __typename: "Bot" };
const person = { login: "someone", __typename: "User" };

const node = (comments: WaitingNode["comments"]["nodes"]): WaitingNode => ({
  id: "I_7",
  number: 7,
  createdAt: "2026-11-20T00:00:00Z",
  labels: { nodes: [{ name: "factory:queued" }, { name: "bug" }] },
  comments: { nodes: comments },
});

const read = (waiting: WaitingNode, forms?: readonly [MarkerForm, ...MarkerForm[]]) =>
  readWaitingItem(waiting, { repo: "owner/factory", kind: "issue", factoryAppLogin: app, ...(forms ? { forms } : {}) });

describe("reading a waiting item", () => {
  it("restarts it as the trigger label the App's latest marker names", () => {
    const item = read(
      node([
        { body: `Queued. ${writeMarker("agent:explore")}`, author: appAuthor },
        { body: "A person's note.", author: person },
        { body: `Paused. ${writeMarker("agent:implement")}`, author: appAuthor },
      ])
    );

    expect(item).toEqual({
      repo: "owner/factory",
      id: "I_7",
      kind: "issue",
      number: 7,
      createdAt: "2026-11-20T00:00:00Z",
      labels: ["factory:queued", "bug"],
      restartAs: "agent:implement",
    });
  });

  it("ignores a marker anyone but the App wrote, so no one can choose the label the App applies", () => {
    const item = read(
      node([
        { body: `Queued. ${writeMarker("agent:review")}`, author: appAuthor },
        { body: writeMarker("agent:implement"), author: person },
        { body: writeMarker("agent:implement"), author: { login: "other-app", __typename: "Bot" } },
        { body: writeMarker("agent:implement"), author: null },
      ])
    );

    expect(item.restartAs).toBe("agent:review");
  });

  it("has nothing to restart as without a marker", () => {
    expect(read(node([{ body: "Queued.", author: appAuthor }])).restartAs).toBeUndefined();
  });

  it("still reads a previous release's marker once a new form is current", () => {
    const nextForm: MarkerForm = {
      write: (label) => `<!-- factory:marker v2 restart-as=${label} -->`,
      read: (body) => /<!-- factory:marker v2 restart-as=(\S+) -->/.exec(body)?.[1],
    };
    const item = read(node([{ body: `Queued. ${writeMarker("agent:review")}`, author: appAuthor }]), [
      nextForm,
      ...markerForms,
    ]);

    expect(item.restartAs).toBe("agent:review");
  });
});
