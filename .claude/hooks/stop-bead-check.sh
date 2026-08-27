#!/usr/bin/env bash
# Stop hook — a session that ends with beads still in_progress orphans its lane:
# the next orchestrator reads those beads as busy and never re-dispatches them.
# Deterministic (asks `bd`, never guesses from the transcript) and fails OPEN on
# any error, including a missing bd or jq.
#
# Output contract: print {"decision":"block","reason":...} to block the stop;
# print nothing / exit 0 to allow it.
set -u

command -v jq >/dev/null 2>&1 || exit 0
command -v bd >/dev/null 2>&1 || exit 0

input=$(cat)

# Loop guard: on the re-invocation after a block, Claude Code sets
# stop_hook_active=true — let the session stop rather than loop forever.
if [ "$(jq -r '.stop_hook_active // false' <<<"$input" 2>/dev/null)" = "true" ]; then
  exit 0
fi

ids=$(bd list --status=in_progress --json 2>/dev/null | jq -r '[.[].id] | join(", ")' 2>/dev/null)

if [ -n "${ids:-}" ]; then
  jq -nc --arg ids "$ids" \
    '{decision:"block", reason:("These beads are still in_progress and need a handoff: " + $ids + ". For each one: `bd close <id>` if the work is done, `bd update <id> --status=blocked` with the reason if it is stuck, or `bd update <id> --status=open` to release it for another lane. Then flush with `bd export -o .beads/issues.jsonl`.")}'
fi
exit 0
