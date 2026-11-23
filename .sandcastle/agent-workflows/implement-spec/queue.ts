import type { z } from "zod/v4";
import { labels, specQueueLabel, triggerLabel } from "../shared/labels";
import type { specQueueSchema } from "./queue-schema";

export type SpecQueue = z.infer<typeof specQueueSchema>;

export type QueueIssue = {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
  readonly openPullRequests: number;
  readonly body: string | null;
};

export type QueueSurvey =
  | { readonly kind: "no queue" }
  | { readonly kind: "ready"; readonly ticket: number }
  | { readonly kind: "drained" }
  | { readonly kind: "nothing ready"; readonly open: readonly number[]; readonly held: readonly number[] };

const holdingLabels: readonly string[] = [
  labels.inProgress,
  labels.blocked,
  labels.queued,
  labels.paused,
  triggerLabel("implement"),
];

const unpositioned = Number.MAX_SAFE_INTEGER;

const positionOf = (body: string): number => {
  const match = /^Position:\s*(\d+)/m.exec(body);
  return match ? Number(match[1]) : unpositioned;
};

const dependenciesOf = (body: string): number[] =>
  (/^Depends on:[ \t]*([\d, \t]*)$/m.exec(body)?.[1] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number);

export type NewQueueIssue = {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
};

export const queueIssues = (queue: SpecQueue, spec: number): NewQueueIssue[] =>
  [...queue.tickets]
    .sort((a, b) => a.position - b.position)
    .map((ticket) => ({
      title: ticket.title,
      body:
        `Part of #${spec}\n\nPosition: ${ticket.position}\nDepends on: ${ticket.depends_on.join(", ")}\n\n` +
        `---\n\n${ticket.body}`,
      labels: [specQueueLabel(spec)],
    }));

export const surveyQueue =(issues: readonly QueueIssue[]): QueueSurvey => {
  if (issues.length === 0) return { kind: "no queue" };
  const tickets = issues
    .map((issue) => ({ ...issue, position: positionOf(issue.body ?? ""), dependsOn: dependenciesOf(issue.body ?? "") }))
    .sort((a, b) => a.position - b.position || a.number - b.number);
  const closed = new Set(tickets.filter((t) => t.state === "closed").map((t) => t.position));
  const open = tickets.filter((t) => t.state === "open");
  if (open.length === 0) return { kind: "drained" };
  const held = open.filter(
    (t) => t.openPullRequests > 0 || t.labels.some((label) => holdingLabels.includes(label))
  );
  const ready = open.find((t) => !held.includes(t) && t.dependsOn.every((position) => closed.has(position)));
  if (ready) return { kind: "ready", ticket: ready.number };
  return { kind: "nothing ready", open: open.map((t) => t.number), held: held.map((t) => t.number) };
};
