# My Software Factory

A portable software factory: GitHub Actions orchestrates Sandcastle runs that turn tickets into merged PRs on any GitHub-hosted codebase. The factory's own vocabulary (task, trigger, run, runner, ticket tracker, git host, orchestrator) comes from the software-factory skill; this file holds only the terms this project adds.

## Language

**Factory**:
This repository: the one central place whose orchestration, Sandcastle scripts and ICM maps serve every target repo.
_Avoid_: factory kit, template, per-repo install

**Registration**:
The act of adding a target repo to the factory, after which runs may work on it.
_Avoid_: install, onboarding, enrolment

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

**Trust ladder**:
The sequence of steps that loosens human review as measured PR quality earns it, ending in auto-merge for the change kinds that qualify. Each owned repo climbs it separately for each change kind. Applies only to owned repos.
_Avoid_: autonomy level, maturity model

**Step**:
One level of the trust ladder: how much human review a PR of a given change kind gets before it merges.
_Avoid_: rung, level, tier

**Change kind**:
A category of change a PR makes (such as documentation or a new feature) that earns trust on its own. A failure in one change kind never costs another its step.
_Avoid_: change type, PR type, category

**Lesson ticket**:
A ticket the factory files after one of its PRs goes bad, proposing one new check or ICM map note so the mistake does not repeat. Nothing changes until a human approves it.
_Avoid_: postmortem, retro, incident

**ICM map**:
An ICM workspace describing one target repo (its structure, checks, standards and hazards) that every run reads first to find its way around.
_Avoid_: context file, repo docs, index
