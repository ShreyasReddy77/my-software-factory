import { describe, expect, it } from "vitest";
import { chooseBatch, labellersToCheck, type BatchCandidate } from "./batch";

const labelled = (number: number, login: string, typename = "User", label = "agent:explore"): BatchCandidate => ({
  id: `I_${number}`,
  number,
  timelineItems: { nodes: [{ label: { name: label }, actor: { login, __typename: typename } }] },
});

const app = "my-factory[bot]";

describe("the people whose permission the explore gate run looks up", () => {
  it("are the people who last applied agent:explore, each once, never a bot", () => {
    const issues = [labelled(1, "alice"), labelled(2, "alice"), labelled(3, "bob"), labelled(4, "my-factory", "Bot")];

    expect(labellersToCheck(issues)).toEqual(["alice", "bob"]);
  });

  it("go by the latest agent:explore label, not an earlier one or another label", () => {
    const issue: BatchCandidate = {
      id: "I_1",
      number: 1,
      timelineItems: {
        nodes: [
          { label: { name: "agent:explore" }, actor: { login: "alice", __typename: "User" } },
          { label: { name: "bug" }, actor: { login: "carol", __typename: "User" } },
          { label: { name: "agent:explore" }, actor: { login: "bob", __typename: "User" } },
        ],
      },
    };

    expect(labellersToCheck([issue])).toEqual(["bob"]);
  });
});

describe("the explore batch", () => {
  it("holds every issue a person with write access labelled, oldest first", () => {
    const batch = chooseBatch([labelled(12, "alice"), labelled(3, "alice")], { alice: "write" }, app);

    expect(batch).toEqual([
      { id: "I_3", number: 3 },
      { id: "I_12", number: 12 },
    ]);
  });

  it("holds the issues the factory's App labelled, whatever GraphQL calls its login", () => {
    const batch = chooseBatch([labelled(5, "my-factory", "Bot"), labelled(6, "my-factory[bot]", "Bot")], {}, app);

    expect(batch.map((issue) => issue.number)).toEqual([5, 6]);
  });

  it("leaves out an issue labelled by someone without write access, or by another bot", () => {
    const batch = chooseBatch(
      [labelled(1, "alice"), labelled(2, "mallory"), labelled(3, "dependabot", "Bot")],
      { alice: "admin", mallory: "triage" },
      app
    );

    expect(batch.map((issue) => issue.number)).toEqual([1]);
  });

  it("leaves out an issue with no agent:explore label event to vouch for it", () => {
    const batch = chooseBatch([{ id: "I_1", number: 1, timelineItems: { nodes: [] } }], {}, app);

    expect(batch).toEqual([]);
  });
});
