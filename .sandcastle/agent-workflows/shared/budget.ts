import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod/v4";
import { agentTasks, type AgentTask } from "./tasks";

export const budgetPath = path.join(import.meta.dirname, "../../../budget.yml");

const credentials = ["subscription", "api-key"] as const;
export type Credential = (typeof credentials)[number];

export type TaskBudget = {
  readonly model: string;
  readonly maxTurns: number;
  readonly agentMinutes: number;
};

export type Budget = {
  readonly credential: Credential;
  readonly dailyRuns: number;
  readonly concurrentRuns: number;
  readonly priority: readonly (readonly string[])[];
  readonly tasks: Readonly<Record<AgentTask, TaskBudget>>;
};

const fullModelId =
  /^claude-(?:[a-z]+-\d+(?:-\d+)*|\d+(?:-\d+)*-[a-z]+)(?:-\d{8})?$/;

const modelProblem = (model: string): string | undefined => {
  if (/fable/i.test(model)) return "is a Fable model, which the factory never uses";
  if (!fullModelId.test(model) || model.endsWith("-latest"))
    return "is not a full model ID (aliases are refused)";
  return undefined;
};

const count = z.number().int().positive();
const taskName = z.string().regex(/^[a-z][a-z-]*$/);

const budgetFile = z
  .strictObject({
    credential: z.enum(credentials),
    daily_runs: count,
    concurrent_runs: count,
    priority: z.array(z.array(taskName).nonempty()).nonempty(),
    tasks: z.record(
      taskName,
      z.strictObject({
        model: z.string(),
        max_turns: count,
        agent_minutes: count,
      })
    ),
  })
  .superRefine((file, ctx) => {
    for (const task of agentTasks) {
      if (!(task in file.tasks))
        ctx.addIssue({ code: "custom", path: ["tasks"], message: `${task} is missing from tasks:` });
    }
    for (const [task, { model }] of Object.entries(file.tasks)) {
      const problem = modelProblem(model);
      if (problem)
        ctx.addIssue({
          code: "custom",
          path: ["tasks", task, "model"],
          message: `${task}'s model ${JSON.stringify(model)} ${problem}`,
        });
    }
  });

const toTaskBudget = (line: z.infer<typeof budgetFile>["tasks"][string]): TaskBudget => ({
  model: line.model,
  maxTurns: line.max_turns,
  agentMinutes: line.agent_minutes,
});

export const parseBudget = (text: string): Budget => {
  const result = budgetFile.safeParse(parseYaml(text));
  if (!result.success)
    throw new Error(`budget.yml is invalid:\n${z.prettifyError(result.error)}`);
  const file = result.data;
  const tasks = Object.fromEntries(
    agentTasks.map((task) => [task, toTaskBudget(file.tasks[task]!)])
  ) as Record<AgentTask, TaskBudget>;
  return {
    credential: file.credential,
    dailyRuns: file.daily_runs,
    concurrentRuns: file.concurrent_runs,
    priority: file.priority,
    tasks,
  };
};

export const loadBudget = (file: string = budgetPath): Budget =>
  parseBudget(fs.readFileSync(file, "utf8"));
