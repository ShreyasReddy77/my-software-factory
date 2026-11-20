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
The per-target-repo sequence of rungs that loosens human review as measured PR quality earns it, ending in auto-merge for the change kinds that qualify. Applies only to owned repos.
_Avoid_: autonomy level, maturity model

**ICM map**:
An ICM workspace describing one target repo (its structure, checks, standards and hazards) that every run reads first to find its way around.
_Avoid_: context file, repo docs, index
