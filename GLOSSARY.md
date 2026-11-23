# My Software Factory

A portable software factory: GitHub Actions orchestrates Sandcastle runs that turn tickets into merged PRs on any GitHub-hosted codebase. The factory's own vocabulary (task, trigger, run, runner, ticket tracker, git host, orchestrator) comes from the software-factory skill; this file holds only the terms this project adds.

## Language

**Companion**:
The factory's private twin. It runs the factory's own code on private target repos, and holds everything about them, so nothing private ever reaches the public factory.
_Avoid_: private factory, mirror, fork

**Factory**:
This repository: the one central, public place whose orchestration and Sandcastle scripts serve every target repo, and which holds the ICM maps of public targets.
_Avoid_: factory kit, template, per-repo install

**Registration**:
The act of adding a target repo to the factory. It is complete when the user accepts the repo's first ICM map, which confirms its checks; only then may runs change its code. For an upstream repo it happens on the first piece of work there.
_Avoid_: install, onboarding, enrolment

**Stable**:
The version of the factory's code (scripts, prompts and workflow logic) that most target repos run. Settings and ICM maps are not part of it: runs always read the latest. The user moves it forward by hand once a change has proven itself on the test repos, and moves it back to roll a change back. A run keeps the version it started on until it finishes.
_Avoid_: release, production, latest

**Target repo**:
Any GitHub-hosted repository, in any language, that the factory works on.
_Avoid_: client repo, codebase, project

**Owned repo**:
A target repo the user can write to; the factory may merge there as the trust ladder allows.
_Avoid_: own repo, internal repo, private repo

**Upstream repo**:
A target repo the user contributes to through a fork; its maintainers merge, never the factory.
_Avoid_: OSS repo, external repo, third-party repo

**Shipped**:
Merged to the target repo's default branch. Deployment belongs to the target repo's own pipeline, not the factory.
_Avoid_: deployed, released, in production

**Shim**:
The one small workflow an owned repo carries, which only tells the factory that something happened there: a label was applied, or, on the factory's own branches, the repo's CI finished or a human approved. The factory never believes it: it checks for itself before any run.
_Avoid_: agent workflow, installer, webhook

**Trusted author**:
A person with write access to the target repo, or the factory itself. Other bots and apps never count, even with write access. Only trusted authors' words reach an agent, with two exceptions. When a trusted author labels an issue for the factory, they vouch for its title and body as they stood at that moment, whoever wrote them. On an upstream repo, the maintainers' review comments are also read, but only the ones present when the user started the round.
_Avoid_: collaborator, maintainer, allowed user

**Test repo**:
An owned repo the user picks to run the factory's newest, not-yet-stable scripts and prompts, so a bad factory change hurts it alone.
_Avoid_: canary, staging repo, beta repo

**Trust ladder**:
The sequence of steps that loosens human review as measured PR quality earns it, ending in auto-merge for the change kinds that qualify. Each owned repo climbs it separately for each change kind. Applies only to owned repos.
_Avoid_: autonomy level, maturity model

**Step**:
One level of the trust ladder: how much human review a PR of a given change kind gets before it merges.
_Avoid_: rung, level, tier

**Change kind**:
A category of change a PR makes (such as documentation or a new feature) that earns trust on its own. A failure in one change kind never costs another its step.
_Avoid_: change type, PR type, category

**Bad PR**:
A factory PR that showed a sign it should not have shipped as it was: reverted soon after merging, broke the default branch, needed a human's commits or requested changes, or was closed unmerged. One bad PR demotes its change kind. A PR with no such sign is good.
_Avoid_: failed PR, rejected PR

**Watch**:
The factory's daily look back over its recent PRs on each target repo, to find bad PRs, demote, file lesson tickets and propose promotions. It uses no model.
_Avoid_: monitor, audit, post-merge check

**Lesson ticket**:
A ticket the factory files after one of its PRs goes bad, proposing one new check or ICM map note so the mistake does not repeat. Nothing changes until a human approves it.
_Avoid_: postmortem, retro, incident

