# Parallel Dev SOP (tmux + git worktree)

Goal: run multiple coding tasks in parallel without stepping on files.

## Decisions
- **tmux session name:** use the *project name* (e.g., `kanban`, `mail-filter`, `servicemonitor`).
- **Worktree location:** `<project>/worktrees/<task-name>-<role>`
  - role: `impl` (Claude Code) / `spec` (Gemini)

## Recommended pattern

### 1) One tmux session per project

```bash
tmux new -s kanban
# later: tmux a -t kanban
```

Inside the session, keep separate windows/panes:
- `impl` window: Claude Code CLI (implementation)
- `spec` window: Gemini CLI (spec/tests/acceptance)

### 2) One git worktree per concurrent task (within the project)

From the project root:

```bash
cd /home/matt/clawd/<project>
mkdir -p worktrees

# Implementation worktree
TASK=my-task
mkdir -p worktrees

git worktree add -b feat/${TASK}-impl worktrees/${TASK}-impl

# Spec/Test worktree

git worktree add -b feat/${TASK}-spec worktrees/${TASK}-spec
```

Run each CLI inside its own worktree to avoid conflicts.

### 3) CLI split of responsibilities
- **Claude Code** (impl worktree): implement/refactor/fix bugs
- **Gemini CLI** (spec worktree): requirements, test cases, acceptance checklist

### 4) Cleanup
When done:
```bash
git worktree remove worktrees/${TASK}-impl
git worktree remove worktrees/${TASK}-spec
# optionally delete branches if merged
```

## Notes
- If the repo already has uncommitted changes, commit/stash before adding worktrees.
- If a worktree already exists, reuse it; do not recreate blindly.
