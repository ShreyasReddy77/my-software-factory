// Writes to many issues in one GraphQL call, so a batch costs one request,
// not one per issue. Top-level mutation fields run in order, so the writes
// land issue by issue as given. Every value travels as a variable.
export type IssueWrite = {
  readonly issueId: string;
  readonly comment?: string;
  readonly addLabelIds?: readonly string[];
  readonly removeLabelIds?: readonly string[];
};

export type GraphqlRequest = {
  readonly query: string;
  readonly variables: Readonly<Record<string, string>>;
};

export const issueWritesMutation = (writes: readonly IssueWrite[]): GraphqlRequest => {
  if (writes.length === 0) throw new Error("No issue writes to send");
  const declarations: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, string> = {};
  const declare = (name: string, type: string, value: string): string => {
    declarations.push(`$${name}: ${type}`);
    variables[name] = value;
    return `$${name}`;
  };
  const labelList = (prefix: string, ids: readonly string[]): string =>
    `[${ids.map((id, n) => declare(`${prefix}${n}`, "ID!", id)).join(", ")}]`;

  writes.forEach((write, n) => {
    const w = `w${n}`;
    const issue = declare(`${w}id`, "ID!", write.issueId);
    if (write.comment !== undefined) {
      const body = declare(`${w}body`, "String!", write.comment);
      fields.push(`${w}c: addComment(input: { subjectId: ${issue}, body: ${body} }) { clientMutationId }`);
    }
    if (write.addLabelIds?.length)
      fields.push(
        `${w}a: addLabelsToLabelable(input: { labelableId: ${issue}, labelIds: ${labelList(`${w}add`, write.addLabelIds)} }) { clientMutationId }`
      );
    if (write.removeLabelIds?.length)
      fields.push(
        `${w}r: removeLabelsFromLabelable(input: { labelableId: ${issue}, labelIds: ${labelList(`${w}rm`, write.removeLabelIds)} }) { clientMutationId }`
      );
  });

  return { query: `mutation(${declarations.join(", ")}) {\n  ${fields.join("\n  ")}\n}`, variables };
};
