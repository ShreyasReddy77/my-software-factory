import type { z } from "zod/v4";
import { labels, triggerLabel } from "../shared/labels";
import { explorePlanSchema } from "./plan-schema";

export type ExplorePlan = z.infer<typeof explorePlanSchema>;

export type ApplyWrite = {
  readonly number: number;
  readonly comment: string;
  readonly addLabel?: string;
  readonly close: boolean;
};

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

// Every rule, written as what is wrong. An empty list means apply.
export const checkPlan = (raw: unknown, batch: readonly number[]): string[] => {
  const parsed = explorePlanSchema.safeParse(raw);
  if (!parsed.success) return [`The plan is not the shape the explore run promised: ${parsed.error.message}`];
  const plan = parsed.data.issues;
  const survivors = new Set(plan.filter((entry) => entry.duplicate_of === undefined).map((entry) => entry.number));
  return [
    ...(sameNumbers(plan.map((entry) => entry.number), batch)
      ? []
      : [`The plan needs exactly one entry for each of ${JSON.stringify([...batch].sort((x, y) => x - y))}.`]),
    ...plan.flatMap((entry) => (/\S/.test(entry.comment) ? [] : [`#${entry.number} has an empty comment.`])),
    ...plan.flatMap((entry) =>
      entry.duplicate_of === undefined || survivors.has(entry.duplicate_of)
        ? []
        : [`#${entry.number} is a duplicate of #${entry.duplicate_of}, which is not a surviving issue in this batch.`]
    ),
  ];
};

const nextStep = (entry: ExplorePlan["issues"][number]): Pick<ApplyWrite, "addLabel" | "close"> & { text: string } => {
  if (entry.duplicate_of !== undefined)
    return { text: `Closed as duplicate of #${entry.duplicate_of}.`, close: true };
  if (entry.tag === "easy-call")
    return {
      text: "Easy call. Handed to the implementer. Nobody is being asked first.",
      addLabel: triggerLabel("implement"),
      close: false,
    };
  return {
    text: `Stopped at \`${entry.tag}\`. Settle the open questions, then label \`${triggerLabel("implement")}\` yourself.`,
    addLabel: labels.needsAHuman,
    close: false,
  };
};

// Survivors first, so "closed as duplicate of #N" points at an issue that
// already has its findings on it.
export const planApply = (plan: ExplorePlan, runUrl: string): ApplyWrite[] =>
  [...plan.issues]
    .sort((a, b) => Number(a.duplicate_of !== undefined) - Number(b.duplicate_of !== undefined) || a.number - b.number)
    .map((entry) => {
      const { text, ...next } = nextStep(entry);
      return { number: entry.number, comment: `${entry.comment}\n\n---\n\n_${text}_ [Logs](${runUrl})\n`, ...next };
    });
