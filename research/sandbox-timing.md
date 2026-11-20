# Sandcastle sandboxes on a hosted Actions runner: measured

Ticket: [Measure Sandcastle sandboxes on a hosted Actions runner](https://github.com/ShreyasReddy77/my-software-factory/issues/12).
Measured 2026-11-20 on GitHub-hosted `ubuntu-24.04`, `@ai-hero/sandcastle` 0.14.0, Node 22.
Spike: `.github/workflows/spike-sandbox-timing.yml` and `spike/sandbox-timing/` on this branch.
Runs: [1](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44700167604) (cold docker build, then a script error), [3](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44700846615) and [4](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44701170919) (full measurements, docker build cache warm).

No agent ran. The "trivial task" was a shell command inside the sandbox that commits, so the spike measures the sandbox and spent no Claude usage. Running `claudeCode()` under `bwrap()` on hosted runners is already proven by Sandcastle's own CI.

The spike deliberately used the worst case: the checkout kept its credential (`persist-credentials` left at its default, `true`), and the step that ran the sandbox held `GH_TOKEN` in its environment.

## Timings

| | `bwrap()` | `docker()` |
| --- | --- | --- |
| Sandbox setup per job | **5–17 s** (`apt-get install bubblewrap` plus one sysctl) | **~121 s cold** (buildx 8 s plus a 113 s image build); **45–51 s** with a warm GHA build cache |
| Create sandbox, first in the job | 0.37–0.72 s | 0.39–4.7 s |
| Create sandbox, second in the job | 0.21–0.49 s | 0.18–0.28 s |
| `exec("true")` | 15 ms | 37 ms |
| Commit inside the sandbox | 27–30 ms | 46–48 ms |
| Close | 20–45 ms | **~10.1 s**: the image's `sleep infinity` ignores SIGTERM, so `docker stop` waits out its 10 s grace period |
| Host push of the sandbox's commit | 1.1 s | 1.5 s |
| Whole job (checkout to summary) | **13–32 s** | **83–87 s** warm cache |

Setup was the only real cost. Per sandbox, both providers take well under a second, apart from docker's 10 s close, which `--init` or a SIGTERM-aware entrypoint would remove.

## Commit inside, push outside

This works under both providers. The sandbox committed to its worktree branch, and a later host step pushed that branch with the job's token and deleted it again. The repo-local `user.name` and `user.email` reached the sandbox through the read-only `.git/config`.

## Tokens: what the sandbox could see

| Probe | `bwrap()` | `docker()` |
| --- | --- | --- |
| Sandbox env vars | only `HOME PATH PWD SHLVL TMPDIR` plus declared ones | only the image's own vars plus declared ones |
| `GH_TOKEN` from the host step's env, via `/proc/1/environ` | **readable.** PID 1 in the sandbox is `bwrap` itself, started with the host step's full environment | not visible |
| Checkout credential (`http.https://github.com/.extraheader`) in `.git/config` | **readable** | **readable** |
| `~/.git-credentials`, runner `_temp`, Docker socket | absent | absent |
| `sudo` | blocked (no-new-privileges) | not installed |
| Egress to api.github.com and example.com | open | open |

What this means:

1. **`persist-credentials: false` is mandatory.** Sandcastle mounts `.git/config` read-only, so any credential that `actions/checkout` persists is readable by the agent under either provider. v0 already sets this. The push step must hand git the token for that one command only.
2. **Under `bwrap()`, no GitHub token may be in the environment of the process that launches the sandbox**, even one Sandcastle doesn't pass in. `bwrap` inherits the launcher's environment, and the sandbox can read it from `/proc/1/environ`. v0's rule of putting `GH_TOKEN` only on steps that call GitHub covers this, as long as the Sandcastle step holds only the Claude credential. `docker()` doesn't have this leak.
3. **Egress is open under both**, as the research said. Anything the sandbox can read, it can send out.

## Setup each sandbox needed

- **`bwrap()`:**
  - `sudo apt-get install -y bubblewrap`
  - `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
  - Nothing else.
- **`docker()`:**
  - `docker/setup-buildx-action`, then `docker/build-push-action` with `load: true` and `cache-from`/`cache-to: type=gha`.
  - Build args `AGENT_UID=1001` and `AGENT_GID=118` to match the runner user, then `docker({ imageName })`.
  - The cache was written by a `push`-triggered run. Per the research, issue-triggered runs can only read it, so something else has to keep it warm, or the factory has to publish a prebuilt image to GHCR.
