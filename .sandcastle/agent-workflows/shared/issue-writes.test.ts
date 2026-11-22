import { describe, expect, it } from "vitest";
import { issueWritesMutation } from "./issue-writes";

describe("the one GraphQL mutation that writes to a batch of issues", () => {
  it("comments, then adds and removes labels, issue by issue in the given order", () => {
    const { query, variables } = issueWritesMutation([
      { issueId: "I_3", comment: "Found it.", addLabelIds: ["L_impl"], removeLabelIds: ["L_prog"] },
      { issueId: "I_7", removeLabelIds: ["L_prog"] },
    ]);

    const fields = [...query.matchAll(/(w\d+[a-z]): (\w+)\(/g)].map((match) => [match[1], match[2]]);
    expect(fields).toEqual([
      ["w0c", "addComment"],
      ["w0a", "addLabelsToLabelable"],
      ["w0r", "removeLabelsFromLabelable"],
      ["w1r", "removeLabelsFromLabelable"],
    ]);
    expect(variables).toMatchObject({ w0id: "I_3", w0body: "Found it.", w1id: "I_7" });
  });

  it("passes every comment as a variable, so its text never becomes part of the query", () => {
    const body = '") { injected } x: closeIssue(input: { issueId: "I_1" }) { clientMutationId } #';
    const { query, variables } = issueWritesMutation([{ issueId: "I_1", comment: body }]);

    expect(query).not.toContain("injected");
    expect(variables.w0body).toBe(body);
  });

  it("declares every variable it uses", () => {
    const { query, variables } = issueWritesMutation([
      { issueId: "I_1", comment: "a", addLabelIds: ["L_1", "L_2"], removeLabelIds: ["L_3"] },
    ]);

    const declared = [...query.matchAll(/\$(\w+): /g)].map((match) => match[1]).sort();
    expect(declared).toEqual(Object.keys(variables).sort());
  });

  it("refuses to build an empty mutation", () => {
    expect(() => issueWritesMutation([])).toThrow();
  });
});
