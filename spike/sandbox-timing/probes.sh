#!/usr/bin/env bash
# Probes run inside the sandbox. A token found is printed only redacted.
set +e
echo "whoami: $(whoami) uid=$(id -u)"
echo "env names: $(env | cut -d= -f1 | sort | tr '\n' ' ')"
echo "token-like env: $(env | grep -iE 'token|secret|pat|auth|key' | cut -d= -f1 | tr '\n' ' ')"
echo "extraheader: $(git config --get-regexp 'http\..*extraheader' | sed -E 's/(AUTHORIZATION: basic ).{6}.*/\1<redacted>/I')"
echo "credential helper: $(git config --get-regexp credential)"
echo "git-credentials file: $(ls ~/.git-credentials 2>&1)"
echo "runner _temp readable: $(ls /home/runner/work/_temp 2>&1 | head -5 | tr '\n' ' ')"
echo "proc 1 environ token-like count: $(tr '\0' '\n' < /proc/1/environ 2>&1 | grep -ciE 'token|secret')"
echo "processes visible: $(ls /proc | grep -cE '^[0-9]+$')"
echo "egress api.github.com: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://api.github.com 2>&1)"
echo "egress example.com: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://example.com 2>&1)"
echo "docker socket: $(ls -la /var/run/docker.sock 2>&1)"
echo "sudo: $(sudo -n true 2>&1 && echo yes || echo no)"
