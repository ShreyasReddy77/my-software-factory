# What a Claude Pro subscription allows for automated runs

Research for [#3](https://github.com/ShreyasReddy77/my-software-factory/issues/3), feeding [#10](https://github.com/ShreyasReddy77/my-software-factory/issues/10) (the factory's throughput budget under Claude Pro).
Sources read on 2026-11-20. Plans, limits and prices change often; re-check the cited pages before relying on a number.

## Short answer

- **Permitted:** yes. Anthropic documents `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` specifically for CI and GitHub Actions on Pro. The limits on that permission: the token is yours, the usage is yours, and Anthropic sizes Pro for "ordinary, individual usage".
- **Limits:** a rolling **5-hour session limit** and a **weekly limit**. Both are shared with claude.ai chat and apply across all models. Anthropic publishes no token or message numbers for them. There may also be per-model (Opus or Sonnet) limits.
- **Models:** every Claude Code model alias works on Pro, and the default is **Opus 5.5**. Fable can bill to usage credits, and on Pro the 1M-context variants of Opus 4.6 and Sonnet 4.6 need usage credits.
- **When a limit is hit:** the request is blocked until the reset time in the message. Headless (`-p`) runs end with a non-zero exit code by default. `CLAUDE_CODE_RETRY_WATCHDOG=1` makes the run wait for the reset instead, and a cap variable bounds that wait.
- **Better deal:** Max ($100, 5x Pro) once Pro limits throttle the factory more than about weekly. Pay-as-you-go usage credits cost list API rates, so above about $80 a month of credits, Max is cheaper. Switch to an API key when you need throughput that doesn't depend on a quota, parallelism, or a credential that isn't tied to one person.

## 1. Is the subscription OAuth token allowed in GitHub Actions?

**Yes, explicitly documented.**

- The Claude Code GitHub Actions docs list `CLAUDE_CODE_OAUTH_TOKEN` as "an OAuth token that authenticates with your Claude subscription, available on Pro, Max, Ultra, Team, and Enterprise plans. Generate one by running `claude setup-token` locally." They also say: "If you authenticate with an OAuth token, runs use your Claude subscription instead of API billing." ([code.claude.com/docs/en/github-actions](https://code.claude.com/docs/en/github-actions))
- The Authentication docs say: "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude setup-token`." The token "requires a Pro, Max, Ultra, Team, or Enterprise plan. It can only make model requests", so it can't do Remote Control or claude.ai connectors. **[Bare mode](https://code.claude.com/docs/en/headless.md) (`--bare`) does not read `CLAUDE_CODE_OAUTH_TOKEN`.** ([code.claude.com/docs/en/authentication#generate-a-long-lived-token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token))
- The `anthropics/claude-code-action` setup guide says the same thing: "Pro and Max users can generate this by running `claude setup-token` locally". ([docs/setup.md](https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md))

**The terms behind it:**

- Pro is governed by the **Consumer Terms** ([legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)). The Consumer Terms (effective 8 Oct 2025) forbid accessing the Services "through automated or non-human means, whether through a bot, script, or otherwise", **"except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it."** ([anthropic.com/legal/consumer-terms](https://www.anthropic.com/legal/consumer-terms)) The Claude Code docs above are that explicit permission for Claude Code in CI.
- The Legal and compliance page sets the boundaries:
  - "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK."
  - "OAuth authentication … is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - Developers may not "route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users".
  - "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
- The Consumer Terms also say you may not share your account credentials with anyone else.

**What that means for the factory:**

- One person runs their own factory on their own repos and forks, using their own token, and only they can trigger it. That is the documented use case.
- Don't let other people trigger runs that bill to the token. The action already enforces write-access and human-actor checks ([who can trigger runs](https://code.claude.com/docs/en/github-actions#who-can-trigger-runs)).
- Never turn the factory into a service that runs for other people on this token.
- **Uncertain:** "ordinary, individual usage" is not defined. A factory that drains the quota around the clock is the pattern Anthropic is most likely to treat as non-ordinary. A tight throttle is both a budget control and a compliance hedge. This note is not legal advice.
- Docs recommend an API key rather than an OAuth token for a secret *shared across repositories in an org*, "since an OAuth token is tied to the subscription of the person who ran `claude setup-token`". The central factory keeps one secret in one repo, so this doesn't bind us.

**Operational notes:**

- The token lasts one year. Calendar its renewal.
- If `ANTHROPIC_API_KEY` is also present, it outranks `CLAUDE_CODE_OAUTH_TOKEN`. In `-p` mode it is "always used when present", so it bills the API silently ([authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). The baseline's `.sandcastle/.env.example` contains an empty `ANTHROPIC_API_KEY=`. Keep it unset in Actions.

## 2. What usage limits apply on Pro?

- "Pro plans have a five-hour limit and a weekly usage limit that applies across all models." How much fits depends on "message length, including the length of files you attach, the length of your current conversation, and the model or feature you use". ([What is the Pro plan?](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan))
- "Weekly limits reset at a fixed time each week that is assigned to your account". Check the time in claude.ai **Settings > Usage**. ([same](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan))
- Anthropic "may limit your usage in other ways, such as weekly and monthly caps or model and feature usage, at our discretion." ([same](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan))
- Claude Code and claude.ai chat **draw from one pool** ([Use Claude Code with your Pro, Max, or Ultra plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). The user's own chatting eats factory budget, and the factory eats the user's chat budget.
- Usage counts against the session and weekly allowances at the same time. "A single burst of heavy activity, such as a large workflow fanout, can exhaust the weekly allowance before the session window resets." ([errors: usage limits](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit))
- **No published numbers.** Neither Anthropic page gives tokens, messages or runs per window. Measure with `/usage` locally, or with the `rate_limits` status-line fields, and calibrate the throttle empirically ([costs](https://code.claude.com/docs/en/costs)).
- **Recent change:** on 6 May 2026 Anthropic doubled Claude Code's 5-hour limits for Pro, Max, Team and Enterprise, and removed the peak-hours reduction for Pro and Max ([anthropic.com/news/higher-limits-spacex](https://www.anthropic.com/news/higher-limits-spacex)). Limits move. Treat any number as perishable.

## 3. Which models can Pro use in Claude Code?

- **The `default` setting on Pro resolves to Opus 5.5.** "Pro, Max, Ultra, Team, Enterprise, and Anthropic API: defaults to Opus 5.5". Before v2.1.280 it was Sonnet 5 on Pro. ([model-config](https://code.claude.com/docs/en/model-config))
- The aliases `opus`, `sonnet`, `haiku` and `fable` are available. Pin the model per task with `--model` in `claude_args`, or `claudeCode("<id>")` in Sandcastle.
- **Fable:** "Depending on your plan and seat tier, Fable usage can bill to usage credits instead of drawing on your plan's included limits." In a run nobody watches, an unanswered consent prompt ends the turn with "nothing was sent" ([model-config: Fable and usage credits](https://code.claude.com/docs/en/model-config); [errors](https://code.claude.com/docs/en/errors#the-prompt-to-confirm-went-unanswered)). **Don't use Fable in factory runs on Pro.**
- **1M context:** Fable, Sonnet 5+, Haiku 5.5 and Opus 4.7+ run with 1M context by default at no extra entitlement. On Pro, the `[1m]` variants of Opus 4.6 and Sonnet 4.6 require usage credits ([model-config: extended context](https://code.claude.com/docs/en/model-config)).
- **Model-family limits:** error strings `You've hit your Opus limit` and `You've hit your Sonnet limit` exist. When one family is out, a model outside it keeps working ([errors](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit)). **Uncertain:** whether Pro currently has separate Opus or Sonnet caps. The docs only say the limit type "varies by subscription plan".
- **Baseline check:** `.sandcastle/agent-workflows/shared/common.ts` pins `claude-opus-5-5`. `.sandcastle/main.ts`, `test.ts` and `interactive.ts` still pin `claude-opus-4-6`.

## 4. How does hitting a limit show up in a non-interactive run?

- **Messages:** `You've hit your session limit · resets 3:45pm`, `You've hit your weekly limit · resets Mon 12:00am`, and the Opus or Sonnet variants. "Claude Code blocks further requests until the reset time shown in the message." Switching models doesn't help for the session or weekly limit. ([errors](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit))
- **Warning before the limit:** `You've used 85% of your session limit · resets 3:45pm`.
- **Headless exit:** "Claude Code exits with code 0 on success and a non-zero code when the run fails … When a failure happens inside the run … Claude Code prints the failure as the result on stdout." In `stream-json`, retries emit `system/api_retry` events with `error: "rate_limit"`, `attempt`, `max_retries` and `retry_delay_ms`. ([headless](https://code.claude.com/docs/en/headless))
- **Waiting instead of failing:**
  - `CLAUDE_CODE_RETRY_WATCHDOG=1` is meant "for unattended sessions such as eval harnesses, CI jobs". It retries 429 and 529 errors indefinitely, including waiting for a plan usage limit to reset.
  - `CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS` caps that wait. "When the reset is further away than this cap, the request fails at once". Requires v2.1.301+.
  - `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` sets how often to re-check, from 60000 to 10800000. Requires v2.1.305+.
  - Sources: [errors: tune retry behavior](https://code.claude.com/docs/en/errors), [env-vars](https://code.claude.com/docs/en/env-vars).
- **Credits and spend limits:** a 429 that reports a spend limit or exhausted usage credits **always fails at once**, even with the watchdog.
- **Not a plan limit:** `Server is temporarily limiting requests (not your usage limit)` is a server throttle. It is retried automatically with backoff.
- **Uncertain:** the docs don't state outright whether a plan-limit 429 *without* the watchdog is retried up to `CLAUDE_CODE_MAX_RETRIES` (default 10) or fails at once. Either way the run ends non-zero well before a multi-hour reset. Assume "fails" unless the watchdog is set.
- **Implication for #10:** a waiting run burns GitHub Actions runner minutes, and GitHub-hosted jobs have a maximum duration. Two options:
  - Fail fast, then requeue or comment from the workflow. Parse the `resets …` time from the result.
  - Watchdog with a cap well below the job timeout.

  Waiting out a weekly limit inside a job is never viable.

## 5. When does an API key or a higher plan become the better deal?

**Individual plans** ([claude.com/pricing](https://claude.com/pricing); support articles for [Max](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) and [Ultra](https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan)):

| Plan | Price | Allowance |
| - | - | - |
| Pro | $20/mo monthly, or $17/mo billed annually | 1x baseline, with a 5-hour and a weekly limit |
| Max | $100/mo | "five times the Pro plan's usage every five hours and every week", plus a separate weekly Fable limit and monthly API credits |
| Ultra | $200/mo | "10 times the Pro plan's usage every week". "Verified Ultra accounts don't have a five-hour limit". Formerly Max 20x |

**Usage credits:**

- Pro can turn on usage credits to continue past either limit.
- They are billed at **standard API rates**, opt in, and can be capped with a monthly spend limit.
- Sources: [usage credits](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans), [costs](https://code.claude.com/docs/en/costs#add-usage-credits-to-your-subscription).

**API list prices** per million tokens, input / output ([platform pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model | Input | Output | Cache hit |
| - | - | - | - |
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5.5 | $2 | $10 | $0.10 |
| Haiku 5.5 (prompts ≤100K) | $0.10 | $0.50 | |

Anthropic's own reference point is an average of about **$13 per developer per active day** of Claude Code on the API, with 90% of users under $30/day ([costs](https://code.claude.com/docs/en/costs)).

**Rules of thumb (my inference, not Anthropic's):**

- **Stay on Pro** while the factory fits a throttled budget: a few runs a day, and limit hits are rare and tolerable. The API-equivalent value of Pro's quota is far above $20/month, so Pro is the cheapest compute per run.
- **Move to Max ($100)** once Pro limits stall the queue most weeks. Also move if you'd otherwise buy more than about **$80/month of usage credits**, because Max's 5x quota then costs less than paying API rates for the overflow.
- **Ultra ($200)** removes the 5-hour limit, which is what bounds a burst of parallel runs. It is worth it only if the weekly 10x quota is actually used.
- **API key (Console)** is the better fit when any of these holds:
  - You need predictable throughput or real concurrency, since limits are per-org RPM/TPM tiers rather than a shared personal quota.
  - The factory runs for anyone other than you. Subscription credentials must not be used on others' behalf.
  - You want a credential not tied to one person, or workload identity federation instead of a static secret.
  - Usage is so light and sporadic that pay-per-token spend stays under the subscription price.

  The cost is real money per run. At the enterprise average that is about $13 per active day, so a busy factory on Opus quickly exceeds $100/month. Cheaper models such as Sonnet for review or Haiku for triage cut that a lot.
- **Hybrid:** you can keep Pro or Max for interactive work and give the factory its own API key. This isolates the user's chat budget from the factory's, at API prices.

## Open questions and uncertainties

- Exact Pro quotas in tokens or runs are unpublished. Measure them by running a representative implement task and reading `/usage` before and after.
- What counts as "ordinary, individual usage" is undefined. Enforcement can come "without prior notice".
- Whether Pro has separate Opus or Sonnet sub-limits today.
- Plan-limit retry behaviour without the watchdog (§4).
- Prices and limits changed as recently as May 2026. The Ultra/Max 20x rename and the Opus 5.5 default arrived within the last few CLI versions.
