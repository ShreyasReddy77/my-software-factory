# How a central Actions factory acts on owned and upstream repos

Research for [#4](https://github.com/ShreyasReddy77/my-software-factory/issues/4), part of the map [#1](https://github.com/ShreyasReddy77/my-software-factory/issues/1). Researched 2026-11-20 against docs.github.com and the `actions/create-github-app-token` README. Every claim cites the page that owns it.

## Answer in brief

- **Triggering the factory from an owned repo:** a thin shim workflow in the owned repo calls `repository_dispatch` (or `workflow_dispatch`) on the factory repo. The shim needs a token that can write to the factory repo: **Contents: write** for `repository_dispatch`, **Actions: write** for `workflow_dispatch`. A GitHub App's webhooks cannot reach Actions without a server in between, so the only server-free options are the shim and polling on a `schedule`.
- **Acting on other repos:** the factory's `GITHUB_TOKEN` only reaches the factory repo. Everything cross-repo needs a GitHub App installation token or a PAT.
- **GitHub App vs fine-grained PAT:** for **owned repos and the user's own forks** both work. The App is better: 1-hour tokens minted per job and scoped down per job, and the PRs and comments it writes show as the bot rather than as the user. A fine-grained PAT is simpler: one secret, everything it does is done as the user, and it can last up to a year.
- **Upstream repos:** a fine-grained PAT **cannot** "contribute to public repos where the user is not a member". A GitHub App cannot reach a repo it is not installed on, and that includes user access tokens. Only a classic PAT (`public_repo`) could open the upstream PR, and the map rules that out: the factory pushes a ready branch to the user's fork and **the user opens the upstream PR**. That fits the token limits exactly. The fork is owned by the user, so it is an ordinary owned target for tokens.
- **Upstream CI on the user's PR:** it runs under upstream's `pull_request` workflows with a read-only `GITHUB_TOKEN` and no secrets. By default a maintainer must approve the run while the user is a first-time contributor. The factory can do nothing about that. It can run the target's checks on the fork beforehand, but only after the user enables Actions on the fork.
- **`pull_request_target`:** never use it on anything that checks out or runs PR code. It runs with base-repo secrets and a write token.

## 1. Triggering the central factory from owned repos

### Options

| Mechanism | How | Token and scope | Notes |
|---|---|---|---|
| **Shim + `repository_dispatch`** | Owned repo workflow (e.g. `on: issues: labeled`) `POST /repos/<factory>/dispatches` with `event_type` + `client_payload` | Fine-grained: factory repo **Contents: write**. Classic: `repo`. [perms][fg-perms], [REST][rest-dispatch] | `client_payload` ≤ 10 top-level properties, < 64 KB; `event_type` ≤ 100 chars. Fires only if the workflow file is on the factory's **default branch**. [events][ev-rd] |
| **Shim + `workflow_dispatch`** | `POST /repos/<factory>/actions/workflows/<id>/dispatches` with `inputs` | Fine-grained: factory repo **Actions: write**. [perms][fg-perms] | ≤ 25 top-level inputs, 65,535 chars. Typed inputs, and runs show which workflow each one belongs to. [events][ev-wd] |
| **GitHub App webhooks** | App receives `issues`, `pull_request` etc. for every repo it is installed on | App permissions per event | Webhooks are delivered to a URL, not to Actions. They need a server (or relay) to turn them into a dispatch. The map wants no server. [deciding][app-vs-pat] |
| **Polling** | Factory `schedule` workflow lists labelled issues across targets | Read token across targets | No shim at all. Latency is the cron interval, and it spends API calls. On public repos scheduled workflows are **disabled after 60 days without repo activity**. [disable][disable] |

The shim needs a secret **in the owned repo**: a token that can write to the factory repo. With an App, the shim can instead hold the App's private key and mint a token with `actions/create-github-app-token` (`owner: <user>`, `repositories: my-software-factory`). In both cases the secret in the owned repo can start factory runs, so a collaborator on the owned repo can trigger them. The shim should forward only the issue/PR number and repo name. The factory then re-reads the issue itself and does not trust `client_payload` contents.

Dispatch events are exempt from the "no workflow from `GITHUB_TOKEN`" rule, but a `GITHUB_TOKEN` cannot reach another repo at all, so the shim still needs a cross-repo token. [github_token][gt]

**Upstream repos get nothing installed.** They are triggered only by the user, through `workflow_dispatch` on the factory (or a label on a factory-repo issue that names the upstream target).

## 2. Checking out, pushing and opening PRs across repos

### The built-in token stops at the factory repo

> "The token's permissions are limited to the repository that contains your workflow." To reach other repositories, use a personal access token or GitHub App installation access token. [github_token][gt]

It also cannot start workflows (except `workflow_dispatch`/`repository_dispatch`), and on personal accounts it cannot open PRs by default ("Allow GitHub Actions to create and approve pull requests" is disabled). [triggering][trig], [settings][settings] v0 adopted `FACTORY_PAT` for these same two hops (see `.github/workflows/agent-implement.yml`).

### Minimum fine-grained permissions per hop

From [Permissions required for fine-grained PATs][fg-perms]. GitHub App permissions use the same names.

| Hop | Permission on the target repo |
|---|---|
| Read issue / ticket | Issues: read |
| Label, comment on issues | Issues: write |
| Clone / fetch | Contents: read |
| Push branch | Contents: write |
| Push a change under `.github/workflows/` | **Workflows: write** (as well as Contents) |
| Open / update PR, PR comments, mark ready | Pull requests: write |
| Merge PR (`PUT .../pulls/{n}/merge`) | Contents: write |
| Sync fork (`POST .../merge-upstream`) | Contents: write |
| Create fork (`POST .../forks`) | Administration: write |
| Start a workflow on the target (`workflow_dispatch`) | Actions: write |
| Read CI results | Actions: read (Checks API is **not** available to fine-grained PATs [pat][pat]) |
| Dispatch into the factory (shim) | Factory repo Contents: write |

Metadata: read is always included.

### Fine-grained PAT: limits that matter

From [Managing your personal access tokens][pat]:

- "Each token is limited to access resources owned by a **single user or organization**." One token covers all of the user's own repos and forks. Org-owned targets need a token per org, plus org-owner approval if the org requires it.
- Fine-grained PATs cannot be used for: "contribute to public repos where the user is not a member"; "contribute to repositories where the user is an outside or repository collaborator"; "access multiple organizations at once"; "call the Checks API".
- "Tokens always include read-only access to all public repositories." Cloning upstream needs no grant.
- Classic tokens remain necessary "for write access to public repositories you don't own".

### GitHub App: what it adds

- **Short-lived, down-scopable tokens.** Installation tokens expire after **1 hour** and can be narrowed per request to some of the installed repos (up to 500) and some of the granted permissions. [install token][app-install] `actions/create-github-app-token` takes `owner`, `repositories` and `permission-*` inputs, and **revokes the token in its post step**, so the token cannot be passed to another job. [action][cgat]
- **Acts as the bot, not as the user.** "GitHub Apps can act independently of a user." [deciding][app-vs-pat] Commits, comments and PRs show as `<app>[bot]`. For the trust ladder this is a feature: the user can then review and **approve** the factory's PRs, which they cannot do on PRs opened under their own identity with a PAT.
- **Events it causes start workflows.** Like a PAT, and unlike `GITHUB_TOKEN`, an installation token's events start workflow runs. [triggering][trig]
- **Rate limits:** installation tokens get 5,000/hr, scaling by 50 per repo/user above 20, capped at 12,500/hr. A PAT gets 5,000/hr shared across everything the user does. `GITHUB_TOKEN` gets 1,000/hr per repo. [rate limits][rl] On a Pro-throttled factory none of these is the binding limit.
- **Reach:** only repos where the App is installed. User access tokens are also limited: "The app can only access resources in an account where it is installed." [user token][app-user] **No App token can open a PR on an upstream repo that has not installed it.**
- **Cost:** one App registration, its private key as a factory secret, an install on each owned repo/fork, and one token-minting step per job.

### Upstream: what the factory can and cannot do

1. The fork is the user's repo, so it is reached like any owned repo (fine-grained PAT, or the App installed on the fork). Keep it current with `merge-upstream` (Contents: write), clone from upstream (public read), and push the ready branch to the fork (Contents: write, plus Workflows: write if the change touches `.github/workflows/`).
2. Creating the fork needs Administration: write. That is broad, so let the user fork by hand once at registration.
3. **Opening the upstream PR** creates it in the *upstream* repo ([REST: create PR][rest-pr]: `head` = `user:branch`, requires write access to the head branch). Fine-grained PATs are barred from this ("public repos where the user is not a member") and Apps cannot reach an uninstalled repo. Only a classic PAT with `public_repo` could do it, and that grants write to *every* public repo the user can push to. **The map's choice that the user opens the PR is also forced by the token model.** The factory can give the user a ready compare link (`https://github.com/<upstream>/compare/<base>...<user>:<branch>`) and the PR body text.
4. When opening the PR the user should leave **"Allow edits by maintainers"** on (user-owned forks only). If the branch touches workflows, the option becomes "Allow edits and access to secrets by maintainers". [maintainer edits][edits]

## 3. Getting upstream CI to run on PRs from the fork

- Upstream's `pull_request` workflows run for fork PRs with a **read-only `GITHUB_TOKEN`** and **no secrets**. [events][ev-pr]
- **Approval gate.** "Workflow runs triggered by a contributor's pull request from a fork may require manual approval from a maintainer with write access." [approving][approve] The three repo policies are: approval for first-time contributors *new to GitHub*; for *first-time contributors* (never had a commit/PR merged into the repo; **the default**); for *all external contributors*. [settings][settings] For each new upstream the user's first PR will usually sit unapproved until a maintainer clicks "Approve workflows to run". The factory cannot do anything about this. It belongs in human re-entry for upstream work.
- **Private upstreams** have separate switches ("Run workflows from fork pull requests", "Send write tokens…", "Send secrets…", "Require approval…"), all owner-controlled. [settings][settings]
- **Pre-flight on the fork.** "Workflows don't run in forked repositories by default. You must enable GitHub Actions in the Actions tab of the forked repository", and scheduled workflows stay disabled in forks. [events][ev-pr], [disable][disable] If the user enables Actions on the fork once, pushing the factory's branch (with a PAT/App token, so the push starts workflows) runs upstream's own `push` workflows there. That gives a CI signal before the user opens the PR. Workflows that need upstream secrets will still fail.

### `pull_request` vs `pull_request_target`

- `pull_request_target` "runs in the context of the default branch of the base repository", with secrets and a possibly-write token. "Running untrusted code on the `pull_request_target` trigger may lead to security vulnerabilities." [events][ev-prt] The hardening guide calls it (with `workflow_run`) *privileged*: it shares the main-branch cache and has secrets, so never check out untrusted PR code under it. [hardening][hard]
- For the factory: its own workflows should keep using `issues: labeled` / dispatch, never `pull_request_target` (as v0 already warns). On owned repos, PRs come from branches in the same repo, not forks, so `pull_request` gets the repo's normal token and secrets and the fork rules don't apply. On upstream, which trigger upstream uses is its choice. The factory only sees the outcome.

## 4. Recommendation for the slots that depend on this

| Concern | Recommendation |
|---|---|
| Identity on owned repos + user's forks | **GitHub App** installed on the user's account (selected repos), token minted per job with `actions/create-github-app-token`, scoped to one target repo and the hop's permissions. A fine-grained PAT is an acceptable v1 fallback (one secret, as in v0), but then the user cannot approve the factory's PRs. |
| Upstream PR creation | **Not automated.** The factory pushes to the fork and hands the user a compare link + PR body. No classic PAT. |
| Owned-repo trigger | Shim workflow on `issues: labeled` (label-only, like v0) → `repository_dispatch` to the factory, forwarding only repo + number. The shim holds either a fine-grained PAT with factory Contents: write or the App key. |
| Upstream trigger | `workflow_dispatch` on the factory with `repo` + `issue` inputs, run by the user. |
| Factory self-chaining | Keep using an App/PAT token for hops that must start another workflow. Factory cron on a public repo dies after 60 idle days, so don't depend on cron alone. |
| Upstream CI | Expect first-PR approval to stall at the maintainer. Optionally run checks on the fork first (user enables Actions on the fork once). |

## Sources

[ev-rd]: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#repository_dispatch
[ev-wd]: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_dispatch
[ev-pr]: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request
[ev-prt]: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request_target
[rest-dispatch]: https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event
[rest-pr]: https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
[fg-perms]: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
[pat]: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
[gt]: https://docs.github.com/en/actions/concepts/security/github_token
[trig]: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
[settings]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
[approve]: https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks
[disable]: https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow
[app-install]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
[app-user]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user
[app-vs-pat]: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app
[cgat]: https://github.com/actions/create-github-app-token
[rl]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[hard]: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
[edits]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork

- Events that trigger workflows: [repository_dispatch][ev-rd], [workflow_dispatch][ev-wd], [pull_request][ev-pr], [pull_request_target][ev-prt]
- REST: [repository dispatch][rest-dispatch], [create a pull request][rest-pr], [rate limits][rl]
- [Permissions required for fine-grained PATs][fg-perms]; [Managing your personal access tokens][pat]
- [GITHUB_TOKEN][gt]; [Triggering a workflow][trig]; [Actions settings for a repository][settings]
- [Approving workflow runs from public forks][approve]; [Disabling and enabling a workflow][disable]
- GitHub Apps: [installation auth][app-install], [user auth][app-user], [deciding when to build an App][app-vs-pat]; [actions/create-github-app-token][cgat]
- [Security hardening for GitHub Actions][hard]; [Allowing changes to a PR branch from a fork][edits]
- Unverified claim: "the user can approve the App's PRs but not their own". GitHub forbids approving your own PR. This is standard GitHub behaviour but none of the pages above states it.
