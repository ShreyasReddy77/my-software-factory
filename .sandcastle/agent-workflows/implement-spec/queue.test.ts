import { describe, expect, it } from "vitest";
import { queueIssues, surveyQueue, type QueueIssue, type SpecDecomposition } from "./queue";

const ticket = (number: number, position: number, dependsOn: readonly number[], extra: Partial<QueueIssue> = {}): QueueIssue => ({
  number,
  state: "open",
  labels: ["spec:7"],
  body: `Part of #7\n\nPosition: ${position}\nDepends on: ${dependsOn.join(", ")}\nShape: cross-cutting\n\n---\n\nBuild it.`,
  ...extra,
});

describe("surveying a spec's queue", () => {
  it("finds no queue when the spec has no tickets yet", () => {
    expect(surveyQueue([])).toEqual({ kind: "no queue" });
  });

  it("picks the lowest open position whose dependencies are all closed", () => {
    const queue = [
      ticket(12, 3, [1]),
      ticket(10, 1, [], { state: "closed" }),
      ticket(11, 2, [1, 3]),
    ];

    expect(surveyQueue(queue)).toEqual({ kind: "ready", ticket: 12 });
  });

  it("skips a ticket another run holds, a parked ticket and a waiting one", () => {
    const queue = [
      ticket(10, 1, [], { labels: ["spec:7", "agent:in-progress"] }),
      ticket(11, 2, [], { labels: ["spec:7", "agent:blocked"] }),
      ticket(12, 3, [], { labels: ["spec:7", "factory:queued"] }),
      ticket(13, 4, [], { labels: ["spec:7", "agent:implement"] }),
      ticket(14, 5, []),
    ];

    expect(surveyQueue(queue)).toEqual({ kind: "ready", ticket: 14 });
  });

  it("reports a drained queue when every ticket is closed", () => {
    expect(surveyQueue([ticket(10, 1, [], { state: "closed" })])).toEqual({ kind: "drained" });
  });

  it("reports open tickets with nothing ready, naming the ones held or parked", () => {
    const queue = [ticket(10, 1, [], { labels: ["spec:7", "agent:blocked"] }), ticket(11, 2, [1])];

    expect(surveyQueue(queue)).toEqual({ kind: "nothing ready", open: [10, 11], held: [10] });
  });

  it("puts a ticket with no position line after every positioned one", () => {
    const queue = [ticket(10, 2, []), { ...ticket(9, 1, []), body: "No position here." }];

    expect(surveyQueue(queue)).toEqual({ kind: "ready", ticket: 10 });
  });
});

describe("writing a spec's queue as issues", () => {
  const decomposition: SpecDecomposition = {
    tickets: [
      { position: 1, title: "First", body: "## What\n\nA.", shape: "service-module", depends_on: [] },
      { position: 2, title: "Second", body: "## What\n\nB.", shape: "route-only", depends_on: [1] },
    ],
  };

  it("labels each ticket with its spec's queue label and links the spec", () => {
    const issues = queueIssues(decomposition, 7);

    expect(issues.map(({ title, labels }) => ({ title, labels }))).toEqual([
      { title: "First", labels: ["spec:7"] },
      { title: "Second", labels: ["spec:7"] },
    ]);
    expect(issues[1]?.body).toMatch(/^Part of #7\n/);
    expect(issues[1]?.body).toContain("## What\n\nB.");
  });

  it("writes bodies the survey reads back in order", () => {
    const written = queueIssues(decomposition, 7).map((issue, index): QueueIssue => ({
      number: 20 + index,
      state: "open",
      labels: issue.labels,
      body: issue.body,
    }));

    expect(surveyQueue(written)).toEqual({ kind: "ready", ticket: 20 });
    expect(surveyQueue([{ ...written[0]!, state: "closed" }, written[1]!])).toEqual({ kind: "ready", ticket: 21 });
  });
});
