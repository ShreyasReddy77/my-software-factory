// The budget pause: what a Claude limit looks like in a failed agent run's
// error, the words the factory reports it in, and the one budget-pause ticket.
// Pure: the caller passes the clock and the factory's open issues.
import { labels } from "./labels";

export type Pause =
  | { readonly kind: "usage limit"; readonly resetsAt?: string }
  | { readonly kind: "out of credit" };

export type PauseClassification = Pause | { readonly kind: "not a pause" };

const day = 24 * 60 * 60_000;

const usageLimit = /You've hit your [\w-]+ limit(?:\s*·\s*resets\s+([^\n.]+))?/i;
// Out of API credit or over a spend limit: Claude fails at once and names no
// reset the factory can wait for.
const outOfCredit = /credit balance is too low|specified API usage limits|spend limit|out of (?:usage )?credits/i;
const resetTime = /^(?:(sun|mon|tue|wed|thu|fri|sat)\w*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The reset shows a clock time, perhaps after a weekday, with no date and no
// zone ("3:45pm", "Mon 12:00am"); the runner is on UTC, so it is the next time
// the UTC clock reads that.
const nextOccurrence = (text: string, now: Date): string | undefined => {
  const match = resetTime.exec(text.trim());
  if (!match) return undefined;
  const [, weekday, hours, minutes = "0", half] = match;
  const hour = (Number(hours) % 12) + (half!.toLowerCase() === "pm" ? 12 : 0);
  const sameDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, Number(minutes));
  if (weekday === undefined) return new Date(sameDay > now.getTime() ? sameDay : sameDay + day).toISOString();
  const daysAhead = (weekdays.indexOf(weekday.toLowerCase()) - now.getUTCDay() + 7) % 7;
  const reset = sameDay + daysAhead * day;
  return new Date(reset > now.getTime() ? reset : reset + 7 * day).toISOString();
};

export const classifyPause = (errorText: string, now: Date): PauseClassification => {
  const usage = usageLimit.exec(errorText);
  if (usage) {
    const resetsAt = usage[1] === undefined ? undefined : nextOccurrence(usage[1], now);
    return { kind: "usage limit", ...(resetsAt === undefined ? {} : { resetsAt }) };
  }
  if (outOfCredit.test(errorText)) return { kind: "out of credit" };
  return { kind: "not a pause" };
};

const utcMinute = (iso: string): string => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const resetOf = (pause: Pause): string | undefined => (pause.kind === "usage limit" ? pause.resetsAt : undefined);

export const pauseTitle = (pause: Pause): string => {
  if (pause.kind === "out of credit") return "Out of Claude credit";
  const resetsAt = resetOf(pause);
  return resetsAt === undefined ? "Claude usage paused, reset time unknown" : `Claude usage paused until ${utcMinute(resetsAt)}`;
};

export const pauseItemText = (pause: Pause): string => {
  if (pause.kind === "out of credit") return "Paused: out of Claude credit, no reset time";
  const resetsAt = resetOf(pause);
  return resetsAt === undefined ? "Paused: usage limit, reset time unknown" : `Paused: usage limit, resets at ${utcMinute(resetsAt)}`;
};

// The ticket's body carries its reset in a hidden marker, so reading it back
// never parses the title. A release that changes the form keeps reading v1.
const pauseMarker = (pause: Pause): string => `<!-- factory:budget-pause v1 until=${resetOf(pause) ?? "none"} -->`;
const pauseMarkerForm = /<!-- factory:budget-pause v1 until=(\S+) -->/;

export const pauseTicketBody = (pause: Pause): string =>
  [
    `A factory run hit a Claude limit. ${pauseItemText(pause)}.`,
    "",
    `While this ticket is open, every gate run pauses its item, labelled \`${labels.paused}\`, without calling Claude. A pause is not a try.`,
    "",
    resetOf(pause) === undefined
      ? "Close this ticket once Claude can be used again (for credit, after topping up); the requeue run then restarts paused work."
      : "The requeue run closes this ticket once the reset has passed, then restarts paused work.",
    "",
    pauseMarker(pause),
  ].join("\n");

export type FactoryIssue = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly user: { readonly login: string } | null;
  readonly pull_request?: unknown;
};

export type BudgetPauseState =
  | { readonly open: false }
  | { readonly open: true; readonly ticket: number; readonly until?: Date };

export type PausedItem = { readonly repo: string; readonly number: number; readonly runUrl: string };

export type BudgetPauseTicketAction =
  | { readonly kind: "open ticket"; readonly title: string; readonly body: string }
  | { readonly kind: "update ticket"; readonly ticket: number; readonly title: string; readonly body: string }
  | { readonly kind: "comment on ticket"; readonly ticket: number; readonly body: string };

// An open pause with no reset outlasts every timed one.
const outlasts = (pause: Pause, until: Date | undefined): boolean => {
  if (until === undefined) return false;
  const resetsAt = resetOf(pause);
  return resetsAt === undefined || Date.parse(resetsAt) > until.getTime();
};

// The first pause opens the one ticket; later ones comment on it, and move
// its reset only ever later, so the requeue run never closes it too early.
export const planBudgetPauseTicket = (
  pause: Pause,
  current: BudgetPauseState,
  item: PausedItem
): BudgetPauseTicketAction[] => {
  if (!current.open) return [{ kind: "open ticket", title: pauseTitle(pause), body: pauseTicketBody(pause) }];
  const comment: BudgetPauseTicketAction = {
    kind: "comment on ticket",
    ticket: current.ticket,
    body: `${pauseItemText(pause)}: ${item.repo}#${item.number} ([run](${item.runUrl})).`,
  };
  return outlasts(pause, current.until)
    ? [{ kind: "update ticket", ticket: current.ticket, title: pauseTitle(pause), body: pauseTicketBody(pause) }, comment]
    : [comment];
};

// Only the factory's App opens the ticket, so a look-alike from anyone else
// can't pause the factory.
export const readBudgetPause = (openIssues: readonly FactoryIssue[], factoryAppLogin: string): BudgetPauseState => {
  const ticket = openIssues
    .filter((issue) => issue.pull_request === undefined && issue.user?.login === factoryAppLogin)
    .flatMap((issue) => {
      const until = pauseMarkerForm.exec(issue.body ?? "")?.[1];
      return until === undefined ? [] : [{ number: issue.number, until }];
    })
    .sort((a, b) => a.number - b.number)[0];
  if (ticket === undefined) return { open: false };
  return { open: true, ticket: ticket.number, ...(ticket.until === "none" ? {} : { until: new Date(ticket.until) }) };
};
