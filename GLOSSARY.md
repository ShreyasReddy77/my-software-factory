# My Software Factory

A portable software factory: GitHub Actions orchestrates Sandcastle runs that turn tickets into merged PRs on any GitHub-hosted codebase. The factory's own vocabulary (task, trigger, run, runner, ticket tracker, git host, orchestrator) comes from the software-factory skill; this file holds only the terms this project adds.

## Language

**Factory kit**:
The installable package of workflows, Sandcastle scripts and conventions that puts the factory to work on a target repo.
_Avoid_: template, starter, framework

**Target repo**:
Any GitHub-hosted repository, in any language, that the factory works on.
_Avoid_: client repo, codebase, project

**Shipped**:
Merged to the target repo's default branch. Deployment belongs to the target repo's own pipeline, not the factory.
_Avoid_: deployed, released, in production

**Trust ladder**:
The per-target-repo sequence of rungs that loosens human review as measured PR quality earns it, ending in auto-merge for the change kinds that qualify.
_Avoid_: autonomy level, maturity model

**ICM map**:
An ICM workspace describing one target repo (its structure, checks, standards and hazards) that every run reads first to find its way around.
_Avoid_: context file, repo docs, index
