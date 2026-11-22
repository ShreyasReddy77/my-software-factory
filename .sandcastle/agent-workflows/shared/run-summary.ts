export type ItemRef = { readonly kind: "issue" | "pr"; readonly number: number };

export type Outcome =
  | { readonly kind: "done" | "queued" | "paused" | "ceiling hit" }
  | { readonly kind: "stopped"; readonly reason: string }
  | { readonly kind: "failed try"; readonly try: number; readonly of: number };

export type OutcomeRecord = {
  readonly task: string;
  readonly targetRepo: string;
  readonly item?: ItemRef;
  readonly outcome: Outcome;
  readonly turns?: number;
  readonly seconds: number;
  readonly model?: string;
  readonly tokens?: { readonly input: number; readonly output: number };
  readonly nextLabel?: string;
};

const count = (n: number): string => n.toLocaleString("en-US");

const itemLink = (repo: string, item: ItemRef): string =>
  `[${repo}#${item.number}](https://github.com/${repo}/${item.kind === "pr" ? "pull" : "issues"}/${item.number})`;

const duration = (seconds: number): string => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const describeOutcome = (outcome: Outcome): string => {
  switch (outcome.kind) {
    case "stopped":
      return `stopped: ${outcome.reason}`;
    case "failed try":
      return `failed try ${outcome.try} of ${outcome.of}`;
    default:
      return outcome.kind;
  }
};

const cell = (value: string): string => value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

const row = (name: string, value: string): string => `| ${name} | ${cell(value)} |`;

const repoLink = (repo: string): string => `[${repo}](https://github.com/${repo})`;

export const renderRunSummary = (record: OutcomeRecord): string => {
  const outcome = cell(describeOutcome(record.outcome));
  return [
    `## ${record.task}: ${outcome}`,
    "",
    "| | |",
    "|---|---|",
    row("Task", record.task),
    row("Item", record.item ? itemLink(record.targetRepo, record.item) : repoLink(record.targetRepo)),
    `| Outcome | ${outcome} |`,
    row("Turns", record.turns === undefined ? "none" : count(record.turns)),
    row("Time", duration(record.seconds)),
    row("Model", record.model ?? "none"),
    row("Tokens", record.tokens ? `${count(record.tokens.input)} in, ${count(record.tokens.output)} out` : "not reported"),
    row("Next label", record.nextLabel ? `\`${record.nextLabel}\`` : "none"),
    "",
  ].join("\n");
};
