#!/usr/bin/env bash
set -euo pipefail

# Setup parallel dev environment for one project using:
# - one tmux session per project
# - two git worktrees per task: impl/spec
#
# Example:
#   bash ./skills/coding-workflow/scripts/dev_parallel_setup.sh --project project-kanban --task kanban-cli

PROJECT=""
TASK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2;;
    --task) TASK="$2"; shift 2;;
    -h|--help)
      echo "Usage: dev_parallel_setup.sh --project <dir> --task <task-name>"; exit 0;;
    *)
      echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "$PROJECT" || -z "$TASK" ]]; then
  echo "Usage: dev_parallel_setup.sh --project <dir> --task <task-name>" >&2
  exit 2
fi

ROOT="/home/matt/clawd"
PROJ_DIR="$ROOT/$PROJECT"

if [[ ! -d "$PROJ_DIR" ]]; then
  echo "Project directory not found: $PROJ_DIR" >&2
  exit 1
fi

cd "$PROJ_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repo: $PROJ_DIR" >&2
  exit 1
fi

SESSION_NAME=$(basename "$PROJECT" | sed 's/[^a-zA-Z0-9_-]/-/g' | tr '[:upper:]' '[:lower:]')
WT_BASE="$PROJ_DIR/worktrees"
WT_IMPL="$WT_BASE/${TASK}-impl"
WT_SPEC="$WT_BASE/${TASK}-spec"

mkdir -p "$WT_BASE"

ensure_worktree() {
  local role="$1"
  local dir="$2"
  local branch="feat/${TASK}-${role}"

  if [[ -d "$dir" ]]; then
    echo "[ok] worktree exists: $dir"
    return
  fi

  echo "[add] worktree $role -> $dir (branch $branch)"
  git worktree add -b "$branch" "$dir"
}

ensure_worktree impl "$WT_IMPL"
ensure_worktree spec "$WT_SPEC"

echo

echo "[tmux] session=$SESSION_NAME"
if command -v tmux >/dev/null 2>&1; then
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "[ok] tmux session exists: $SESSION_NAME"
  else
    echo "[new] tmux session: $SESSION_NAME"
    tmux new -d -s "$SESSION_NAME" -c "$WT_IMPL" -n impl
    tmux new-window -t "$SESSION_NAME" -c "$WT_SPEC" -n spec
  fi
  echo "Attach with: tmux a -t $SESSION_NAME"
else
  echo "tmux not found; skipping tmux setup" >&2
fi

echo

echo "Next commands (copy/paste):"
cat <<EOF
# (impl) Claude Code
cd "$WT_IMPL"
claude -p --output-format json "請依照 Kanban 任務進行實作：${TASK}"

# (spec) Gemini CLI
cd "$WT_SPEC"
gemini "請產出規格/測試案例/驗收清單：${TASK}"
EOF
