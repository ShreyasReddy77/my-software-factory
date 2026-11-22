export type ItemRef = { readonly kind: "issue" | "pr"; readonly number: number };

export type Outcome =
  | { readonly kind: "done" | "queued" | "paused" | "ceiling hit" }
  | { readonly kind: "stopped"; readonly reason: string }
  | { readonly kind: "failed try"; readonly try: number; readonly of: number };

export type BudgetGauge = {
  readonly todaysRuns: number;
  readonly dailyRuns: number;
  readonly runsInFlight: number;
  readonly concurrentRuns: number;
  readonly budgetPause: { readonly open: false } | { readonly open: true; readonly until?: Date };
  readonly restarted: number;
};

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
  readonly gauge?: BudgetGauge;
};

const count = (n: number): string => n.toLocaleString("en-US");

const itemLink = (repo: string, item: ItemRef): string =>
  `[${repo}#${item.number}](https://github.com/${repo}/${item.kind === "pr" ? "pull" : "issues"}/${item.number})`;

const repoLink = (repo: string): string => `[${repo}](https://github.com/${repo})`;

const duration = (seconds: number): string => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const utcMinute = (time: Date): string => `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;

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

const describePause = (pause: BudgetGauge["budgetPause"]): string => {
  if (!pause.open) return "closed";
  return pause.until ? `open until ${utcMinute(pause.until)}` : "open, no reset time";
};

const cell = (value: string): string => value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

const table = (rows: readonly (readonly [string, string])[]): string[] => [
  "| | |",
  "|---|---|",
  ...rows.map(([name, value]) => `| ${name} | ${cell(value)} |`),
  "",
];

const gaugeSection = (gauge: BudgetGauge): string[] => [
  "### Budget gauge",
  "",
  ...table([
    ["Today's agent runs", `${count(gauge.todaysRuns)} of ${count(gauge.dailyRuns)}`],
    ["Runs in flight", `${count(gauge.runsInFlight)} of ${count(gauge.concurrentRuns)}`],
    ["Budget pause", describePause(gauge.budgetPause)],
    ["Items restarted", count(gauge.restarted)],
  ]),
];

export const renderRunSummary = (record: OutcomeRecord): string => {
  const outcome = describeOutcome(record.outcome);
  const tokens = record.tokens
    ? `${count(record.tokens.input)} in, ${count(record.tokens.output)} out`
    : "not reported";
  return [
    `## ${record.task}: ${cell(outcome)}`,
    "",
    ...table([
      ["Task", record.task],
      ["Item", record.item ? itemLink(record.targetRepo, record.item) : repoLink(record.targetRepo)],
      ["Outcome", outcome],
      ["Turns", record.turns === undefined ? "none" : count(record.turns)],
      ["Time", duration(record.seconds)],
      ["Model", record.model ?? "none"],
      ["Tokens", tokens],
      ["Next label", record.nextLabel ? `\`${record.nextLabel}\`` : "none"],
    ]),
    ...(record.gauge ? gaugeSection(record.gauge) : []),
  ].join("\n");
};
