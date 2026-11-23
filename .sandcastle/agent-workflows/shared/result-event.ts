import { z } from "zod/v4";

export type RunUsage = {
  readonly turns?: number;
  readonly tokens?: { readonly input: number; readonly output: number };
};

const tokenCount = z.number().int().nonnegative();

const resultEvent = z.object({
  type: z.literal("result"),
  num_turns: tokenCount.optional(),
  usage: z
    .object({
      input_tokens: tokenCount,
      cache_creation_input_tokens: tokenCount.default(0),
      cache_read_input_tokens: tokenCount.default(0),
      output_tokens: tokenCount,
    })
    .optional(),
});

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

// Turns and run totals come only from the last line Claude Code prints in
// stream-json mode; Sandcastle's own usage covers the last message alone.
export const readResultEvent = (line: string): RunUsage | undefined => {
  const parsed = resultEvent.safeParse(parseJson(line));
  if (!parsed.success) return undefined;
  const { num_turns: turns, usage } = parsed.data;
  return {
    ...(turns === undefined ? {} : { turns }),
    ...(usage === undefined
      ? {}
      : {
          tokens: {
            input: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
            output: usage.output_tokens,
          },
        }),
  };
};
