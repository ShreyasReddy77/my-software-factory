// The budget pause: what a Claude limit looks like in a failed agent run's
// error, and the words the factory uses for it. Pure: the caller passes the clock.

export type Pause =
  | { readonly kind: "usage limit"; readonly resetsAt?: string }
  | { readonly kind: "out of credit" };

export type PauseClassification = Pause | { readonly kind: "not a pause" };

const minute = 60_000;
const day = 24 * 60 * minute;

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
