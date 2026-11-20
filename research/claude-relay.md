# Can a Claude credential relay keep the real token out of the bwrap sandbox?

Findings for [Test a Claude credential relay outside the bwrap sandbox](https://github.com/ShreyasReddy77/my-software-factory/issues/15). They feed the relay choice in [Decide the factory's token and sandbox security model](https://github.com/ShreyasReddy77/my-software-factory/issues/9).

Measured on 2026-11-20 on hosted `ubuntu-24.04` runners, with Sandcastle 0.14.0, Claude Code 2.1.329 and Bubblewrap 0.9.0. The spike is `spike/claude-relay/` plus `.github/workflows/spike-claude-relay.yml` on this branch.

- **Real-token run:** [44709495601](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44709495601), using a subscription OAuth token from `claude setup-token`.
- **Canary runs:** [44707515548](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44707515548) and [44708327747](https://github.com/ShreyasReddy77/my-software-factory/actions/runs/44708327747), using a fake token shaped like a real one.

## Answer in brief

**Yes. The relay works, and the real token stays out of the sandbox.** Claude Code inside `bwrap()` completed a real task (it wrote a file and committed it) holding only a stand-in token. No probe found the real token anywhere inside the sandbox. The fallback in the security decision (putting the token inside) isn't needed.

## Setup

1. **Relay step.** Its env holds the real token. The step starts `relay.mjs` in the background and passes the token on **stdin**, with `env -u TOKEN`, so the token is in neither the relay's environ nor its argv (checked with `sudo` from the host: 0 hits). The relay process outlives its step and serves the later steps.
2. **Sandcastle step.** It holds no credential at all; a check of its env found no name matching `token|secret|api_key`. It passes `bwrap({ env })` only `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and a stand-in credential.
3. **Relay.** It forwards to a fixed `api.anthropic.com`, keeping only the request path. It drops the incoming `authorization` and `x-api-key` headers and sets the real one. In OAuth mode it also adds `anthropic-beta: oauth-2025-04-20`.

## 1. Does a real task complete?

| Variant | Stand-in inside the sandbox | Relay mode | Result |
|---|---|---|---|
| `oauth-env` | `CLAUDE_CODE_OAUTH_TOKEN` | OAuth | **Passed:** `<promise>COMPLETE</promise>`, commit made, agent took 3.9 s |
| `auth-token` | `ANTHROPIC_AUTH_TOKEN` | OAuth (the relay adds the beta header) | **Passed:** `<promise>COMPLETE</promise>`, commit made, agent took 2.2 s |
| `api-key` | `ANTHROPIC_API_KEY` | API key (`x-api-key` swapped) | Not run with a real key (no secret). The canary got Anthropic's "Invalid API key", which proves the swap reaches upstream. |

- **Claude Code's only request is `POST /v1/messages?beta=true`** (two calls for this task). With non-essential traffic disabled, it made no call that bypassed `ANTHROPIC_BASE_URL`.
- **Both OAuth stand-ins work.** `ANTHROPIC_AUTH_TOKEN` is the cleaner choice: it is Claude Code's documented gateway setting, and the relay alone decides that the request is an OAuth one.
- **API key versus OAuth.** The only difference is which header the relay sets. Switching the credential type is a relay setting, so it fits `budget.yml`'s plan-agnostic credential.

## 2. Can the sandbox read the real token?

**No, by every route probed.** "Token-shaped" means `sk-ant-(oat|ort|api)NN-` followed by 20+ characters.

- **Processes.** `bwrap` uses `--unshare-all` (its own PID namespace). The sandbox sees 7 processes, all its own, and none has a token-shaped string in its `environ` or `cmdline`. The relay is invisible from inside.
- **Filesystem.** A token-shaped `grep -r` across every top-level dir except `/proc`, `/sys`, `/dev`, `/usr` and `/opt` found nothing. It finished in one leg and hit the 240 s timeout in the other two, with nothing found before the cut-off. `/usr` and `/opt` are the read-only runner image, and no step writes the token to disk.
- **After the agent ran.** A dump of every pid's environ and cmdline, the sandbox's env, and every file in the private home and `/tmp` (Claude Code's own config and session files) had 0 token-shaped matches. A host step then searched that dump, the run results, the relay log and `.sandcastle/logs` for the **exact** real token: 0 hits in each.
- **Relay responses.** No response, error or header contained a token-shaped string. Upstream errors carry only Anthropic's message and a request id. The relay's own errors are fixed strings.

## 3. Reachability

- **The relay is reachable from inside the sandbox**, because `bwrap()` runs with `--share-net`, which shares the runner's loopback.
- **It can't be steered to any other host.** These were refused with 404, or still went to `api.anthropic.com`:
  - absolute-form URLs (the IMDS address, `example.com`);
  - `//example.com/...` and `/v1/../..` paths;
  - a spoofed `Host:` header;
  - `CONNECT` (the connection was closed).
- **Other loopback listeners** (full TCP sweep of `127.0.0.1` and `::1`, checked against the host's `ss -ltnp`):
  - only `sshd:22` and the relay are listening for good. `sshd` needs a key the sandbox doesn't have.
  - in some legs the sweep also hit one to three high ports that `ss` didn't list by the end of the job. They were short-lived sockets that I didn't identify.
- **Beyond loopback:**
  - Azure IMDS instance metadata answers 200 from inside the sandbox.
  - The IMDS managed-identity token endpoint answers 400, because the runner VM has no identity.
  - General egress is open, as already known.

**A limit the relay doesn't fix: it is a spending oracle.** With the real token, malformed `/v1/messages` and bad-model requests got past auth (400 and 404, not 401). So the agent can **spend** the credential on any `/v1/*` call while the run lasts. It just can't **take** it with it. The caps in `budget.yml` and the Claude token's own spending cap remain the protection here. Allowlisting only `POST /v1/messages` narrows the surface but doesn't remove it.

## 4. Cost and size

- **Relay:** one ~80-line Node file with no dependencies (`relay.mjs`). Node is already on the runner, so no off-the-shelf proxy is needed. It is ready in **under 1 s**, and each forwarded call adds a few ms on loopback.
- **Claude Code install** (`npm i -g @anthropic-ai/claude-code`): ~3 s. The runner's toolchain is mounted into `bwrap()` read-only, so this is all Claude Code needs.
- **bwrap setup:** 5–16 s, consistent with the earlier [sandbox timing findings](https://github.com/ShreyasReddy77/my-software-factory/blob/research/sandbox-timing/research/sandbox-timing.md).
- **Sandbox create:** ~0.5 s. **Close:** ~20 ms.

## What the spec should carry

- Start the relay in its own step, before Sandcastle runs, and pass the token on stdin with `env -u`. Bind it to `127.0.0.1` only.
- Inside the sandbox, set `ANTHROPIC_AUTH_TOKEN=<stand-in>`, `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Have no `.sandcastle/.env`, so Sandcastle passes nothing else in.
- The relay forwards only `POST /v1/messages` to a fixed upstream, and its credential type (OAuth or API key) comes from `budget.yml`.
- The push step's scan for the token's literal value stays; it costs nothing.
