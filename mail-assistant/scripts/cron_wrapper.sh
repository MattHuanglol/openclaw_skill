#!/usr/bin/env bash
# Wrapper: run mail-assistant scripts outside OpenClaw session lock.
# Usage: cron_wrapper.sh <important|summary>
# If output != NO_REPLY, send result via openclaw sessions send (minimal lock time).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-important}"

case "$ACTION" in
  important)
    OUTPUT=$(node "$SCRIPT_DIR/notify_important_unread.js" 2>&1) || true
    ;;
  summary)
    OUTPUT=$(node "$SCRIPT_DIR/notify_daily_summary.js" 2>&1) || true
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac

# If NO_REPLY, silently exit (no lock touched)
if [[ "$OUTPUT" == "NO_REPLY" ]] || [[ -z "$OUTPUT" ]]; then
  exit 0
fi

# Send result to main agent (occupies lock for <1s)
openclaw sessions send --agent main --message "📧 Mail Assistant ($ACTION):
$OUTPUT

請整理成中文通知主人。如果是系統異常信，讀取信件內文提取錯誤細節。"
