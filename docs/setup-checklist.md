# One-time setup checklist (draft)

Setting the factory up from a fresh clone. A draft: the README takes this
over when the README is written.

1. **Create the GitHub App** (Settings → Developer settings → GitHub Apps →
   New GitHub App). No webhook. Repository permissions, exactly these:

   | Permission | Access |
   |---|---|
   | Metadata | read |
   | Contents | read and write |
   | Issues | read and write |
   | Pull requests | read and write |
   | Actions | read and write |
   | Checks | read and write |
   | Commit statuses | read |

   Never grant Workflows, Administration, Secrets, Variables or any
   organisation permission. Without Workflows the App cannot push a change
   under `.github/workflows/`, so no factory change can widen its own reach.
2. **Install the App** on the factory repository only.
3. **Add the App's ID** as the repository variable `FACTORY_APP_ID`, and
   **generate a private key** and add it as the repository secret
   `FACTORY_APP_PRIVATE_KEY`.
4. **Add the Claude token** as the repository secret
   `CLAUDE_CODE_OAUTH_TOKEN`: a subscription token from `claude setup-token`,
   or an API key. Set `credential:` in `budget.yml` to match
   (`subscription` or `api-key`).
5. **Create the labels:**

   ```sh
   gh label create "agent:implement" --color 5319E7 --description "Hand this issue to the implementer agent"
   gh label create "agent:review" --color 5319E7 --description "Ask the review workflow to read this pull request"
   gh label create "agent:explore" --color 5319E7 --description "Explore this issue in the next batch"
   gh label create "agent:implement-spec" --color 5319E7 --description "Build this spec's queue"
   gh label create "agent:in-progress" --color FBCA04 --description "An agent is working on this right now"
   gh label create "agent:blocked" --color B60205 --description "An agent run failed here. Its comment says how to retry"
   gh label create "factory:queued" --color C5DEF5 --description "Waiting for a budget slot or a lock; the requeue run restarts it"
   gh label create "factory:paused" --color C5DEF5 --description "Waiting on a budget pause; the requeue run restarts it"
   gh label create "factory:needs-human" --color D93F0B --description "Stopped for a human, with a reason"
   gh label create "needs-a-human" --color D93F0B --description "Explore stopped here for a human"
   gh label create "factory:ready-to-merge" --color 0E8A16 --description "Green and reviewed, waiting on the human"
   ```

6. **Create the `stable` tag.** Every entry file names its reusable workflow
   at `@stable` as well as `@main`, so the tag must exist before the first
   run, even though the factory repository itself runs `@main`:

   ```sh
   git tag stable origin/main && git push origin stable
   ```

   The first dated `stable` release is cut once Foundation merges.
7. **Delete `FACTORY_PAT`** once no workflow names it any more.
