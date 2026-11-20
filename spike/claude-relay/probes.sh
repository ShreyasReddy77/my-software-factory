#!/usr/bin/env bash
# Probes run inside the sandbox. A token found is never printed: only where
# it was found.
#
#   probes.sh probe <relay-url>   reachability and relay-response probes
#   probes.sh dump <out-file>     every readable env, cmdline and private-dir
#                                 file, for the host to search for the exact
#                                 real token afterwards
set +e
here=$(cd "$(dirname "$0")" && pwd)
# A real Anthropic credential: OAuth (oat), refresh (ort) or API key (api).
TOKEN_RE='sk-ant-(oat|ort|api)[0-9]{2}-[A-Za-z0-9_-]{20,}'

if [ "$1" = dump ]; then
  out=$2
  : > "$out"
  for p in /proc/[0-9]*; do
    { cat "$p/environ"; echo; cat "$p/cmdline"; echo; } >> "$out" 2>/dev/null
  done
  env >> "$out"
  find "$HOME" /tmp -type f -size -5M -readable -exec cat {} + >> "$out" 2>/dev/null
  echo "dump: $(wc -c < "$out") bytes from $(ls -d /proc/[0-9]* | wc -l) pids, $(find "$HOME" /tmp -type f | wc -l) private files"
  echo "dump token-shaped matches: $(grep -cE "$TOKEN_RE" "$out")"
  exit 0
fi

relay=$2
echo "whoami: $(whoami) uid=$(id -u)"
echo "env names: $(env | cut -d= -f1 | sort | tr '\n' ' ')"
echo "credential env (values shown, they are stand-ins): $(env | grep -E '^(ANTHROPIC|CLAUDE)_' | tr '\n' ' ')"
echo "processes visible: $(ls -d /proc/[0-9]* | wc -l)"
echo "pid 1 cmdline: $(tr '\0' ' ' < /proc/1/cmdline | cut -c1-80)..."

for p in /proc/[0-9]*; do
  n=$({ tr '\0' '\n' < "$p/environ"; tr '\0' '\n' < "$p/cmdline"; } 2>/dev/null | grep -cE "$TOKEN_RE")
  [ "$n" -gt 0 ] && echo "TOKEN-SHAPED in /proc/${p#/proc/} environ/cmdline: $n"
done
echo "proc scan done"

# /usr and /opt are the runner image, read-only; a full sweep of them times out.
roots=$(ls -d /* | grep -vE '^/(proc|sys|dev|usr|opt)$' | tr '
' ' ')
hits=$(timeout 240 grep -rIlE "$TOKEN_RE" $roots 2>/dev/null)
echo "filesystem token-shaped files under $roots(grep exit $?): ${hits:-none}"

echo "--- relay probes against $relay"
probe() { # label, curl args...
  local label=$1; shift
  rm -f /tmp/h /tmp/b
  local status leak
  status=$(curl -s --max-time 20 -D /tmp/h -o /tmp/b -w '%{http_code}' "$@" 2>/dev/null)
  leak=$(cat /tmp/h /tmp/b 2>/dev/null | grep -cE "$TOKEN_RE")
  echo "$label: status=$status token-shaped-in-response=$leak body=$(head -c 160 /tmp/b 2>/dev/null | tr '\n' ' ')"
}
probe "GET /" "$relay/"
probe "GET /v1/models (no auth sent)" "$relay/v1/models"
probe "GET /v1/models (garbage auth)" -H 'authorization: Bearer garbage' -H 'x-api-key: garbage' "$relay/v1/models"
probe "POST /v1/messages bad json" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' --data '{not json' "$relay/v1/messages"
probe "POST /v1/messages bad model" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' --data '{"model":"no-such-model","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' "$relay/v1/messages"
probe "GET /v1/models Host: example.com" -H 'Host: example.com' "$relay/v1/models"
probe "absolute-form via relay as proxy (IMDS)" --proxy "$relay" http://169.254.169.254/metadata/instance?api-version=2021-02-01
probe "absolute-form via relay as proxy (example.com)" --proxy "$relay" http://example.com/v1/x
probe "path //example.com/v1/models" --path-as-is "$relay//example.com/v1/models"
probe "path /v1/../../etc/passwd" --path-as-is "$relay/v1/../../etc/passwd"
probe "path /v1/@example.com" --path-as-is "$relay/v1/@example.com"
probe "CONNECT via relay" --proxytunnel --proxy "$relay" https://example.com/

echo "--- host reachability"
node "$here/scan.mjs"
echo "IMDS managed identity token: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Metadata: true' 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/' 2>&1)"
echo "IMDS direct: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Metadata: true' 'http://169.254.169.254/metadata/instance?api-version=2021-02-01' 2>&1)"
echo "egress example.com: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://example.com 2>&1)"
