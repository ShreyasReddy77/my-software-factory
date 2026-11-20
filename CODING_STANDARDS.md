# Coding Standards

The rules for the factory's own code: its workflows, Sandcastle scripts and prompts. A target repo's standards come from its ICM map, never from this file. Each `##` heading is a rule a review can cite.

## Name things in the glossary's language

Files, variables, labels and prose use the `software-factory` skill's terms and those in [GLOSSARY.md](GLOSSARY.md). A concept with no term gets one in GLOSSARY.md before it gets a name in code.

## Every workflow opens with its operator's manual

The header comment of each `.github/workflows/agent-*.yml` has three sections: `WHAT TRIGGERS IT`, `WHAT IT DOES`, `WHAT IT NEEDS` (secrets, labels, one-time setup commands). It is the single source of truth for operating that task, so a change to the trigger, tokens or setup updates it in the same commit.

## One label starts a task

A task's trigger is one `agent:<task>` label. The run removes it first, so re-applying it is the retry. It holds `agent:in-progress` while it runs, and on failure it sets `agent:blocked` and comments with how to retry.

## Tokens live on steps, never in the agent's reach

- `GH_TOKEN` is set on the steps that call GitHub, never on a job that runs repo or agent code.
- Checkouts use `persist-credentials: false`.
- The `permissions:` block shrinks `GITHUB_TOKEN` to what the checkout needs.
- The agent's step, and every step that runs code the agent wrote, has no GitHub token in its environment. The agent commits; a later host step pushes.
- `pull_request`, never `pull_request_target`, for anything that checks out PR code.

## Runs never collide or lose work

- Every job has a `concurrency` group keyed on the ticket or PR it works on, with `cancel-in-progress: false`. Labels that are not the trigger get a throwaway group.
- Every run pushes to a branch of its own, suffixed with the run id.
- Every job sets `timeout-minutes`.

## One folder per task

`.sandcastle/agent-workflows/<task>/` holds the task's script, its `prompt.md` beside it, and its `<name>-schema.ts` if it returns structured output. Code two tasks share lives in `shared/`. The agent and its model are chosen in one place: `shared/common.ts`.

## Structured output is a strict zod schema

Anything a workflow step reads from an agent is a `z.strictObject` from `zod/v4`, with `.describe()` on every field written as an instruction to the agent. It is produced with `runWithExtraction`, and written with `writeJson` to `OUTPUT_DIR`.

## Scripts are small ESM TypeScript

Top-level `await`, `node:`-prefixed imports, `import.meta.dirname` for paths next to the script. Read every env var through `required()` so a missing one fails at the top of the run. Mark option and result types `readonly`.

## Prompts state what to do

Prompts address the agent as "you", describe the target behaviour positively, and point at skills by path rather than restating them. Template variables are `{{UPPER_SNAKE}}`.

## Comments carry the why the code cannot

A comment explains a mechanism or a reason the code does not show, in as few lines as it takes. Workflow headers are the exception: they are full manuals. A product decision goes in an ADR under `docs/adr/`, not a comment.
