import { z } from "zod/v4";

// The split's answer: one spec turned into an ordered queue of tickets.
// write-queue.ts creates one GitHub issue per entry, in `position` order, and
// each later `agent:implement-spec` label builds the next ready one.
export const specQueueSchema = z
  .strictObject({
    tickets: z
      .array(
        z.strictObject({
          position: z
            .number()
            .int()
            .min(1)
            .describe(
              "Build order, starting at 1. Each build takes the lowest open position whose dependencies are closed."
            ),
          title: z
            .string()
            .max(100)
            .describe(
              "The issue title. Say what the ticket delivers, not which layer it edits."
            ),
          body: z
            .string()
            .describe(
              "The ticket. Markdown, with a `## What` and a `## Done when` — the second is what the review workflow checks the pull request against, so it has to be checkable from a diff."
            ),
          depends_on: z
            .array(z.number().int().min(1))
            .describe(
              "Positions that must be finished first. Empty means it can be built the moment the queue opens — those are the ones that could run in parallel."
            ),
        })
      )
      .min(1)
      .max(12)
      .describe(
        "The queue, in build order. Keep it short. A queue longer than about eight is a spec that wanted splitting into two specs."
      ),
  })
  .describe("The spec, cut into an ordered queue of tickets.");