**ICM map**:
An ICM workspace describing one target repo (its structure, checks, standards and hazards) that every run reads first to find its way around.
_Avoid_: context file, repo docs, index

**Mapped-at commit**:
The target repo's commit an ICM map was last checked against. Only a re-map moves it; small edits to the map leave it alone.
_Avoid_: map version, last updated

**Stale map**:
An ICM map the code has probably moved past: a run found it wrong, something it names is gone, the checks may have changed, or the repo has moved far beyond its mapped-at commit. A stale map never stops a run, since code beats the map; it only asks a human whether to re-map.
_Avoid_: outdated map, broken map

**Budget**:
How much Claude usage the factory may spend, set once for the whole factory and shared by every target repo: which plan or key pays, how many agent runs it starts, and which tasks go first when usage is short.
_Avoid_: quota, allowance, rate limit (the plan's own limit is what the budget is sized against, not the budget)

**Agent run**:
A run that calls Claude. Only agent runs spend budget and count towards the daily cap; a run that only checks, counts, labels or merges is not one.
_Avoid_: AI run, Claude run, job

**Daily cap**:
The most agent runs the budget lets the factory start in one day (from midnight UTC). Work that finds it reached waits as a waiting item.
_Avoid_: daily limit, quota

**Gate run**:
The short run, with no agent, that a trigger label starts first: it checks who applied the label, the budget pause, the daily cap, concurrency and the lock, then claims the item and starts its agent run, or queues, pauses or quietly ends.
_Avoid_: pre-check, dispatcher, guard run

**Claim**:
Taking an item for a run: its trigger label is swapped for `agent:in-progress`, so no other run starts it. A claim with no agent run behind it is undone and the item blocked.
_Avoid_: lease, reservation

**Host step**:
A step of a run that runs on the runner outside the sandbox, never the agent. Host steps hold the tokens; the agent holds none.
_Avoid_: runner step, outer step

**Entry file**:
A workflow file that holds only a trigger, permissions and a call to a reusable workflow, at `stable` or `main`. Every factory run starts from one.
_Avoid_: wrapper, caller workflow, shim (the shim is a target repo's)

**Reusable workflow**:
The workflow file an entry file calls, holding a run's real jobs; which release of it runs is the entry file's choice.
_Avoid_: called workflow, template

**Spec queue**:
The ordered tickets one spec is split into, each naming its position and the positions it depends on. A ticket leaves the queue when it closes, which is when its PR merges.
_Avoid_: decomposition, plan, backlog

**Split**:
Implement-spec's first act on a spec with no spec queue yet: an agent cuts the spec into its spec queue, writing no code.
_Avoid_: decomposition, breakdown, planning run

**Build**:
Implement-spec's act on a spec that has a spec queue: implementing the queue's next ready ticket, as implement would, with the spec as context.
_Avoid_: implement run (implement is its own task), step

**Parked ticket**:
A spec queue ticket whose build failed or hit its ceiling, held out of the queue until a person takes its block off.
_Avoid_: stuck ticket, skipped ticket

**Explore batch**:
Every open issue in a target repo that a trusted author labelled for exploring, worked together by one agent run so related tickets are grouped and duplicates closed. It holds the repo's lock and counts once against the daily cap.
_Avoid_: queue, group (the agent's own clusters inside a batch)

**Lock**:
The rule that only one run works on a given thing (a ticket, a PR, or a target repo's registration, map or explore batch) at a time. A run that finds the thing taken queues itself to be restarted later, rather than waiting in line, so no run is ever lost.
_Avoid_: mutex, concurrency group (the orchestrator's own line, which drops waiting runs)

**Budget pause**:
The factory-wide state in which no run calls Claude, because a usage limit was hit or credit ran out. It is visible as one open ticket, and while it is open, runs pause their work instead of starting it.
_Avoid_: outage, freeze, cooldown

**Try**:
One run in a loop that counts towards that loop's cap, after which a human takes over. A run that crashes, hits its ceiling or fails its push is a failed try. A run that stops on purpose with a reason, or that never reaches the agent because the fault wasn't the change's, is not a try.
_Avoid_: attempt, retry (a retry is a human choosing to give it another go)

**Requeue run**:
The factory's scheduler: the one run that restarts queued and paused work when budget or a lock frees up, finishing work before starting it, and moves live spec queues forward. It never restarts work a human has to look at first.
_Avoid_: scheduler, cron, retry run

**Waiting item**:
A ticket or PR labelled `factory:queued` or `factory:paused`: work a run could not start for lack of budget, a lock or Claude itself, which the requeue run restarts. Taking the label off cancels it.
_Avoid_: backlog, pending item

**Ceiling**:
The most turns and time a single run of a task may spend. A run that reaches it stops and counts as a failed try.
_Avoid_: timeout, cap (the cap counts runs, the ceiling bounds one run)

**Policy verdict**:
What the factory concludes about an upstream repo's rules for AI contributions: ban (refused, no override), disclose, allow, or unknown (the user decides). Reached afresh on every upstream run, because policies change.
_Avoid_: AI policy, compliance status, allowlist

**Review verdict**:
What the factory's cold review concludes about one PR or ready branch: pass, or changes requested when it leaves findings only a human can settle. A change moves on to merge or handoff only on a pass.
_Avoid_: review result, approval (approving is a human's act)

**Ready branch**:
Where upstream work ends for the factory: a branch on the user's fork that passes the repo's checks, follows its policy verdict's requirements, and comes with a draft PR body. The user opens the PR and speaks for it upstream; the factory never posts there.
_Avoid_: upstream PR, draft PR, handoff branch

**Run summary**:
The short card every run leaves at the top of its run page: what it worked on, its outcome and what it started next. A run's full story is its log; the summary is what a human reads first.
_Avoid_: dashboard, status, report (the report is the agent run's whole last word, of which the summary is one part)

**Outcome**:
How a run ended, as its run summary states it: done, queued, paused, stopped with a reason, failed try n of m, or ceiling hit.
_Avoid_: result, status, conclusion (the orchestrator's own word for a job's end)

**Report**:
An agent run's last word on its item, however the run ended: the comment, the labels it sets next and its run summary.
_Avoid_: summary (only one part of it), final comment

**Budget gauge**:
The requeue run's run summary: today's agent runs against the daily cap, runs in flight against concurrency, whether a budget pause is open, and how much it restarted. It is where a human sees how much budget is left.
_Avoid_: dashboard, budget report

**Run name**:
The name every factory run carries on its run page, which says what task it is, which lock key it holds and whether it is an agent run (`[pr owner/repo#5] review`). Locks and budget counts are read from run names alone, so a run whose name doesn't parse holds no lock and spends no budget.
_Avoid_: run title, job name

**Lock key**:
The thing a lock covers, written into a run name: a ticket, a PR, or a whole target repo.
_Avoid_: concurrency key, mutex name

**Push guard**:
The host step that checks the agent's new commits before anything is pushed, and refuses them if they carry a secret, the Claude token or any change under `.github/workflows/`. A refusal pushes nothing and is a failed try. It finds the Claude token by its hash, so it never holds the token itself.
_Avoid_: secret scan (one of its checks), pre-push hook (it runs on the host, not in git)

**Marker**:
A hidden comment the factory leaves on a waiting item, naming the trigger label it restarts as. Each release reads every marker form the previous release wrote.
_Avoid_: tag, flag, state comment

**Credential relay**:
The small server on the runner that holds the Claude token and passes the agent's requests to Claude with it, so the agent never sees the token. Its host step is the only one that reads the token, and it hands later host steps only the token's hash, which is enough to recognise the token in a diff.
_Avoid_: proxy, gateway (Claude Code's own name for the setting it points at the relay)

**Stand-in token**:
The worthless token the agent holds in place of the Claude token. The credential relay throws it away and sends the real one.
_Avoid_: fake key, dummy token, canary (the spike's name for a token planted to be found)
