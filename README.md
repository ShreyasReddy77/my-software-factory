# My Software Factory

One central place where GitHub Actions turns labelled tickets into draft pull
requests, with agents run by Sandcastle inside a `bwrap()` sandbox. In
Foundation the only target is this repository. The design lives in
[docs/factory-v1.md](docs/factory-v1.md); the words it uses are in
[GLOSSARY.md](GLOSSARY.md).

- [What needs you](#what-needs-you)
- [The workflows](#the-workflows)
- [One-time setup](#one-time-setup)
- [Releasing the factory](#releasing-the-factory)

## What needs you

There is no status issue and no dashboard. These searches are the view across
every target; GitHub shows private results only to a signed-in person with
access, so the links leak nothing. When a target outside
`ShreyasReddy77` is registered, add its owner as another `user:` or `org:`
qualifier.

| State | Search |
|---|---|
| Stopped for a human | [`factory:needs-human`](https://github.com/search?type=issues&q=is%3Aopen+user%3AShreyasReddy77+label%3Afactory%3Aneeds-human) and explore's [`needs-a-human`](https://github.com/search?type=issues&q=is%3Aopen+user%3AShreyasReddy77+label%3Aneeds-a-human) |
| A run failed; re-add the trigger label to retry | [`agent:blocked`](https://github.com/search?type=issues&q=is%3Aopen+user%3AShreyasReddy77+label%3Aagent%3Ablocked) |
| Waiting on a budget pause | [`factory:paused`](https://github.com/search?type=issues&q=is%3Aopen+user%3AShreyasReddy77+label%3Afactory%3Apaused) |
| Waiting for a budget slot or a lock | [`factory:queued`](https://github.com/search?type=issues&q=is%3Aopen+user%3AShreyasReddy77+label%3Afactory%3Aqueued) |
| Green and reviewed, waiting on you to merge | [`factory:ready-to-merge`](https://github.com/search?type=pullrequests&q=is%3Aopen+user%3AShreyasReddy77+label%3Afactory%3Aready-to-merge) |
| The factory's open draft PRs | [draft PRs from `agent/issue-` branches](https://github.com/search?type=pullrequests&q=is%3Aopen+is%3Adraft+user%3AShreyasReddy77+head%3Aagent%2Fissue-) |

**The budget gauge** is the [latest requeue run](https://github.com/ShreyasReddy77/my-software-factory/actions/workflows/requeue.yml):
its run summary shows today's agent runs against the daily cap, runs in flight
against concurrency, whether a budget pause is open and until when, and how
many items it restarted. The alarm is the budget-pause ticket, an open issue
titled "Claude usage paused until <time>", "Claude usage paused, reset time
unknown" or "Out of Claude credit". Close a
credit pause, or any pause with no reset time, yourself once Claude can be
used again; the requeue run closes timed pauses.

## The workflows

Each workflow's header comment is the source of truth for its trigger, tokens
and setup. An **entry file** holds only the trigger, permissions and a call to
a **reusable workflow**, at `@stable` on other repos and at `@main` on this one.
Every agent task is a **gate run** (no agent, a few seconds: budget, pause and
lock checks) that starts the task's **agent run**. The names follow one rule:
`agent-<task>.yml` is the label's entry file, `<task>-agent.yml` the agent
run's entry file (it takes `factory_ref` from the gate run), and every
reusable workflow ends in `-run.yml`. All jobs set the factory up with the
composite action `.github/actions/setup-factory`.

| Task | Started by | Entry files | Gate run | Agent run |
|---|---|---|---|---|
| Implement | `agent:implement` on an issue | `agent-implement.yml`, `implement-agent.yml` | `gate-run.yml` | `implement-agent-run.yml` |
| Implement-spec | `agent:implement-spec` on a spec issue: splits it into a queue, or builds the queue's next ready ticket | `agent-implement-spec.yml`, `implement-spec-agent.yml` | `gate-run.yml` (with `implement-spec/gate-run.ts`) | `implement-spec-agent-run.yml` |
| Review | `agent:review` on a factory PR | `agent-review.yml`, `review-agent.yml` | `gate-run.yml` | `review-agent-run.yml` |
| Explore | `agent:explore` on an issue (one batch per repo) | `agent-explore.yml`, `explore-agent.yml` | `gate-run.yml` | `explore-agent-run.yml` |
| Requeue run | hourly, the end of every agent run, or Run workflow | `requeue.yml` | none: no agent, never counts against the budget | `requeue-run.yml` (`@main` only) |

The first entry file of each task is its operator's manual. Scripts and
prompts live in `.sandcastle/agent-workflows/<task>/`; plan settings (models,
credential, caps, ceilings, priority) live only in [budget.yml](budget.yml),
always read from `main`.

## One-time setup

From a fresh clone of this repository, with `gh` signed in as its owner.

1. **Create the GitHub App** (Settings → Developer settings → GitHub Apps →
   New GitHub App). Untick Webhook. Repository permissions, exactly these:

   | Permission | Access | Used for |
   |---|---|---|
   | Metadata | read | required; checking a person's write access |
   | Contents | read and write | the push step's branch pushes |
   | Issues | read and write | labels, comments, the budget-pause ticket |
   | Pull requests | read and write | opening draft PRs, review comments, the requeue run's PR labels |
   | Actions | read and write | counting runs; the gate run starting the agent run and every agent run starting the requeue run |
   | Checks | read and write | not used yet: `factory/checks` (PR loop) |
   | Commit statuses | read | not used yet: reading CI (PR loop) |

   Never grant Workflows, Administration, Secrets, Variables or any
   organisation permission. Without Workflows the App cannot push a change
   under `.github/workflows/`, so no factory change can widen its own reach.
2. **Install the App** on this repository only (Install App → Only select
   repositories).
3. **Add the App's ID and key.** Copy the App ID from its settings page, then
   generate a private key (it downloads a `.pem` file):

   ```sh
   gh variable set FACTORY_APP_ID --body "<the App ID>"
   gh secret set FACTORY_APP_PRIVATE_KEY < path/to/the-key.pem
   ```

   Delete the downloaded `.pem` afterwards. The runs work the App's slug out
   from its token, so it needs no setting.
4. **Add the Claude token.** For a subscription, run `claude setup-token` and
   keep `credential: subscription` in `budget.yml`; for an API key, set
   `credential: api-key`. Either way the secret's name is the same:

   ```sh
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   ```

   Make it a token for the factory alone, so revoking it never touches your
   own Claude use.
5. **Create the labels.** Implement-spec creates each `spec:<n>` label
   itself.

   ```sh
   gh label create "agent:implement" --color 5319E7 --description "Hand this issue to the implementer agent"
   gh label create "agent:review" --color 5319E7 --description "Ask the review workflow to read this pull request"
   gh label create "agent:explore" --color 5319E7 --description "Explore this issue in the next batch"
   gh label create "agent:implement-spec" --color 5319E7 --description "Split this spec into a queue, or build its next ticket"
   gh label create "agent:in-progress" --color FBCA04 --description "An agent is working on this right now"
   gh label create "agent:blocked" --color B60205 --description "An agent run failed here. Its comment says how to retry"
   gh label create "factory:queued" --color C5DEF5 --description "Waiting for a budget slot or a lock; the requeue run restarts it"
   gh label create "factory:paused" --color C5DEF5 --description "Waiting on a budget pause; the requeue run restarts it"
   gh label create "factory:needs-human" --color D93F0B --description "Stopped for a human, with a reason"
   gh label create "needs-a-human" --color D93F0B --description "Explore stopped here for a human"
   gh label create "factory:ready-to-merge" --color 0E8A16 --description "Green and reviewed, waiting on the human"
   ```

6. **Create the first `stable` release, before any run.** Every entry file
   names its reusable workflow at `@stable` as well as `@main`, and GitHub
   resolves every called workflow before a run starts, so a missing tag
   fails the run even here, where only the `@main` job runs. Cut it from `main` as
   [Releasing the factory](#releasing-the-factory) says, with "First release"
   as its notes, and skip that procedure's check (there is no earlier release
   to compare with).
7. **Try it.** Run the requeue run once (`gh workflow run requeue.yml`) and
   read its run summary: it shows the budget gauge with nothing restarted.
   Then label a small issue `agent:implement` and follow its gate run and
   agent run in the Actions tab.

## Releasing the factory

Other repos run the factory's code from the `stable` tag; this repository
runs `main`. Settings (`budget.yml`, `targets/`) always come from `main` and
are never released. A run pins one factory commit when it starts, so moving
`stable` changes only runs that start afterwards.

**Each release must read everything the previous one wrote:** labels, hidden
marker comments, run names (lock keys), try counts and file shapes. A change
to one of those formats reads both forms until the old one is gone.

1. **List what changed** since the last release:

   ```sh
   git fetch origin --tags
   git log --oneline stable..origin/main
   ```

2. **Decide whether it is rollback-safe.** If any change alters a state
   format (a label's name or meaning, a marker comment, a run name, a file's
   shape), the release is not rollback-safe, and its notes say so on their
   own line: `not rollback-safe: <what changed>`.
3. **Cut a dated release** from `main`, listing what changed:

   ```sh
   gh release create stable-2026-11-20 --target main --title "stable-2026-11-20" --notes-file notes.md
   ```

   A second release on the same day adds a suffix: `stable-2026-11-20.2`.
4. **Move `stable`** to it, by hand. Nothing in the factory ever moves it.

   ```sh
   git fetch origin --tags
   git tag -f stable "stable-2026-11-20^{commit}"
   git push -f origin stable
   ```

5. **Check that the move took.** Run a workflow at `@stable` before and
   after moving the tag, and confirm the second run ran the new code:

   ```sh
   gh workflow run requeue.yml --ref stable     # before step 4
   # ...once that run has finished, move stable (step 4), then:
   gh workflow run requeue.yml --ref stable
   gh run list --workflow requeue.yml --limit 2 --json headSha,createdAt
   ```

   The newer run's `headSha` must be the new release's commit
   (`git rev-parse "stable-2026-11-20^{commit}"`) and the older one the
   previous release's. If not, the tag didn't move: fix it before anything
   else runs.

**Rolling back** is step 4 with the previous release's name: move `stable`
back to it. If a release you roll back past says "not rollback-safe", the
older code can't read what it wrote: find the affected items (the searches in
[What needs you](#what-needs-you)) and re-label them by hand.
