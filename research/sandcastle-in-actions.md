# Can Sandcastle sandboxes run inside GitHub Actions runners?

Research for [#2](https://github.com/ShreyasReddy77/my-software-factory/issues/2). Feeds [#9](https://github.com/ShreyasReddy77/my-software-factory/issues/9), the decision on the factory's token and sandbox security model.

Sources were read on 2026-11-20:

- **Sandcastle:** `@ai-hero/sandcastle` v0.14.0, at commit [`1b380ca`](https://github.com/mattpocock/sandcastle/tree/1b380ca5e7a9fbece96c49d9edba264c1f512c4e) (2026-11-16). Links below point at `main`.
- **GitHub:** the runner-images readme and the GitHub Actions docs.
- **Docker:** the Docker docs.

Each claim cites its source. Anything I could not check is marked **unverified**.

## Answer in brief

- **Yes, both local sandbox types run on a GitHub-hosted Ubuntu runner.**
  - **`docker()`:** Docker ships on the runner image. Sandcastle has never run its `docker()` provider in CI, though. Its maintainers test it only locally.
  - **`bwrap()` (Bubblewrap):** proven in Sandcastle's own CI on `ubuntu-latest`. It needs two setup lines: `apt-get install bubblewrap`, and a sysctl that lifts Ubuntu's AppArmor block on user namespaces.
- **Startup cost.**
  - **`docker()`:** the cost is building (or pulling) the image. Sandcastle refuses to start unless the image is already present locally. Issue-triggered runs can only *read* the Actions cache, so a separate workflow has to keep a cache warm or a registry image current.
  - **`bwrap()`:** no image at all. The agent uses the runner's own toolchain, read-only.
  - I took no timings. The figures below are estimates.
- **Tokens.** The GitHub token can stay entirely outside the sandbox: the agent commits into a bind-mounted worktree, and a later host step pushes. The agent's own credential (`CLAUDE_CODE_OAUTH_TOKEN`) cannot stay out. Sandcastle passes it into the sandbox as an env var, and it has no credential proxy.
- **Network.** Sandcastle has no egress filtering.
  - `docker()` offers only `network` (attach to named Docker networks), plus `capDrop`, `cpus`, `memory`, `pidsLimit` and `devices`.
  - `bwrap()` has open egress, and the agent can reach the runner's localhost. Sandcastle's own ADR calls restricting the network "later work".
  - An allowlist would be ours to build: an internal Docker network with an egress proxy.

## 1. Does it run on a GitHub-hosted runner?

### What the runner provides

- **Docker, Podman and Buildx are installed. Bubblewrap is not.**
  - The `ubuntu-24.04` image lists "Docker Client 28.0.4", "Docker Server 28.0.4", "Docker-Buildx 0.38.2" and "Podman 4.9.3".
  - Bubblewrap is in neither the Tools list nor the apt-package list.
  - The image caches no Docker images. "Cached Tools" covers only language runtimes.
  - Source: [Ubuntu2404-Readme.md](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
- **`ubuntu-latest` is moving to Ubuntu 26.04 in November 2026**, per a banner on the same readme. Pin `ubuntu-24.04` until 26.04 is checked. I did not read the 26.04 readme.
- **Each job gets a fresh VM, and sudo needs no password.**
  - "each GitHub-hosted runner is a new virtual machine (VM)", except single-CPU runners.
  - "The Linux and macOS virtual machines both run using passwordless `sudo`."
  - Source: [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- **Runner sizes.** Standard Linux runners have 4 vCPU, 16 GB RAM and a 14 GB SSD on public repos, and 2 vCPU, 8 GB RAM and a 14 GB SSD on private repos. Source: the same page.
- **`ubuntu-slim` cannot run either sandbox type.** It "runs in unprivileged mode", it does not support Docker-in-Docker, and its jobs time out after 15 minutes. Source: the same page.

### `bwrap()`: proven by upstream in Actions

- **Sandcastle's own CI runs real Bubblewrap on `ubuntu-latest`.** Its containment test suite fails, rather than skips, when bwrap can't run. The setup step:

  ```yaml
  - name: Install Bubblewrap
    run: |
      sudo apt-get update
      sudo apt-get install -y bubblewrap
      sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      bwrap --ro-bind / / true
  ```

  Source: [`.github/workflows/ci.yml`](https://github.com/mattpocock/sandcastle/blob/main/.github/workflows/ci.yml).
- **Ubuntu 24.04+ blocks unprivileged user namespaces through AppArmor.** The docs give a narrower fix than the CI's blanket sysctl: a per-binary AppArmor profile for `bwrap`. Source: [sandbox-providers.md, "`bwrap()` on Linux"](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/sandbox-providers.md).
- **A broken setup fails loudly.** `bwrap()` "never falls back to running the agent unsandboxed". It throws `NativeSandboxUnavailableError` before any worktree exists. Sources: same doc, and [ADR 0024](https://github.com/mattpocock/sandcastle/blob/main/docs/adr/0024-native-sandbox-providers.md).
- **Its limits** (same doc):
  - **Mounts:** the host `PATH` toolchain is mounted read-only.
  - **Home and env:** the home dir is private and fresh, and the agent sees no env vars except those Sandcastle passes.
  - **No root:** `sudo: true` hooks are rejected.
  - **Interactive mode:** `interactive()` is not supported.
  - **Network:** open.

### `docker()`: works in principle, never run in CI upstream

- **Docker is present**, and the runner user can use it. Every Actions Docker workflow depends on that.
- **Sandcastle's own CI does not run `docker()`.**
  - Its release guide says: "CI can't run these: its machines have no container engine, so `npm test` and CI never see `tests/local/`. They are the only tests that start real `docker()` and `podman()` containers".
  - Maintainers run them by hand before each release.
  - Source: [docs/agents/releasing.md](https://github.com/mattpocock/sandcastle/blob/main/docs/agents/releasing.md).
  - So nobody upstream has proven the Docker adapter on an Actions runner. It is very likely to work, but our first run is the first proof.
- **The image must already exist locally.** Before `docker run`, the provider calls `docker image inspect` and fails with "Image '…' not found locally. Build it first with 'sandcastle docker build-image'." Source: [`src/sandboxes/docker.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/sandboxes/docker.ts), `checkImageUid`.
- **The image's UID must match the runner user's.**
  - The provider compares the UID in the image's `USER` with `process.getuid()`, and throws on a mismatch.
  - `sandcastle docker build-image` passes `AGENT_UID`/`AGENT_GID` as the host's UID and GID. An image built on the runner therefore matches.
  - A prebuilt image pulled from a registry must either be built with the runner's UID, or be run with `docker({ containerUid })`.
  - **Unverified:** the runner user's UID is commonly 1001. Check with `id -u`.
  - Sources: [ADR 0014](https://github.com/mattpocock/sandcastle/blob/main/docs/adr/0014-docker-uid-alignment-via-build-arg.md) and `docker.ts`.
- **The default image name is `sandcastle:<repo-dir-name>`**, and `imageName` overrides it. Source: [cli.md](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/cli.md).

### What the v0 factory does today

- **Every agent workflow uses `noSandbox()`**, here and upstream:
  - here, `.sandcastle/agent-workflows/*/*.ts`;
  - in Sandcastle's own `agent-*.yml` workflows, [`.sandcastle/agent-workflows/`](https://github.com/mattpocock/sandcastle/tree/main/.sandcastle/agent-workflows).
- **Sandcastle allows `noSandbox()` inside `run()` on purpose**, for users who run "inside an already-isolated environment — containerized CI, VM". Source: [ADR 0015](https://github.com/mattpocock/sandcastle/blob/main/docs/adr/0015-no-sandbox-in-run-and-create-sandbox.md).
- **That leaves a gap.** The runner VM isolates the job from other jobs, but not from the job's own secrets. Our `agent-implement.yml` already says so: "It is not a wall."

## 2. Startup time and caching

I took no timings. The figures below are rough expectations, not measurements. A spike run that times each step would settle them.

| | `bwrap()` | `docker()` |
|---|---|---|
| Per-run setup | `apt-get update && apt-get install bubblewrap` plus one sysctl. **Estimated** 10–30 s, mostly `apt-get update`. | Build the image from `.sandcastle/Dockerfile`, or pull one. The v0 Dockerfile is `node:22-bookworm` plus apt `gh` plus the Claude Code installer. **Estimated** 1–2 min cold, seconds from a warm layer cache. |
| Per-sandbox start | A process spawn, with no image and no daemon (ADR 0024). | `docker run` of a local image, about a second. **Unverified.** |
| Toolchain for the target repo | The runner's own: `setup-node`, `setup-python` and so on, mounted read-only. | Must be baked into the image, or installed by a `sandbox.onSandboxReady` hook on every run (60 s default hook timeout, overridable). |

What can be cached between runs:

- **Docker layers through the GHA cache backend.**
  - Use `cache-from: type=gha` and `cache-to: type=gha,mode=max` with `docker/build-push-action`.
  - It needs the `docker-container` buildx driver, or the containerd image store.
  - Give each image its own `scope=`, or every build overwrites the last one's cache.
  - Source: [Docker GHA cache backend](https://docs.docker.com/build/cache/backends/gha/).
- **The catch for us: issue-labelled runs can only read the cache.**
  - Only `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build` and `schedule` can write to the default branch's cache scope. Others get read-only access.
  - The docs name `pull_request_target`, `issue_comment` and `workflow_run` as read-only examples. `issues: labeled` is not one of the write events.
  - So a `push`- or `schedule`-triggered workflow must warm the cache, and agent runs only read it.
  - Source: [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
- **Cache limits.** 10 GB per repository by default, entries unused for 7 days are evicted, and the oldest-accessed entries go first when the cache is full. Source: the same page.
- **Alternative: a prebuilt image in GHCR.** A `push` or `schedule` workflow builds it, with the runner UID baked in. Agent runs `docker pull` it and pass `imageName`. This sidesteps both the cache write rule and the "image must exist locally" check.
  - **Unverified:** I took no pull-time measurement.
- **Dependencies (`node_modules` and so on).**
  - Under `bwrap()`, the usual `actions/setup-*` `cache:` options keep working on the host, because the toolchain is the host's.
  - Under `docker()`, dependencies must be baked into the image, or installed inside the sandbox on every run.
- **The factory serves any language.**
  - `docker()` implies one image per target repo, or one fat image, and the ICM map would have to specify it.
  - `bwrap()` reuses whatever the workflow installs on the runner.

## 3. Can every token stay outside the sandbox?

### GitHub token: yes

- **The agent commits into a host worktree that is bind-mounted into the sandbox.** Nothing is synced. A later host step pushes.
  - "For bind-mount providers (like Docker), the worktree directory is bind-mounted into the container — the agent writes directly to the host filesystem through the mount".
  - "The repo's `.git` is mounted too, so the agent can commit."
  - Use `branchStrategy: { type: "branch", branch: "agent/issue-<n>-<run>" }` (or `merge-to-head`, which the docs recommend "for CI or unattended runs"). `run()` returns `result.commits`.
  - Source: [branch-strategies.md](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/branch-strategies.md).
- **The agent cannot plant anything in the git files a later host push reads.**
  - `.git/config`, `.git/hooks`, `.git/info`, the worktree's `.git` file and `commondir` are mounted read-only.
  - Their parent dirs are bound onto themselves, so they can't be renamed away.
  - Sandcastle's own host-side git commands ignore repo hooks, and any repo config that names a program (fsmonitor, filters, diff and merge drivers, credential helpers).
  - The doc's caveat: git commands *you* run later are outside Sandcastle's control. Our push step must keep `core.hooksPath=/dev/null` and pass the token for that one command, as v0 already does.
  - Sources: same doc, and [`src/protectGitMounts.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/protectGitMounts.ts).
- **The sandbox sees only the env vars we pass.**
  - Its env is the merge of `.sandcastle/.env` keys (filled from `process.env` only for keys declared in that file), the sandbox provider's `env` and the agent provider's `env`.
  - `bwrap()` passes nothing else except `PATH`, `HOME` and `TMPDIR`.
  - So a `GH_TOKEN` in the job env does not leak in unless we declare it.
  - Sources: [`src/EnvResolver.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/EnvResolver.ts), [`src/mergeProviderEnv.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/mergeProviderEnv.ts) and sandbox-providers.md ("Env").
- **The step must still hold no token itself.** Under `docker()`, the agent is in a container. Under `bwrap()`, it can't see the runner user's home or the step's env. But the Sandcastle *host* script and its hooks run in the step, so keep `GH_TOKEN` off that step, as v0 does.

### Agent credential: no

- **The agent needs its credential inside the sandbox.**
  - `claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN } })`, or `.sandcastle/.env`, is how the agent logs in.
  - `bwrap()` hides the host's stored logins, "so the agent logs in only through these env vars".
  - Sources: [getting-started.md](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/getting-started.md), [agent-providers.md, "Provider `env`"](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/agent-providers.md) and sandbox-providers.md.
- **Sandcastle ships no credential-injecting proxy.** I searched `src/` and `docs/` for proxy and egress features, and found none beyond issue [#840](https://github.com/mattpocock/sandcastle/issues/840), which only asks to document `host.docker.internal` for proxies.
- **Consequence for #9.** "No token inside the sandbox" holds for GitHub credentials only. A prompt-injected agent can read and exfiltrate the Claude Pro OAuth token, because egress is open (section 4). Ways to limit the blast radius:
  - Accept the risk and rotate the token.
  - Use a short-lived token where one can be had.
  - Build a host-side gateway, with `ANTHROPIC_BASE_URL` pointing at it, that adds the credential. **Unverified:** whether Claude Code with a subscription OAuth token works through such a gateway.

## 4. What network controls does the sandbox give us?

- **`docker()` options**, from `DockerOptions` in [`src/sandboxes/docker.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/sandboxes/docker.ts):
  - `network`: one or more Docker networks, passed as `--network`. Default: the bridge network.
  - `capDrop`: `--cap-drop`, for example `["NET_RAW"]` or `["ALL"]`.
  - `cpus`, `memory`, `pidsLimit` and `devices`.
  - Nothing filters egress by host or domain.
- **`bwrap()` has no network option.** ADR 0024 says: "Open egress, host localhost reachable in this version. Restricting the network is later work." The containment doc also says the sandbox "can reach anything listening on `127.0.0.1`". In our workflow, that means the Postgres the implement step seeds.
- **The threat model Sandcastle claims.** Native sandboxes are "built for accidents and prompt-injection attacks". bwrap is "about as strong as a runc container (Docker on Linux)". Neither stops kernel escapes. For stronger isolation, the docs point to remote microVM providers (`vercel()`, `e2b()`, `modal()`, `sprites()`). Those are paid third-party services that each need their own API key on the host. Source: sandbox-providers.md, "Containment".
- **Building an egress allowlist ourselves (`docker()` only).**
  - Create an `--internal` Docker network, run an allowlisting forward proxy as a second container on it and on the default bridge, and pass `network: "<internal>"`.
  - Set `HTTP(S)_PROXY` through `docker({ env })`.
  - Allow only the Anthropic API and the package registries the target repo needs.
  - **Unverified:** this has not been tried with Sandcastle, and Claude Code's proxy support was not checked here.
  - On Linux Docker Engine, `host.docker.internal` needs `--add-host`, which `docker()` does not expose ([#840](https://github.com/mattpocock/sandcastle/issues/840)). Hence the proxy-as-container design.
- **Evidence that hostile input is real.** Sandcastle's own tracker holds an issue whose *title* is a shell command that would post the runner's environment to a remote host. It is aimed at agents that paste issue titles into a shell. That is the injection path our `issues: labeled` trigger exposes, and the reason open egress plus an in-sandbox Claude token matters.

## What this means for #9

1. **A sandbox is feasible on hosted runners.**
   - `bwrap()` costs two setup lines, has upstream CI proof, and reuses the runner's toolchain for any language.
   - `docker()` costs an image pipeline per target, and lacks upstream CI proof.
2. **The GitHub token can stay outside.** Keep the v0 split: the agent commits, a host step pushes with hooks off.
3. **The Claude OAuth token cannot stay outside.** Decide whether that is accepted, or mitigated by an egress allowlist or a gateway.
4. **There is no egress control out of the box.** An allowlist means `docker()` plus our own proxy container. `bwrap()` can't do it today.
5. **Things to check in a spike:**
   - startup timings;
   - `docker()` on a hosted runner, including the UID check;
   - Ubuntu 26.04 behaviour once `ubuntu-latest` moves.
