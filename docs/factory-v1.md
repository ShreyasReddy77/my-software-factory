# Factory v1: design digest

This is the single source for the five v1 specs (Foundation, Targets, PR loop, Trust ladder, Upstream). It holds the final form of every decision on the map [Design a central software factory for any GitHub codebase][map], with every later amendment folded in and its source named. A spec session reads its own section under [The five specs](#the-five-specs), plus [GLOSSARY.md](../GLOSSARY.md) and the v0 workflow headers in `.github/workflows/`.

The digest stays the source of truth while the factory is built: a phase that changes a decision updates this file in the same PR ([Spec handoff]). Where two tickets disagree, or a question was never answered, this file says so under [Gaps](#gaps) instead of choosing.

Terms come from the `software-factory` skill (task, trigger, run, runner, ticket tracker, ticket source, git host, orchestrator, observability platform) and GLOSSARY.md. Two words need care, because GLOSSARY.md gives them a narrower meaning than everyday Actions talk:

- **Step** is a step of the trust ladder ("step 2"). A step in an Actions job is called a **host step**.
- **Ceiling** is a run's turn and time limit. The highest step a change kind may reach is called its **highest step**.

## Contents

1. [Services](#services)
2. [Cross-cutting rules](#cross-cutting-rules)
3. [Labels, files and state](#labels-files-and-state)
4. [The five answers for every task](#the-five-answers-for-every-task)
5. [Ticket sources and the factory's own tickets](#ticket-sources-and-the-factorys-own-tickets)
6. [The five specs](#the-five-specs)
7. [Check](#check)
8. [Gaps](#gaps)
9. [Out of scope](#out-of-scope)
10. [Sources](#sources)

## Services

Every slot of the `software-factory` skill, with its product.

| Slot | Product | Notes |
|---|---|---|
| **Ticket tracker** | GitHub Issues | On each owned repo (its own tickets), the factory (public targets, upstream work, budget pause), and the companion (private targets, self-improvement). |
| **Ticket source** | None in v1 | A tool may open issues, but they are ordinary issues until a trusted person labels them ([Ticket sources]). |
| **Git host** | GitHub | The only one; other git hosts are out of scope. |
| **Orchestrator** | GitHub Actions | In the factory (public, free minutes) and the companion (private, paid minutes). State lives in labels, hidden marker comments and files on `main`, never on a runner. |
| **Runner** | GitHub-hosted `ubuntu-24.04` | Pinned, not `ubuntu-latest` ([Sandcastle on Actions]). Agents run inside a Sandcastle `bwrap()` sandbox on it ([Security model], [Sandbox timing]). |
| **Observability platform** | Deliberate none | Each run's run summary and log on its Actions run page, saved search links in the README, and the requeue run's summary as the budget gauge ([Observability]). |

Products the tasks build on, below the slots:

| Need | Product | Source |
|---|---|---|
| Agent | Claude Code, launched by Sandcastle | v0 |
| Models | `claude-opus-5-5` (implement, implement-spec, review, fix-CI, address-review); `claude-sonnet-5-5` (explore, map, lesson draft). Full IDs, never aliases. Never Fable. | [Budget], [Merge and watch] |
| Claude credential | A subscription OAuth token or an API key, chosen in `budget.yml` | [Budget] |
| Credential relay | The factory's own ~80-line Node relay, no dependencies | [Credential relay] |
| GitHub credentials | One GitHub App (per-step tokens), plus one shim token per owned repo | [Security model] |
| Secret scan in the push step | gitleaks, pinned to an exact version and run on the agent's new commits only, plus a search for the Claude token by its hash | [Security model], Foundation session |

## Cross-cutting rules

Each rule holds for every task unless the task's section says otherwise.

### Where things live

- **One central factory.** This repo runs every task. An owned repo carries at most a shim; an upstream repo carries nothing. *Why:* one place to change, and no factory code in strangers' repos. ([map] Notes)
- **ICM maps live in the factory, never in the target repo,** under `targets/<owner>/<repo>/`. *Why:* the map is the factory's view, and an upstream repo must not carry it. ([map] Notes)
- **Anything about a private target lives only in the companion,** a private repo created once at factory setup with the same `targets/` layout. It calls the factory's reusable workflows, holds its own copies of the App key and Claude token, and runs everything about private targets: maps, runs, logs, the daily watch for them, and the weekly self-improvement run with its tickets. *Why:* run logs and evidence quote code, and the factory is public; making the whole factory private would cost paid minutes and its shareability. ([Private maps], amending [Self-improvement])
- **One budget for both repos,** kept in the factory. The budget files hold nothing private. ([Private maps])

### Who and what reaches the agent

- **Only a trusted author's words reach an agent.** A trusted author is a person with write access to the target repo, or the factory's own App. Other bots and apps never count, even with write access. Text from anyone else is dropped, and the agent is told how many comments were left out. *Why:* prompt injection in tickets and comments is the main way in. ([Security model], [Ticket sources])
- **A label vouches for the issue as it stood.** When a trusted author adds `agent:implement` or `agent:explore`, the issue's title and body as they stood at that moment reach the agent, whoever wrote them. A later edit is ignored in favour of that version, and the run says so. Strangers' comments are still dropped. ([Explore], amending [Implement])
- **Upstream exception:** upstream address-review reads the maintainers' public review comments, but only those present when the user applied the label. ([Security model])
- **A label is checked in the run.** A shim's dispatch is never believed: the factory re-reads the issue or PR with its own App token and ends quietly unless the label is really there and a trusted author applied it. ([Security model])
- **Only a person's label or one of the factory's three clocks starts work.** The clocks are the requeue run (hourly, in the factory), the watch (daily, in the factory and the companion) and the self-improvement run (weekly, in the companion); nothing else runs on a schedule. No chain of runs starts from an issue being filed. The factory's own tickets (lesson, self-improvement, budget pause, move, register, re-map) obey this: the run that files or adds to a lesson ticket starts the lesson-draft run directly, never through an "issue opened" trigger, so a person filing a lookalike issue starts nothing. ([Ticket sources], [Requeue run], Foundation session)
- **Factory tasks touch only the factory's own PRs.** Review, fix-CI, address-review and merge act only on PRs that implement (or the map run) opened. To get the factory working on a bot's or a person's PR, file a ticket and label it. ([Ticket sources])

### Credentials and the sandbox

- **Credentials the factory holds** ([Security model], [Credential relay], [Private maps]):

  | Credential | Lives in | Can do |
  |---|---|---|
  | GitHub App private key | A secret in the factory and one in the companion, read only by the host steps that mint tokens | Mints a token per host step: one repo, that host step's permissions, expires within the hour (`actions/create-github-app-token`). Installed on owned repos, the user's forks, the factory and the companion. **Never granted Workflows permission** (full list below). |
  | Claude token | A secret in the factory and one in the companion, read only by the relay's host step | Factory-only (revoking it never touches the user's own Claude use), spending-capped where the plan allows, rotated every few months, revoked on odd usage. |
  | Shim token | A secret in each owned repo | Fine-grained, on the factory (or the companion) only, **Actions: write** only: it can start factory workflows and nothing else. |

  v0's personal access token is retired: nothing in the factory holds one. (Foundation)
- **The App's full permission set** (repository permissions; each token asks only for what its host step needs) (Foundation session):

  | Permission | For |
  |---|---|
  | Metadata: read | required by GitHub; checking whether a person has write access |
  | Contents: read/write | branches, pushes, `trust.yml` commits, merges |
  | Issues: read/write | labels, comments, the factory's own tickets |
  | Pull requests: read/write | opening, marking ready, review comments, merging |
  | Actions: read/write | listing and counting runs, starting runs (gate run → agent run, the requeue runs), re-running checks |
  | Checks: read/write | posting `factory/checks`; reading the target's CI |
  | Commit statuses: read | reading CI that reports as commit statuses |
  | **Never** | Workflows, Administration, Secrets, Variables, or any organisation permission |

- **What the factory does inside the companion,** with an App token scoped to it: counts its runs and its waiting items (numbers only, never titles), starts its requeue run, and files or comments on move tickets. The other way, companion runs read the factory's `budget.yml`, comment on the factory's budget-pause ticket (which says nothing private), and start the factory's requeue run when one of their agent runs finishes. (Foundation session, amending [Requeue run])
- **The agent runs under `bwrap()` with no GitHub credential anywhere it can read.** The checkout uses `persist-credentials: false`, and the host step that launches Sandcastle carries no secret at all, because `/proc/1/environ` exposes that host step's environment inside `bwrap()`. *Why:* the [Sandbox timing] spike read both leaks. `bwrap()` costs 5–17 s of setup per run against `docker()`'s ~50 s warm or ~2 min cold.
- **The Claude token stays behind a relay.** A relay started in an earlier, separate host step receives the real token on stdin and forwards `POST /v1/messages`. The agent gets `ANTHROPIC_BASE_URL` pointing at it and a useless stand-in token. The relay passes on only the credential `budget.yml` names. *Why:* the [Credential relay] test found the real token nowhere in the sandbox. The agent can still spend the token while the run lasts, so the budget's caps remain the guard. The token-inside fallback is dropped. ([Security model], amended by [Credential relay])
- **Keep `ANTHROPIC_API_KEY` unset** wherever a subscription token is in use: it silently outranks the OAuth token. ([Claude Pro limits])
- **The push step guards every push.** On the host, before pushing, it scans the agent's new commits for secrets (the Claude token, found by hashing every `sk-ant-` string and comparing with the hash the relay's host step gives it, so the push step never holds the token; gitleaks; and, once private targets exist, their names; *see [Gaps](#gaps) G5*) and for any change under `.github/workflows/`. If either trips, it pushes nothing, comments, and counts a failed try. Otherwise it pushes and opens or updates the PR with an App token. ([Security model], [Private maps]) Fix-CI's push step also refuses commits that remove a test or add a skip ([Fix-CI and address-review]).
- **The factory never changes `.github/workflows/` on any repo,** its own included. A ticket that needs one goes back to the human. *Why:* the App has no Workflows permission, so no factory change can widen its own reach. ([Security model], [Self-improvement])
- **A target's own Claude settings:** owned repos obey `.claude/settings.json`, hooks included. Upstream repos' settings are ignored (hooks, permission changes, extra tools); their style is still enforced through the checks and the ICM map. Everywhere, the target's `CLAUDE.md` is obeyed or ignored section by section, as the ICM map says. ([Security model], [ICM map prototype])
- **Accepted for v1:** egress stays open, and upstream checks run strangers' code inside the sandbox. The planned upgrade is a paid microVM sandbox, so the sandbox provider is a single setting. ([Security model])
- **Never use `pull_request_target`** for anything that checks out PR code. ([Cross-repo Actions], v0)

### Budget

- **`budget.yml` at the factory root is the only place plan settings live:** the credential (`subscription` or `api-key`), the model per task, the daily run cap, concurrency, the priority order, and the ceilings per task. Target repos cannot override it. Tasks never hard-code a model or a credential. Moving from Pro to Max means regenerating one secret. *Why:* the factory must run on any Claude plan. ([Budget])
- **Starting values:** on Pro, concurrency 1 and 8 runs a day, tuned against `/usage`; Max is roughly ×5. ([Budget])
- **`budget.yml`'s shape** (Foundation session):

  ```yaml
  credential: subscription        # or api-key
  daily_runs: 8
  concurrent_runs: 1
  priority:                       # finish before start; oldest first within a group
    - [merge]
    - [fix-ci, address-review]
    - [review]
    - [implement, implement-spec]
    - [explore, map, lesson-draft, self-improvement]
  tasks:
    implement: { model: claude-opus-5-5, max_turns: 80, agent_minutes: 45 }
    # ...one line per agent task
  ```

  Loading it refuses an agent task missing from `tasks:`, and a model that is an alias or a Fable model.
- **Ceilings,** one per agent task in `budget.yml` so each can be tuned alone. Starting values: implement, fix-CI and address-review 80 turns and 45 minutes; map, implement-spec's split and self-improvement 50 turns and 30 minutes; review, explore and lesson-draft 30 turns and 15 minutes. A run that hits one pushes its work as a draft, comments, and counts as a failed try. Implement-spec's line in `budget.yml` is its split's; where implement-spec builds a queue ticket (Foundation, until the PR loop), the build uses implement's line. *See [Gaps](#gaps) G3.* ([Budget], Foundation session)
- **Two time limits.** `agent_minutes` is the agent's limit, enforced by Sandcastle, so the run still has time to scan and push. The Actions job's `timeout-minutes` is `agent_minutes` plus 15, covering setup, the scan and the push; if that one fires, something hung, and it counts as a crash (a failed try). (Foundation session)
- **Models of the two extra runs:** the lesson-draft run and the weekly self-improvement run are both agent runs on Sonnet. (Foundation session)
- **Priority when budget is short: finish before start.** Merge, then fix-CI and address-review, then review, then implement and implement-spec, then explore, map, lesson-draft and self-improvement; oldest first within each. The order is a list in `budget.yml`. ([Budget], Foundation session)
- **A run never waits for budget.** Hitting a subscription's 5-hour or weekly limit: the run fails fast, comments "Paused: usage limit, resets at <time>", labels the item `factory:paused`. Out of API credit or over a spend limit (an error with no reset time): the same, with no reset time. A usage limit whose error names no reset time is treated like credit: a pause only a human closes. A pause is not a try. ([Budget], Foundation session)
- **One budget-pause ticket** in the factory, "Claude usage paused until <time>" or "Out of Claude credit"; a usage limit that names no reset is titled "Claude usage paused, reset time unknown", since it is closed like a credit pause and must not promise a time. The first run that hits a limit opens it or comments on it. **Every run checks it right after the trigger label**, before setting up the sandbox, and pauses its item without calling Claude while it is open. The requeue run closes a timed pause once its reset has passed; the human closes a credit pause after topping up, and any pause with no reset time. Companion runs check the same ticket. ([Budget], [Private maps])
- **Caps are enforced by the factory,** not by Actions `concurrency:` groups. The pre-run gates count in-flight runs and today's runs across both repos; when either is full the item is labelled `factory:queued` and the run ends. `target.yml`'s optional `max_runs_per_day` limits one repo's share of the daily cap. ([Budget], [Registration], [Merge and watch])
- **Only agent runs count.** The daily cap and the concurrency limit count only runs that call Claude; an explore batch is one. Register, move, merge, the watch, the requeue run and gate runs spend no budget, so they never count, and merge skips the budget gates. "Today" starts at midnight UTC. (Foundation session)
- **A gate run starts the agent run.** Every agent task is two Actions runs: a short **gate run** passes the pre-run gates and claims the item, then starts the task's **agent run** (by `workflow_dispatch`, passing the pinned factory commit). Today's runs are the agent runs created since midnight UTC, and runs in flight are the agent runs still queued or running: one list call per repo, with no per-run lookups. (Foundation session)
- **A clock run with no slot.** The lesson-draft run has a ticket, so it queues like any other item. The weekly self-improvement run has no item: with no slot it skips the week and says so in its run summary. Its window is "since the last self-improvement run that finished", so a skip loses nothing. (Foundation session)

### The pre-run gates

Every agent run passes these in order before any agent work, and a run that fails one ends without touching the repo's code ([Implement], [Registration]):

1. **Trigger label:** the label must really be there, applied by a trusted author or the factory's App; otherwise the run ends quietly, labelling nothing. *Why first:* pausing an untrusted label would let the requeue run re-add it under the App's name and launder its trust. The check calls no Claude. (Foundation session)
2. **Budget pause** open → `factory:paused`.
3. **`enabled: false`** in `target.yml` → the item pauses (`factory:paused`) rather than being lost.
4. **Visibility:** the repo's real visibility must match where it is registered. A mismatch stops the run, writes nothing about the repo's code, and files (or comments on) a move ticket in the companion. Until the move finishes, every run on the repo refuses.
5. **Daily cap and concurrency** full → `factory:queued`.
6. **Lock** held by an earlier run → `factory:queued` ([below](#locks-tries-and-claims)).
7. **Confirmed checks:** implement-type runs refuse a repo whose first map has not merged.
8. **Trusted text only:** strangers' text is dropped, with a count, under the vouching rule above.

**Known limit, accepted:** two gate runs on different items can both pass the daily-cap and concurrency check before either agent run exists, so the factory can briefly run one over the limit. (Foundation session)

Upstream runs add the policy check first ([Upstream flow]), and `agent:upstream` runs also check the map for drift ([Map freshness]).

### Locks, tries and claims

- **Claim:** a run swaps its trigger label for `agent:in-progress` before agent work. ([Implement], v0)
- **A lock queues, it never drops.** An Actions `concurrency` group keeps one waiting run and cancels the rest, which would strand a third run's label with nothing running. So locks are built from run names instead: every run puts its lock key in its run name (e.g. `[pr owner/repo#5] review`), and at its gate lists the runs in progress in that repo's side (factory or companion). If an **earlier** run holds the same key, this run labels its item `factory:queued` and ends, as on a full budget, and the requeue run restarts it. Two runs starting together can't both go ahead: the earlier wins. Merge, finding its PR locked, does nothing and waits for its next wake-up. The requeue run and the watch keep plain concurrency groups, because a dropped copy is harmless: the next one re-reads everything. (Foundation session, amending the tickets below)
- **Locks:**

  | Lock | Covers | Source |
  |---|---|---|
  | Per target repo | register, map, move | [Register/map/move] |
  | Per target repo | an explore batch | [Explore] |
  | Per ticket | implement; the upstream loops on a factory ticket; implement-spec's split (on the spec issue itself, so a second label on the same spec queues) and its build of a queue ticket (on that ticket) | [Implement], [Fix-CI and address-review], Foundation session |
  | Per PR | review, fix-CI, address-review and merge, shared | [Review], [Fix-CI and address-review], [Merge and watch] |
  | Per target repo, concurrency group | the daily watch | [Merge and watch] |
  | One running, one waiting (drops the rest), concurrency group | the requeue run | [Requeue run] |

- **One open factory PR per ticket.** A spare copy that slips through counts neither way on the trust ladder. A push rejected because someone pushed mid-run goes to a side branch (`<branch>-review-<run id>` or `<branch>-<task>-<run id>`) with no PR; its link is commented and the PR gets `agent:blocked`. This replaces v0's second PR. ([Review], [Fix-CI and address-review])
- **A try** is one run in a loop that counts toward the loop's cap. A crash, a ceiling hit or a failed push is a failed try. A deliberate stop with a reason, a budget pause, a flaky rerun, or a broken default branch is not. ([Fix-CI and address-review], GLOSSARY.md)
- **Caps:** 3 fix-CI tries and 3 address-review rounds per PR, counted separately; 3 review runs per PR, counted across every loop; about 3 tries for the map run. After the cap, `agent:blocked`. Re-adding the label is the human choosing to retry. ([Review], [Fix-CI and address-review], [Register/map/move])
- **A deliberate stop** ends a run with a reason from a fixed list and `factory:needs-human`, with no push and no try: unclear ticket, hazard, needs a workflow change, too big (implement); the test is wrong (fix-CI). ([Implement], [Fix-CI and address-review])
- **Branches:** implement pushes `agent/issue-<n>-<run id>` (v0), and the factory's track record is read from `agent/` branches. Map PRs use `map/<owner>/<repo>`. ([Implement], [Trust ladder], [Register/map/move])

### Checks, review and the ICM map

- **A human confirms a repo's checks once, by merging its first map PR,** after the map run has run every check on the default branch and put the real output in the PR. *Why:* inferring checks is error-prone (the prototype's repo had a formatter that fails on most files). ([Registration], [ICM map prototype], [Register/map/move])
- **`factory/checks` is a real GitHub check.** A no-agent host step runs the confirmed checks in a token-less sandbox after every factory push and posts the result as `factory/checks`, so a repo without CI still has a check. Green on a commit review hasn't seen sends the PR to review; red sends it to fix-CI. ([Implement], [Review])
- **Review is cold.** It shares nothing with the run that built the change. *Why:* an implementer that argued itself into a shortcut would argue a reviewer sharing its context into the same one. (v0, [Review])
- **Code beats the map.** A run that finds the map contradicted trusts the code and says so in its PR, and the contradiction is commented on the target's Re-map ticket. A stale map never blocks a run. ([ICM map prototype], [Map freshness])
- **One home per fact.** A map points at the target's own docs instead of copying them. ([ICM map prototype])

### Observability

- **The observability platform slot is a deliberate none.** *Why:* one human and a few runs a day; the Actions log already holds the agent's transcript; a hosted tracer would copy private targets' code to a third party. ([Observability])
- **Every run writes a run summary** (the Actions job summary): the task, the target repo and the item it worked on (linked); the outcome (done, queued, paused, stopped, failed try n of 3, or ceiling hit); turns, time, model, and tokens where Claude Code reports them; the label it set next. The full transcript stays in the run log at GitHub's default retention, with no separate artifact. ([Observability])
- **The cross-target view is saved search links in the factory README,** one per state: `factory:needs-human`, `agent:blocked`, `factory:paused`, `factory:queued`, `factory:ready-to-merge`, and open factory draft PRs, searching across the user's account and orgs holding owned targets. GitHub shows private results only to a signed-in user with access, so the public README leaks nothing. There is no status issue. ([Observability])
- **The requeue run's summary is the budget gauge:** today's runs against the cap, runs in flight against concurrency, whether a budget pause is open and until when, and how many items it restarted or handed to the companion (counts only). The README links to the latest requeue run; the budget-pause ticket stays the alarm. ([Observability])

### Releasing the factory

- **Code from `stable`, settings from `main`.** Every factory workflow is a thin entry file, live from `main`, holding only the trigger, permissions and a call. Its two jobs pick, by job-level `if:`, the real reusable workflow at `@stable` (most target repos) or at `@main` (test repos, and the factory itself). Scripts, prompts and workflow logic come from that ref. `budget.yml` and everything under `targets/` are always read from `main`. This holds for agent runs too: a gate run starts the agent run's own entry file (`<task>-agent.yml`) by workflow_dispatch, passing `factory_ref`, and that entry file's two jobs call `<task>-agent-run.yml` at the ref it names. Naming: `agent-<task>.yml` is a label's entry file, `<task>-agent.yml` an agent run's, and every reusable workflow ends in `-run.yml`. The requeue run, which runs only in the factory, has one job, at `@main`. *Why:* a bad factory change hurts only the test repos, and turning a repo off or merging a re-map takes effect at once. ([Factory upgrades], [Self-improvement])
- **A run pins one factory commit at its start** and uses it for every job and host step. *Known limit (Foundation):* only scripts, prompts and the shared setup action are pinned; GitHub can't call a reusable workflow at a computed commit, so an agent run's workflow YAML comes from the tip of `stable` or `main` when the agent run starts. A release or a push to `main` between a gate run and its agent run's start can pair new YAML with the gate's scripts. *Known limit (Foundation):* agent runs are dispatched into the factory repo, so they assume the factory is its own sole target until Targets brings the shim. Waiting items restart as new runs on whatever `stable` is then. **Each release reads everything the previous release wrote** (labels, marker comments, lock and try counts, file shapes); a format change reads both forms until the old one is gone. ([Factory upgrades])
- **Releasing** is a dated GitHub release (e.g. `stable-2026-11-20`) listing what changed, then moving the `stable` tag to it. Rollback moves `stable` back. A release that changes a state format says "not rollback-safe: <what changed>" in its notes; rolling back past it, the user re-labels the affected items by hand. The user moves `stable` by hand, and checks each move: a workflow run at `stable` before and after the move must show the new commit ran (the README's release procedure). The `stable` tag must exist before any run, since every entry file names both refs; the first release is cut at setup. ([Factory upgrades], [Self-improvement], Foundation session)
- **The factory proposes changes to itself; the user always merges them.** Factory changes never climb the trust ladder. The factory repo is one more owned target with its own ICM map and every change kind fixed at step 1. ([Self-improvement])

### Upstream

- **The user is the only voice upstream.** Upstream work starts from a factory ticket labelled `agent:upstream` that links the upstream issue, and every factory comment lives on that ticket. The factory never posts upstream: no PR, no comment, no reply. *Why:* no App or fine-grained PAT can open a PR on a repo the user doesn't belong to, and many projects that allow AI ban autonomous agents and require the human to write the PR body and replies. ([Upstream flow], [Cross-repo Actions], [AI policies])
- **The upstream user picks the work;** the factory never picks upstream issues. ([map] Notes)
- **The policy check runs first on every upstream run,** because policies change. Ban, or a mirror that doesn't take GitHub PRs: refuse, close the ticket, no override. Unknown: `factory:needs-human` until the user adds `policy:accepted`. Disclose or allow: proceed, following the requirements found. ([Upstream flow], [AI policies])
- **Upstream work never feeds the trust ladder.** ([Upstream flow])

### Trust ladder

- **Each owned repo climbs separately for each change kind.** A failure in one kind never costs another its step. ([Trust ladder])
- **Three steps.** Automated checks and automated review run at every step; only human review loosens.
  1. **Human merges.** Every kind starts here. This is v0's brake.
  2. **Human approves, factory merges.**
  3. **Auto-merge** on a passing review verdict and green checks.
- **Change kinds and their highest step in v1:**

  | Change kind | Highest step |
  |---|---|
  | docs | 3 |
  | tests (no production code touched) | 3 |
  | deps, patch or minor | 3 |
  | fix | 2 |
  | feature (major dependency bumps count as feature) | 2 |

- **Classifying a PR:** the diff's paths decide first, matched against the globs in the target's `change-kinds.yml` (whose `never_auto` paths always count as feature). Where production code changed, the ticket's `bug` or `feature` label separates fix from feature; no label means feature. A PR touching several kinds counts as its riskiest. The agent's own claim is never trusted. ([Trust ladder], [ICM map prototype])
- **A bad PR** is one that was reverted within 14 days, turned the default branch's CI red at its merge commit, received a human's commits, got changes requested by a human, or was closed unmerged by a human (unless another PR for the same ticket merged). Findings the factory's own review raised and a loop fixed before merge don't count. On a repo with no CI, the post-merge-red sign can't be seen, and the others carry the ladder. ([Trust ladder])
- **Demotion is automatic and immediate:** one bad PR moves its kind down one step, as a direct commit to `trust.yml`, and files or adds to one lesson ticket. **Promotion is proposed:** after N good PRs in a row for a kind since its last move (N = 10 by default, per repo), the factory opens a PR bumping the step; merging says yes, closing says no, and it asks again after the next N. ([Trust ladder])
- **The track record is never stored.** Every run that needs it recounts it from the git host using the factory's `agent/` PRs. `trust.yml` holds only each kind's step and N, and a human may hand-edit it to start a repo above step 1. ([Trust ladder])

## Labels, files and state

### Labels

| Label | Put on by | Means |
|---|---|---|
| `agent:register` | the user, or an upstream run | Start the register run on a "Register owner/repo" ticket. |
| `agent:map` | the register run's swap, or a person | Start the map run (first map, or a re-map on a "Re-map owner/repo" ticket). |
| `agent:move` | the user | Do the next step of a visibility move. |
| `agent:explore` | a trusted author | Explore this issue in the next batch. |
| `agent:implement` | a trusted author, explore, the requeue run, or an approved lesson | Build this ticket. |
| `agent:implement-spec` | a trusted author | Split this spec into a queue, or (re-added) make the queue live. |
| `agent:review` | the `factory/checks` host step, or a person | Review this factory PR (or factory ticket, upstream). |
| `agent:fix-ci` | the factory on red checks, or a person | Fix the failing checks. |
| `agent:address-review` | a person only | Answer the unresolved review threads. |
| `agent:upstream` | the user | Build this upstream work on the fork. |
| `agent:lesson` | the user | Approve the lesson ticket's proposal. |
| `agent:in-progress` | the run | Claimed. |
| `agent:blocked` | the run | A crash, ceiling, cap or rejected push; a human re-adds the trigger to retry. |
| `factory:needs-human` | the run | Stopped for a human, with a reason. Never restarted by the factory. |
| `factory:queued` | the run | Waiting for a budget slot or a lock; the requeue run restarts it. |
| `factory:paused` | the run | Waiting on a budget pause or `enabled: false`; the requeue run restarts it. |
| `factory:ready-to-merge` | merge | Steps 1 and 2: green and reviewed, waiting on the human. |
| `policy:accepted` | the user | The user takes responsibility for an unknown policy verdict. |
| `kind:<kind>`, `trust:<step>` | implement | Display only; merge works the kind out again from the final diff. |
| *(unnamed)* spec-live label | implement-spec | The spec's queue is live. *See [Gaps](#gaps) G8.* |

v0's `needs-a-human` is retired in favour of `factory:needs-human` ([Explore]).

### Files

| File | Holds | Written by |
|---|---|---|
| `budget.yml` (factory root) | credential, models, daily cap, concurrency, priority order, ceilings | the user |
| `targets/<owner>/<repo>/target.yml` | owned or upstream, public or private, default branch, `enabled`, optional `max_runs_per_day`, whether it is a test repo | the first map PR; the user |
| `targets/<owner>/<repo>/AGENTS.md` | what the repo is, layout surprises, routing by kind of run, the mapped-at commit, which sections of the target's own agent instructions to obey or ignore | the map run |
| `targets/<owner>/<repo>/checks.md` | exact check commands and their working directory, things that look like checks but aren't, the files the checks depend on, `status: inferred` or `confirmed` | the map run; confirmed by merging |
| `targets/<owner>/<repo>/hazards.md` | one line per danger no test catches, cited by function or symbol name | the map run; lessons |
| `targets/<owner>/<repo>/structure.md` | each code area and what else to check when changing it, plus a Data section | the map run |
| `targets/<owner>/<repo>/change-kinds.yml` | path globs per change kind, `never_auto` | the map run (re-maps only add kinds) |
| `targets/<owner>/<repo>/trust.yml` | each kind's step and N | the first map PR (all at step 1); demotion commits; promotion PRs; the user. Re-maps never touch it. |

A map is about 1,300 words for a ~2,600-line repo. `change-kinds.yml` and `trust.yml` are read by the factory, never by the agent. ([ICM map prototype], [Registration])

### State held outside files

Labels; hidden marker comments (the task a queued item restarts as, and merge's "merge" marker on held PRs); the budget-pause ticket; run names (lock keys, and which agent runs count against the budget); git history (the track record). Runners keep nothing.

## The five answers for every task

Each task answers the `software-factory` skill's five questions: **1. Trigger**, **2. Does** (and which services it reads and writes), **3. Triggers next**, **4. Human re-enters**, **5. No double work**. Changes are relative to the v0 workflow headers where a v0 task exists. Every agent run also passes [the pre-run gates](#the-pre-run-gates), writes a [run summary](#observability), and pins one factory commit.

### Register (no agent) — [Register/map/move]

1. **Trigger:** `agent:register` on a "Register owner/repo" ticket, in the factory for a public repo or the companion for a private one. The repo is read from the title; an unreadable title is refused. An `agent:upstream` run on an unregistered repo files this ticket itself after its policy and fork checks pass, or reuses an open one, and comments "waiting on registration" on the upstream ticket.
2. **Does:** checks that the App can see the repo, whether it is owned or upstream, and its visibility. Refuses if `targets/<owner>/<repo>/` already exists on `main` (use `agent:map`) or the ticket is on the wrong side (a private repo in the public factory: refile in the companion). Uses no Claude.
3. **Triggers next:** swaps `agent:register` for `agent:map` on the same ticket.
4. **Human re-enters:** files the ticket; a refusal is a comment saying what to do.
5. **No double work:** the already-registered refusal; the per-repo lock shared with map and move.

### Map (Sonnet, under `bwrap()`) — [Register/map/move], amended by [Map freshness]

1. **Trigger:** `agent:map`, from the register run's swap (first map) or added by a person on the target's "Re-map owner/repo" ticket (re-map). The factory never re-maps on its own.
2. **Does:**
   - Budget-pause and visibility checks first.
   - The agent reads the target and writes the map and `checks.md`. It **names** the checks; it doesn't report their results.
   - A no-agent host step runs every check in `checks.md` on the default branch in a token-less sandbox and puts the real output in the PR body. A check already failing is flagged.
   - Opens one PR on `map/<owner>/<repo>` in the factory or companion. A first map also adds `target.yml` and `trust.yml` (every kind at step 1) and closes the register ticket. A re-map closes the Re-map ticket.
   - Posts the registration checklist on the register ticket when the PR opens: install the App on the repo, add the shim workflow (the App can't), add the shim's secret, and a warning that branch protection may block the factory's merges.
   - **Re-maps update rather than start over:** the run gets the current map, the files changed since the mapped-at commit (with diffs for files the map names) and the Re-map ticket's comments. It may rewrite the front page, hazards and structure, never touches `trust.yml`, and only adds change kinds (new kinds start at step 1; a rename or removal is flagged for the human). Only a re-map moves the mapped-at commit. To start a map over, close the PR, delete the map folder and re-register.
3. **Triggers next:** nothing. Merging the map PR starts no run. For an upstream repo, the user re-adds `agent:upstream` by hand.
4. **Human re-enters:** reviews the map PR; fixes it by hand, leaves review comments plus `agent:address-review`, or closes it and re-adds `agent:map`. **Merging confirms the checks** (`status: confirmed`). Until a re-map merges, the old confirmed checks stay in force, so a pending re-map never blocks work. A failed run marks the ticket `agent:blocked`; re-adding `agent:map` retries, up to about 3 tries.
5. **No double work:** one open map PR per repo; a run that finds one stops and comments its link. The per-repo lock.

### Move (no agent) — [Register/map/move], from [Registration]

1. **Trigger:** the user's `agent:move` on the move ticket in the companion, which a run filed on a visibility mismatch. It never starts by itself in either direction: private to public publishes the map, a one-way door.
2. **Does the next step each time:** map not yet on the destination's `main` → open the copy PR (or link the open one). Map on both sides → open the delete PR in the source. Both done → post the "repoint the shim" checklist and close the ticket. An extra run says "nothing to do". Open tickets and PRs stay where they are. A map that was public stays in public history.
3. **Triggers next:** nothing.
4. **Human re-enters:** adds the label, merges each PR, repoints the shim.
5. **No double work:** a run that finds a mismatch comments on the open move ticket for that repo instead of filing a second; the per-repo lock; every run on the repo refuses until the move finishes.

**Unregistering** is a PR deleting `targets/<owner>/<repo>/`, plus a checklist to remove the shim and uninstall the App. `enabled: false` is the gentler pause. ([Registration])

### Explore (Sonnet, under `bwrap()`) — [Explore]

Kept from v0: the batch, grouping, closing duplicates onto the oldest issue; the read-only agent with a no-agent apply job that validates the plan before writing; refusing the whole plan on an unknown tag; the `agent:in-progress` → next-label flow; `agent:blocked` on failure.

1. **Trigger:** `agent:explore` on issues in an owned repo, forwarded by the shim; the factory re-checks the label and its author.
2. **Does:**
   - One batch per target repo, **at most 20 issues**; the rest keep `agent:explore` for the next batch. The batch counts as one run against the daily cap. The App token goes only to host steps.
   - Context is the target's **ICM map** (replacing v0's `GLOSSARY.md` and `app/modules/`). Blast radius is described in the map's terms, and an issue touching anything on the hazards list is never `easy-call`.
   - Tags: `easy-call` → `agent:implement`. `needs-a-human` → `factory:needs-human`. `blocked` → `factory:needs-human`, commenting "waiting on the reporter or something outside this repo". **New, `too-big`** → `factory:needs-human`, suggesting a spec and `agent:implement-spec`.
3. **Triggers next:** implement, on `easy-call` issues. The requeue run starts the next batch for leftovers.
4. **Human re-enters:** every non-`easy-call` issue; `agent:blocked` after a failed run (re-add `agent:explore`).
5. **No double work:** the per-repo lock, the claim, duplicates closed onto the oldest issue.

**Upstream variant (optional):** `agent:explore` on a factory ticket linking an upstream issue. The policy check runs first (a ban refuses). No fork needed. One issue, no grouping; findings are posted on the factory ticket. It never moves on by itself, even on `easy-call`: the user adds `agent:upstream` to build.

### Implement (Opus, under `bwrap()`) — [Implement], amended by [Explore]

1. **Trigger:** `agent:implement` on a ticket in an owned repo, from the user, explore, the requeue run (spec queues) or an approved lesson. The shim forwards it; the factory re-checks it.
2. **Does:**
   - The pre-run gates, then the claim under a per-ticket lock. If an open factory PR already closes the ticket, it stops and comments the link.
   - The agent works with the relay and the ICM map and ends with a structured result: **built**, or **stopped** with a reason from the fixed list and a short explanation.
   - **Stopped:** no push, no PR, `factory:needs-human` with the reason ("too big" suggests a spec). Not a try.
   - **Built:** the push step scans and pushes to a fresh `agent/issue-<n>-<run id>` branch and opens a **draft** PR that "Closes" the ticket, at every trust step. The no-agent checks host step posts `factory/checks`. A no-agent host step adds the display labels `kind:<kind>` and `trust:<step>`.
3. **Triggers next:** green `factory/checks` → `agent:review`; red → `agent:fix-ci`.
4. **Human re-enters:** a stopped ticket; `agent:blocked` after a crash or ceiling (re-add the label to retry, on a new branch); reviewing and merging the PR as the trust step allows.
5. **No double work:** the claim, the per-ticket lock, one open factory PR per ticket.

**Upstream variant:** triggered by `agent:upstream` on the factory ticket. The policy check (and registration on first use) runs first, then the drift check. It works on a branch of the user's fork; green or red sends the **factory ticket** to `agent:review` or `agent:fix-ci`. The ready-branch handoff is posted only after review passes.

### Implement-spec (owned repos only) — [Implement]

1. **Trigger:** `agent:implement-spec` on a spec issue in the target repo. v0's 15-minute cron, self-dispatch chain and button are removed.
2. **Does:** with no queue yet, an agent splits the spec into tickets with dependencies, comments "queue ready" and **stops** for the human to review and edit the queue. When the user re-adds the label and the queue exists, it marks the spec live and labels every ready queue ticket `agent:implement`. It never builds.
3. **Triggers next:** implement on the ready tickets. Later tickets are labelled by the requeue run as their dependencies' PRs merge.
4. **Human re-enters:** reviewing the queue before the second label; merging PRs; removing the live label to pause (in-flight PRs carry on); unsticking stopped or blocked tickets.
5. **No double work:** a queue ticket is done only when its PR **merges** (v0 counted it done when the PR opened), so dependants build on real code. Independent tickets run side by side up to the budget's concurrency. A stopped or blocked ticket holds only its dependants. The implement guards cover the rest.

### Review (Opus, under `bwrap()`) — [Review]

Kept from v0: cold and memory-less, fixes what it can, inline comments for the rest, marks the PR ready on any posted verdict.

1. **Trigger:** `agent:review` on a factory PR. The checks host step adds it whenever `factory/checks` is green on a commit review hasn't seen; a person can add it too. The shim forwards it; the factory re-checks it.
2. **Does:**
   - The pre-run gates, the claim, and the per-PR lock. Counts against the daily cap.
   - **Standards** are the target's own rules and style guide as its ICM map names them (replacing v0's `CODING_STANDARDS.md`); if the map names none, it says "no standards found" and still checks for bugs. **Spec** is the ticket the PR closes.
   - It fixes everything the rules decide and leaves only product decisions and missing information as inline comments. After pushing fixes, the checks run again and post a fresh `factory/checks`.
   - Push rejected → side branch `<branch>-review-<run id>`, no PR, `agent:blocked`.
3. **Triggers next:** pass and green → merge. Pass and red → fix-CI. Changes requested → `factory:needs-human`, and merge never starts from it.
4. **Human re-enters:** answering leftover findings (then `agent:address-review`, or fixing by hand), picking up a side branch, or `agent:blocked` after 3 review runs on one PR.
5. **No double work:** the claim, the per-PR lock, running only on unseen commits, the 3-run cap.

**Upstream variant:** `agent:review` on the factory ticket. It reviews the fork branch cold against upstream's own rules (its contributing guide and our ICM map of it). The review verdict and every leftover finding (`file:line` and explanation) go in one comment on the factory ticket. On a pass, the same run posts the [ready-branch handoff](#upstream-flow); on changes requested there is no handoff and the ticket gets `factory:needs-human`.

### Fix-CI (Opus, under `bwrap()`) — [Fix-CI and address-review], amended by [Merge and watch]

1. **Trigger:** a red `factory/checks` on a factory PR; the target's own CI failing on an `agent/` branch (the shim forwards `workflow_run: completed`, and the factory re-checks it); merge finding conflicts with the default branch; or `agent:fix-ci` by hand.
2. **Does:**
   - **Triage, no agent, before any try:** re-runs the failing checks once (pass → note the flake on the PR and carry on as green); runs the same checks on the default branch (red there → stop with `factory:needs-human`, "default branch is broken").
   - **Agent:** reads the failing output (passed in as text by a host step) and fixes the cause. It may not skip, delete or weaken tests or assertions, or touch check config or `.github/`. If the honest fix is "the test is wrong", it stops for a human (not a try).
   - The push step also refuses commits that remove a test or add a skip (a failed try). Push rejected → side branch `<branch>-fix-ci-<run id>`, `agent:blocked`.
3. **Triggers next:** fresh `factory/checks`, then review (green, within review's 3-run cap) or fix-CI again (red, within its cap).
4. **Human re-enters:** a stop (the test is wrong, default branch broken), `agent:blocked` after 3 tries or a rejected push.
5. **No double work:** the per-PR lock and claim; triage before the agent; one fix-CI run per failing commit.

**Upstream variant:** only the user's `agent:fix-ci` on the factory ticket, for red upstream CI or a rebase request. It triages first using upstream's public check results, reads the public check logs, pushes a fix or rebase to the fork branch, and comments a summary. Same caps and per-ticket lock; never weakens tests.

### Address-review (Opus, under `bwrap()`) — [Fix-CI and address-review], with [Register/map/move]

1. **Trigger:** `agent:address-review` on a factory PR or a map PR, by a person only. No automatic trigger on a GitHub "request changes" review.
2. **Does:**
   - Reads every unresolved review thread and every PR comment since the last round, from trusted authors only, including the review verdict's leftover findings a human has replied to.
   - For each thread, either fixes it and replies with the commit, or replies why not; a "why not" adds `factory:needs-human`. It never resolves threads.
   - **On map PRs:** if a round changes `checks.md`, it re-runs the checks with the map run's no-agent host step and refreshes their output in the PR body, so the human never confirms checks nobody ran.
   - Push rejected → side branch `<branch>-address-review-<run id>`, `agent:blocked`.
3. **Triggers next:** fresh `factory/checks`, then review or fix-CI.
4. **Human re-enters:** reading replies and resolving threads, answering a "why not", `agent:blocked` after 3 rounds.
5. **No double work:** the per-PR lock and claim; each round reads only threads still unresolved.

**Upstream variant:** the user's `agent:address-review` on the factory ticket, optionally saying which points to take or skip. It finds the upstream PR by its fork branch, reads the maintainers' public reviews present when the label went on, pushes fixes to the fork branch, and posts **draft replies** on the factory ticket for the user to rewrite and post. Nothing polls upstream. Each round is one try, capped at 3.

### Merge (no agent, owned repos only) — [Merge and watch]

1. **Trigger:** no label. A no-agent check re-evaluates a factory PR whenever a review run, `factory/checks`, the target's own CI (`workflow_run`, forwarded by the shim) or **a human's Approve** (forwarded by the shim on `agent/` branches) finishes. If any condition is missing, it quietly does nothing.
2. **Does:**
   - Skips the budget gates (it spends no budget) but respects `enabled: false` (the PR is labelled `factory:paused` with a "merge" marker and waits unmerged) and the visibility check. Shares the per-PR lock.
   - **Conditions:** a passing review verdict, green `factory/checks`, and the target's required CI green, all on the head commit.
   - Works out the change kind again from the final diff, reads its step from `trust.yml`, then **recounts that kind's track record live**. A bad sign since the last watch, including a human's commits on this very PR, demotes the kind at once and files the lesson; the PR then waits at the lower step.
   - **Step 1:** labels `factory:ready-to-merge` with a one-line summary (kind, step, all green); a human merges. **Step 2:** the same; a human's Approve then lets merge go ahead. **Step 3:** merges.
   - Merges by squash if the repo allows it, otherwise the repo's default method, passing the expected head SHA so a last-second push fails safely. **Never bypasses branch protection:** if protection blocks it, it comments why and adds `factory:needs-human`.
   - **Base moved:** behind with no conflicts, where the repo requires up to date → a no-agent host step merges the default branch in; checks re-run, but review doesn't count that commit as unseen. Conflicts → fix-CI (a try).
3. **Triggers next:** the merge closes the ticket ("Closes"); the requeue run wakes and advances any spec queue.
4. **Human re-enters:** merging at step 1, approving at step 2, `factory:needs-human` when protection blocks.
5. **No double work:** the per-PR lock and the expected head SHA.

### Watch (no agent, daily, owned repos only) — [Merge and watch], amended by [Map freshness]

1. **Trigger:** a daily clock, one run per target: in the factory for public targets, in the companion for private ones.
2. **Does:**
   - Recounts the last 14 days of factory PRs from the git host. For each new bad PR, demotes its kind with a direct commit to `trust.yml` and files or adds to a lesson ticket in the factory (or companion) with the evidence: the PR, the bad sign, the revert or red run.
   - After N good PRs in a row for a kind, opens the promotion PR. Never for the factory repo itself, whose kinds are fixed at step 1 ([Self-improvement]).
   - **Stale-map check (no agent):** the paths and functions or symbols named in hazards and structure still exist; the files `checks.md` lists are unchanged since the mapped-at commit; fewer than 100 commits since the mapped-at commit (or since the last dismissal). Any signal opens or comments on the target's one "Re-map owner/repo" ticket (`factory:needs-human`).
3. **Triggers next:** filing or adding to a lesson ticket starts a short **lesson-draft run** (Sonnet, counted against the budget, last in priority) directly from the run that filed it; it drafts its single proposal on the ticket. The user's `agent:lesson` approves it: a map note becomes a map PR the user merges (it never moves the mapped-at commit); a new check becomes an `agent:implement` ticket on the target. Closing the lesson ticket rejects it.
4. **Human re-enters:** approving or closing lessons; merging or closing promotion PRs; adding `agent:map` to a Re-map ticket, or closing it to dismiss its signals as of the default branch's current commit.
5. **No double work:** one lock per target. An open lesson is added to, never duplicated; one Re-map ticket per target. Demotion is idempotent because the track record is recounted, never stored.

### Requeue run (no agent) — [Requeue run], from [Budget]

1. **Trigger:** hourly, in the factory only (free minutes); whenever any factory run or companion agent run finishes; the factory's own merges; a push changing any `target.yml`. A concurrency group keeps one running and one waiting and drops the rest, which is safe because the waiting run re-reads everything.
2. **Does:**
   - Counts in-flight and today's runs across the factory and the companion (numbers only) against `budget.yml`. The agent run whose last job started it counts today but not in flight, since it is ending.
   - Closes a timed budget-pause ticket whose reset has passed.
   - Restarts the factory's own `factory:queued` and `factory:paused` items into free slots, in `budget.yml`'s priority order, oldest first: removes the label and re-adds the original trigger label (named by the hidden marker comment) with an App token. The task re-runs every gate; if it loses the slot to a race, it queues again.
   - **Hands over to the companion** if slots remain and a search counts any companion issues or PRs labelled `factory:queued` or `factory:paused` (the number only, never titles): starts the companion's requeue run, which fills the rest from its own items. No flag is stored (Foundation session, replacing [Requeue run]'s repo variable). *Trade-off accepted:* public items are offered slots first, so finish-before-start holds only within each repo (this replaces [Private maps]' "restarts paused work in both repos, in priority order").
   - Moves live spec queues forward: labels `agent:implement` on queue tickets whose dependencies' PRs merged and that aren't in progress, stopped or blocked.
   - Starts the next explore batch for any repo with issues still labelled `agent:explore`, one batch per repo at a time.
   - Restarts merges held by `enabled: false` once the repo is back on, in the merge priority, taking no slot.
3. **Triggers next:** the restarted tasks, via their own labels.
4. **Human re-enters:** removing `factory:queued` or `factory:paused` cancels an item; closing a credit pause. It never restarts `agent:blocked`, `factory:needs-human` or stopped items.
5. **No double work:** the one-running, one-waiting group; every restarted task re-checks its gates and lock; spec labelling skips tickets already in flight.

### Weekly self-improvement run (in the companion) — [Self-improvement], amended by [Private maps]

1. **Trigger:** a weekly clock in the companion. It is an agent run (Sonnet, last in priority); with no free slot it skips the week and says so.
2. **Does:** reads, since the last self-improvement run that finished, the lesson tickets, demotions, given-up runs (loops that hit their cap) and ceiling hits across every target, public and private, with read-only App tokens. Looks for patterns that point at the factory rather than one repo, and files **at most two** tickets in the companion, each with the pattern, the evidence and the proposed fix. Reports how far `main` is ahead of `stable` and how the test-repo runs since then went. A fix PR to the public factory never quotes private code, paths or repo names.
3. **Triggers next:** nothing. A ticket is built only when the user labels it `agent:implement`.
4. **Human re-enters:** labelling a ticket to build it, merging its PR (always the user), moving `stable` forward.
5. **No double work:** before filing, it reads open and closed self-improvement tickets. Open: new evidence becomes a comment. Closed as not planned: stays closed unless evidence newer than the close appears, then a fresh ticket links the old one and says what is new. Closed as done but the pattern returns: that counts as new evidence.

*See [Gaps](#gaps) G5.*

### Upstream flow

From [Upstream flow], with [AI policies], [Registration] and [Map freshness]. The upstream variants above share this frame:

1. **Intake:** the user files a ticket in the factory linking the upstream issue, labelled `agent:upstream` (or `agent:explore` first). Upstream repos are always public, so all upstream work runs in the factory.
2. **Policy check, every run:** reads `AI_POLICY.md` and similar, `CONTRIBUTING.md`, PR templates, `AGENTS.md`/`CLAUDE.md`, `CODE_OF_CONDUCT.md`, the `<owner>/.github` defaults, CI trailer denylists, outbound policy links one level deep, `.github/dco.yml`, CLA workflows and checks, contributor gates and mirror status. It posts the policy verdict, supporting quotes and the requirements to follow. A keyword scan of root files is not enough. Contributor gates are counted (e.g. the user's open PRs against a limit), and a breach pauses the ticket as `factory:needs-human`.
3. **First use registers the repo:** after the policy check, the fork check (no fork yet: the user forks by hand and installs the App on the fork), then the register ticket and map PR, which the user merges, then the user re-adds `agent:upstream`. *See [Gaps](#gaps) G10.*
4. **Drift check** at the start of each `agent:upstream` run, feeding the Re-map ticket; never blocks.
5. **Ready branch** (the handoff, where the factory stops): a branch on the user's fork, rebased on upstream's default branch; the confirmed checks pass in the sandbox; upstream's `push` workflows green on the fork where the user enabled fork Actions, otherwise "upstream CI not run"; commit trailers follow the policy (the repo's form where it asks, none where AI trailers are banned, none by default with disclosure in the PR body), and **never a `Signed-off-by`**. The handoff comment on the factory ticket gives the compare link, a **draft** PR body following upstream's template with the policy's disclosure wording, and a checklist of what only the user can do: DCO sign-off, CLA, template boxes, and rewriting the body in their own words where policy requires.
6. **Rounds** are started only by the user's labels on the factory ticket (`agent:address-review`, `agent:fix-ci`), each one try, capped at 3. Nothing polls upstream on a clock.
7. **Ending:** the ticket closes when the upstream PR is merged or closed, which the next run notices, or whenever the user closes it.

## Ticket sources and the factory's own tickets

**Ticket sources: none in v1** ([Ticket sources]). The skill's question for a ticket source ("what stops it filing the same ticket twice?") therefore has no source to answer for. The first real source is the first upgrade after v1 (out of scope).

The factory files its own tickets, always as the end of a chain a person or a clock started. Each has a duplicate rule:

| Ticket | Filed by, where | What stops a duplicate |
|---|---|---|
| Budget pause | the first run to hit a limit, in the factory | one open at a time; later runs comment on it |
| Register owner/repo | the user, or an upstream run, by visibility | an upstream run reuses an open one; registered repos are refused |
| Move | a run finding a visibility mismatch, in the companion | later mismatches comment on the open one |
| Re-map owner/repo | the watch, an upstream run, or a run reporting a contradiction, by visibility | one per target; later signals are comments; a hand-close dismisses signals up to that commit |
| Lesson | merge or the watch, by visibility | an open lesson is added to |
| Self-improvement | the weekly run, in the companion | the open/closed rules in its five answers |

## The five specs

Built in order, each its own `/to-spec` → `/to-tickets` → `/implement-spec` → one PR, built locally by the user (most of each phase is workflow files, and the App has no Workflows permission). Every phase leaves a working factory on the factory repo itself, so building can stop after any phase and each phase is tried for real before the next ([Spec handoff]). Specs are separate `ready-for-agent` issues on this repo, not children of the map.

### 1. Foundation

**Delivers:**
- The GitHub App with [its full permission set](#credentials-and-the-sandbox) and per-host-step tokens; v0's personal access token retired.
- Agents under `bwrap()` on pinned `ubuntu-24.04`, with `persist-credentials: false`, no secret on the launching host step, and the credential relay.
- The push step's scans (gitleaks, the Claude token found by its hash, workflow changes).
- `budget.yml` in [its settled shape](#budget): credential, models, caps, priority, per-task ceilings with the two time limits. The budget-pause ticket, `factory:queued`/`factory:paused`, the pre-run budget gates, and the requeue run (restarting queued and paused items, closing timed pauses).
- Gate runs that start agent runs, run names carrying lock keys, and locks that queue instead of dropping.
- The three-clocks rule: the requeue run is the only clock Foundation builds; the watch and weekly clocks arrive with the Trust ladder.
- Thin entry files plus reusable workflows, the `@stable`/`@main` split, run-start pinning, and dated `stable` releases.
- Run summaries on every run, and the README's saved search links and link to the latest requeue run.

**Revises in v0:** all four v0 tasks (explore, implement, implement-spec, review) move onto this base. v0's personal access token gives way to App tokens; the unsandboxed agent moves into `bwrap()`; the hard-coded model pins (`claude-opus-4-6` in `.sandcastle/main.ts`, `interactive.ts`, `test.ts`; `claude-opus-5-5` in `shared/common.ts`) give way to `budget.yml`, read only by `shared/common.ts`; each workflow splits into an entry file and a reusable workflow. The Sandcastle starter leftovers (`.sandcastle/main.ts`, `test.ts`, `interactive.ts`, `prompt.md`), which no workflow uses, are deleted. Implement-spec loses its 15-minute clock and its self-start chain now, because a run with no label can't be queued or restarted: until the PR loop, each `agent:implement-spec` label splits the spec when it has no queue yet, and otherwise builds the queue's next ready ticket. The split spends implement-spec's budget line under the spec's lock; the build spends implement's under the ticket's lock. The queue keeps v0's form (`spec:<n>` labels, `Position:`/`Depends on:` lines) until the PR loop settles G8, but a built ticket closes only when its PR merges, through the PR's "Closes #n"; until then the survey holds it, as it holds a ticket a run has, a parked one (`agent:blocked`, skipped until a person takes the label off) and a waiting one. A label on a spec whose queue is drained, or has nothing ready, comments and takes the label off, so re-adding it later is the retry; v0's `agent:queued` label goes. (Foundation session)

**Still works when it lands:** v0's four tasks run on the factory repo itself, label-triggered as before, with drafts and a human merging every PR, now sandboxed, budgeted and released through `stable`.

### 2. Targets

**Delivers:**
- The companion repo (created once) calling the factory's reusable workflows, with its own App key and Claude token, and the shared budget.
- The shim workflow and shim token for owned repos (forwarding labels, and later `workflow_run` and approvals for phases 3–4).
- Register, map (first map and re-map, with the no-agent check host step and the registration checklist), move, and unregistering.
- `target.yml` with `enabled` and `max_runs_per_day`; the visibility gate; the confirmed-checks gate.
- Re-map tickets and stale-map signals from contradictions. *See [Gaps](#gaps) G7 on the drift check.*
- ICM maps of the factory repo itself and of the test repos.

**Revises in v0:** v0 tasks stop assuming the factory repo is the target: they take a target repo from the trigger and read its ICM map. The prototype branch `prototype/icm-map-spendly` can move into the companion.

**Still works when it lands:** v0's four tasks now run on any registered owned repo with a confirmed map, through its shim; the human still merges every PR.

### 3. PR loop (owned repos)

**Delivers:**
- Explore with the ICM map, the 20-issue batch, `too-big`, `factory:needs-human`, and the vouching rule.
- Implement with structured stops, one open PR per ticket, the per-ticket lock, `factory/checks`, and the hand-off to review or fix-CI.
- Implement-spec as split-then-label; spec queues advanced by the requeue run; explore batches started by the requeue run.
- Review against the ICM map's standards, with fresh checks after its pushes, the side branch, and the 3-run cap.
- Fix-CI with triage and the test-weakening guard; the shim forwarding `workflow_run`.
- Address-review on factory PRs and map PRs.
- Locks, claims, tries and caps.

**Revises in v0:** implement-spec's cron, self-dispatch chain and button go, along with its "slow-query detector" ticket-source plan (no ticket source in v1); implement-spec no longer builds; queue tickets are done on merge, not on PR open. Review's second PR becomes a side branch, and `CODING_STANDARDS.md` becomes the target's standards from its map. Explore's `needs-a-human` becomes `factory:needs-human`, and its `GLOSSARY.md`/`app/modules/` context becomes the ICM map.

**Still works when it lands:** a labelled ticket goes through build, checks, fix-CI and review on its own and stops at a reviewed, green, ready PR that a human merges (step 1 everywhere, since merge doesn't exist yet).

### 4. Trust ladder

**Delivers:**
- Change kinds (`change-kinds.yml`, classification from the final diff, the `kind:`/`trust:` display labels) and `trust.yml`.
- Merge, with its four wake-ups (the shim forwarding approvals), live recount, the three steps, the expected head SHA, base-moved handling and `enabled: false` holds.
- The daily watch (demotion, promotion PRs, the stale-map drift check), lesson tickets, the lesson-draft run and `agent:lesson`.
- The weekly self-improvement run in the companion.

**Revises in v0:** v0 never merged; a human merging every PR becomes step 1 of the ladder.

**Still works when it lands:** every kind starts at step 1, so nothing merges on its own until the user merges a promotion PR.

### 5. Upstream

**Delivers:**
- `agent:upstream` tickets in the factory; the policy check and policy verdicts with `policy:accepted`; contributor gates.
- The fork check and automatic registration on first use; the drift check at the start of upstream runs.
- The upstream variants of implement, review (verdict and handoff on the factory ticket), fix-CI and address-review (draft replies), and optional upstream explore.
- The ready branch and its handoff comment.

**Revises in v0:** nothing further; v0 had no upstream work.

**Still works when it lands:** owned repos are unchanged; upstream work ends at a ready branch the user opens upstream.

## Check

The destination: "every service slot names a product and every task and ticket source answers the five questions."

**Slots:**

| Slot | Named? |
|---|---|
| Ticket tracker | yes: GitHub Issues |
| Ticket source | yes: none in v1 |
| Git host | yes: GitHub |
| Orchestrator | yes: GitHub Actions |
| Runner | yes: hosted `ubuntu-24.04`, Sandcastle `bwrap()` |
| Observability platform | yes: deliberate none |

**Tasks:**

| Task | 1 Trigger | 2 Does | 3 Next | 4 Human | 5 No double | Gaps |
|---|---|---|---|---|---|---|
| Register | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Map | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Move | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Explore | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Implement | ✓ | ✓ | ✓ | ✓ | ✓ | G3 |
| Implement-spec | ✓ | ✓ | ✓ | ✓ | ✓ | G8 |
| Review | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Fix-CI | ✓ | ✓ | ✓ | ✓ | ✓ | G11 |
| Address-review | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Merge | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Watch | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Lesson-draft run | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Requeue run | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Weekly self-improvement | ✓ | ✓ | ✓ | ✓ | ✓ | G5 |
| Upstream flow (variants) | ✓ | ✓ | ✓ | ✓ | ✓ | G10 |
| Ticket sources | none | — | — | — | n/a | — |

Every slot names a product, and every task has an answer to every question. Those answers depend on the gaps below, which are for the user to decide before or during the spec that owns them.

## Gaps

Contradictions between tickets, and questions no ticket answered. Nothing here is filled in by this digest. Settled gaps move into the rules or the task answers and are deleted here; their numbers are not reused (G1, G4, G6 and G9 were settled in the Foundation session).

### Contradictions

- **G2. How the shim starts the factory.** [Cross-repo Actions] (and the map's gist of it) says the shim sends `repository_dispatch`, which needs **Contents: write** on the factory. [Security model] and [Registration] give the shim token **Actions: write** only, which can start a `workflow_dispatch` and not a `repository_dispatch`. *Decide:* `workflow_dispatch` to the entry files (fits the token) or `repository_dispatch` (widens the token). **Owner:** Targets.
- **G3. A ceiling hit's draft PR vs one open PR per ticket.** [Budget] says a run that hits its ceiling "pushes its work as a draft, comments, and counts as a failed try". [Implement] says a retry after a ceiling hit goes "on a new branch", but also that a run finding an open factory PR for the ticket stops. Unanswered: does the ceiling-hit draft get `factory/checks` and go to review; does the user have to close it before a retry can run; does it count on the trust ladder if closed? **Owner:** PR loop.

### Missing answers

- **G5. Building a self-improvement ticket.** Its tickets live in the companion ([Private maps]), and it is built by `agent:implement` ([Self-improvement]), but implement builds "a ticket in the target repo" ([Implement]) and its PR "Closes" that ticket. A PR on the public factory can't close, or should even name, a private companion ticket. Also unsaid: where the push scan gets the private target names it must look for ([Private maps]) without the public factory holding them in plain sight. **Owner:** Trust ladder.
- **G7. Where the drift check lands.** [Spec handoff] puts "re-map and stale maps" in phase 2 (Targets), but the drift check runs inside the daily watch ([Map freshness], [Merge and watch]), built in phase 4. *Decide:* phase 2 builds a standalone daily drift check that phase 4 folds into the watch, or drift detection moves to phase 4 (phase 2 then has only reported contradictions). **Owner:** Targets.
- **G8. Spec-queue details.** [Implement] has implement-spec "mark the spec live" with a label that is never named, and doesn't say how a queue ticket records its dependencies (GitHub's native "blocked by", or v0's own scheme). **Owner:** PR loop.
- **G10. No fork yet.** [Registration] says the user forks by hand and installs the App when there's no fork, but not what the run does meanwhile (presumably a checklist comment, `factory:needs-human`, and the user re-adds `agent:upstream`). **Owner:** Upstream.
- **G11. Fix-CI's triage on a merge conflict.** [Merge and watch] sends conflicts to fix-CI as a try, but fix-CI's triage ([Fix-CI and address-review]) re-runs failing checks, and a conflict has none. *Decide:* whether triage is skipped for conflicts. **Owner:** Trust ladder.

### Vocabulary

- **GLOSSARY.md's Shim** said the shim only reports labels; in v1 it also forwards the target's CI results and human approvals on factory branches ([Fix-CI and address-review], [Merge and watch]). Updated in the same PR as this digest.
- "Step" (trust ladder) collides with Actions steps, and [Trust ladder]'s table calls a kind's highest step its "ceiling", which GLOSSARY.md reserves for a run's turn and time limit. This digest uses **host step** and **highest step**; the specs should too.

## Out of scope

Carried from the map; each returns only as a fresh effort.

- Deployment, rollback and production monitoring. Shipped means merged; reverts are read only as a trust-ladder signal.
- Git hosts other than GitHub.
- The factory picking upstream issues on its own.
- Building the factory: the map ended at the spec, and the specs are built after it.
- Paid microVM sandboxes (E2B, Modal and similar): the planned upgrade after v1, replacing open egress.
- Automated ticket sources (error trackers, feedback buttons, failing scheduled checks): the first upgrade after v1, added one at a time and throttled.
- An observability platform (LLM tracing such as Langfuse, or an APM): a later upgrade, if cross-run search or longer retention is ever needed.

## Sources

Every ticket below is closed, with its resolution comment and any amendments on the issue. Research findings live on the linked `research/*` branches.

**Foundation session** is the spec session of 2026-11-20 that settled G1, G4, G6 and G9 before Foundation's `/to-spec`; its decisions are recorded in this file by the PR that made them.

| Short name | Ticket |
|---|---|
| map | [Design a central software factory for any GitHub codebase][map] |
| Sandcastle on Actions | [Can Sandcastle sandboxes run inside GitHub Actions runners?][Sandcastle on Actions] |
| Claude Pro limits | [What does a Claude Pro subscription allow for automated runs?][Claude Pro limits] |
| Cross-repo Actions | [How can a central Actions factory act on owned and upstream repos?][Cross-repo Actions] |
| AI policies | [How do open-source projects signal their rules for AI contributions?][AI policies] |
| Trust ladder | [Design the trust ladder for owned repos][Trust ladder] |
| ICM map prototype | [Prototype an ICM map for one real target repo][ICM map prototype] |
| Registration | [Decide how a target repo is registered with the factory][Registration] |
| Security model | [Decide the factory's token and sandbox security model][Security model] |
| Budget | [Make the factory's throughput budget work on any Claude plan][Budget] |
| Upstream flow | [Decide the upstream contribution flow][Upstream flow] |
| Sandbox timing | [Measure Sandcastle sandboxes on a hosted Actions runner][Sandbox timing] |
| Self-improvement | [Decide how the factory improves its own code][Self-improvement] |
| Private maps | [Decide where ICM maps of private repos live][Private maps] |
| Credential relay | [Test a Claude credential relay outside the bwrap sandbox][Credential relay] |
| Register/map/move | [Answer the five questions for the register, map and move tasks][Register/map/move] |
| Implement | [Answer the five questions for implement and implement-spec][Implement] |
| Review | [Answer the five questions for review][Review] |
| Fix-CI and address-review | [Answer the five questions for fix-CI and address-review][Fix-CI and address-review] |
| Merge and watch | [Answer the five questions for merge and the post-merge watch][Merge and watch] |
| Explore | [Answer the five questions for explore][Explore] |
| Requeue run | [Answer the five questions for the requeue run][Requeue run] |
| Ticket sources | [Decide whether v1 has automated ticket sources for owned repos][Ticket sources] |
| Observability | [Decide what observability v1 needs beyond Actions run pages][Observability] |
| Map freshness | [Decide when an ICM map is refreshed and how a stale one is detected][Map freshness] |
| Factory upgrades | [Decide how factory upgrades reach runs already in flight][Factory upgrades] |
| Spec handoff | [Decide the shape of the spec handoff][Spec handoff] |

[map]: https://github.com/ShreyasReddy77/my-software-factory/issues/1
[Sandcastle on Actions]: https://github.com/ShreyasReddy77/my-software-factory/issues/2
[Claude Pro limits]: https://github.com/ShreyasReddy77/my-software-factory/issues/3
[Cross-repo Actions]: https://github.com/ShreyasReddy77/my-software-factory/issues/4
[AI policies]: https://github.com/ShreyasReddy77/my-software-factory/issues/5
[Trust ladder]: https://github.com/ShreyasReddy77/my-software-factory/issues/6
[ICM map prototype]: https://github.com/ShreyasReddy77/my-software-factory/issues/7
[Registration]: https://github.com/ShreyasReddy77/my-software-factory/issues/8
[Security model]: https://github.com/ShreyasReddy77/my-software-factory/issues/9
[Budget]: https://github.com/ShreyasReddy77/my-software-factory/issues/10
[Upstream flow]: https://github.com/ShreyasReddy77/my-software-factory/issues/11
[Sandbox timing]: https://github.com/ShreyasReddy77/my-software-factory/issues/12
[Self-improvement]: https://github.com/ShreyasReddy77/my-software-factory/issues/13
[Private maps]: https://github.com/ShreyasReddy77/my-software-factory/issues/14
[Credential relay]: https://github.com/ShreyasReddy77/my-software-factory/issues/15
[Register/map/move]: https://github.com/ShreyasReddy77/my-software-factory/issues/16
[Implement]: https://github.com/ShreyasReddy77/my-software-factory/issues/17
[Review]: https://github.com/ShreyasReddy77/my-software-factory/issues/18
[Fix-CI and address-review]: https://github.com/ShreyasReddy77/my-software-factory/issues/19
[Merge and watch]: https://github.com/ShreyasReddy77/my-software-factory/issues/20
[Explore]: https://github.com/ShreyasReddy77/my-software-factory/issues/21
[Requeue run]: https://github.com/ShreyasReddy77/my-software-factory/issues/22
[Ticket sources]: https://github.com/ShreyasReddy77/my-software-factory/issues/23
[Observability]: https://github.com/ShreyasReddy77/my-software-factory/issues/24
[Map freshness]: https://github.com/ShreyasReddy77/my-software-factory/issues/25
[Factory upgrades]: https://github.com/ShreyasReddy77/my-software-factory/issues/26
[Spec handoff]: https://github.com/ShreyasReddy77/my-software-factory/issues/27
