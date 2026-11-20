# My Software Factory

This repo is the **factory**: one central place where GitHub Actions orchestrates Sandcastle runs that turn tickets into shipped PRs on any GitHub-hosted target repo. Right now it is in design: we are finding the way to its spec, not building it.

## Orient first

- **The map** is issue #1, "Design a central software factory for any GitHub codebase". Read it before any design work: its Destination, Notes and Decisions so far hold every settled choice. Work its tickets with the `wayfinder` skill.
- **Vocabulary**: speak the `software-factory` skill's terms (task, trigger, run, runner, ticket tracker, git host, orchestrator) plus the terms in [GLOSSARY.md](GLOSSARY.md). When a term is resolved or challenged, update GLOSSARY.md using the `domain-modeling` skill.
- **ICM**: for anything touching a target repo's ICM map, use the `icm-architect` skill.

## The v0 factory

`.github/workflows/agent-*.yml` start the runs; `.sandcastle/agent-workflows/<task>/` holds each task's script and prompt. Each workflow's header comment is the source of truth for its trigger, tokens and setup. The map revises v0 rather than replacing it.

## Tracker conventions

- Tickets are GitHub sub-issues of the map, labelled `wayfinder:<type>`. Blocking uses GitHub's native dependencies: `POST repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` and `.../issues/{n}/sub_issues`, both taking the issue's numeric `id`, not its number.
- Research findings live on `research/<name>` branches, linked from their ticket. Those branches are pushed and never merged.
