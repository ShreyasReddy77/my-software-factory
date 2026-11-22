#!/usr/bin/env bash
# The credential relay's host step: the only step that reads the Claude token.
#
#   - name: Start the credential relay
#     id: relay
#     env:
#       CLAUDE_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
#     run: .sandcastle/agent-workflows/shared/start-relay.sh
#
# Later steps of the same job reach the relay on 127.0.0.1:8787 and read
# steps.relay.outputs.claude-token-sha256, never the token.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log="${RUNNER_TEMP:-/tmp}/relay.log"

credential="$(env -u CLAUDE_TOKEN "$here/../../node_modules/.bin/tsx" "$here/budget-credential.ts")"

printf %s "$CLAUDE_TOKEN" | env -u CLAUDE_TOKEN nohup node "$here/relay.mjs" "$credential" > "$log" 2>&1 &

for _ in $(seq 100); do
  if grep -q "relay ready" "$log"; then
    cat "$log"
    exit 0
  fi
  sleep 0.05
done
cat "$log"
echo "The credential relay did not start" >&2
exit 1
