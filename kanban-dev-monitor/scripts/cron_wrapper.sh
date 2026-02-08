#!/usr/bin/env bash
# Wrapper: run kanban dev monitor outside OpenClaw session lock.
# If events detected, send via openclaw sessions send (minimal lock time).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

OUTPUT=$(node "$SCRIPT_DIR/kanban_dev_monitor.js" 2>&1) || true

# NO_REPLY or empty = nothing to report
if [[ "$OUTPUT" == "NO_REPLY" ]] || [[ -z "$OUTPUT" ]]; then
  exit 0
fi

# Only send if there are actual events
openclaw sessions send --agent main --message "📋 Kanban Monitor:
$OUTPUT"
