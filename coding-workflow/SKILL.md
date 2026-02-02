---
name: coding-workflow
description: Execute programming/development tasks in /home/matt/clawd with a consistent workflow: plan changes, implement safely, run tests or smoke checks, update Kanban tasks/subtasks, and produce an acceptance checklist. Use when the user asks to build features, fix bugs, refactor code, add endpoints/UI, adjust Docker/systemd, or otherwise change code.
---

# Coding Workflow (Dev Execution)

A strict-but-lightweight workflow for any **coding** work in this workspace.

## Non‑negotiable rules

5) **When the user specifies "use Claude Code CLI"**: default to **non-interactive** mode for reliability.
   - Prefer: `claude -p --output-format json ...`
   - Use interactive TUI only if the user explicitly asks for interactive or if the task truly requires back-and-forth.

1) **Do not push to git unless the user explicitly asks**.
   - If you need to commit locally, do it (optional) but do not `git push` without an explicit instruction.

2) **Always run at least a smoke test** before declaring done.

3) **Always update Kanban** (task + subtasks) for any work you execute.

4) **Always output an Acceptance Checklist** (what the human should click/run to verify).

## Parallel Dev SOP (tmux + git worktree)

Use this when running multiple development tasks concurrently.

- **One tmux session per project** (session name = project name, e.g., `kanban`, `mail-filter`).
- **Use git worktrees** to isolate concurrent tasks within a project.
- **Directory convention:** `<project>/worktrees/<task-name>-<role>` where role is `impl` or `spec`.
- **CLI split:**
  - Claude Code → implementation/refactor/bugfix (impl worktree)
  - Gemini CLI → specs/tests/acceptance checklist (spec worktree)

Helper script:
```bash
bash ./skills/coding-workflow/scripts/dev_parallel_setup.sh --project <dir> --task <task-name>
```

Full SOP: see `references/parallel-sop.md`.

## Workflow (follow in order)

### Step 0 — Identify the target
- Which project/path? (examples: `project-kanban/`, `ServiceMonitor/`, `scripts/`)
- Which Kanban task id (UUID) is the work associated with?

If the user didn’t specify a task id, create/update discussion in the relevant task or ask for the id.

### Step 1 — Plan (small + explicit)
Before touching files, state:
- goal
- files likely to change
- smoke test you will run
- acceptance checklist you expect to deliver

Keep it short; avoid bikeshedding.

### Step 2 — Implement
- Make minimal, incremental edits.
- Prefer backwards-compatible changes.
- Avoid destructive actions.

### Step 3 — Smoke test (minimum)
Run one of:

- **Node/Express project**: 
  - `node -c <changed js>` when applicable
  - restart service if needed
  - `curl -fsS http://127.0.0.1:<port>/api/...`

- **.NET project**:
  - `dotnet build`
  - optionally `dotnet test` if tests exist

- **Scripts/tools**:
  - run the script with a safe sample input / `--help`

Prefer using the bundled helper script:
```bash
bash ./skills/coding-workflow/scripts/dev_smoke.sh --path <project-path>
```

### Step 4 — Update Kanban
Update via the bundled script (preferred):

```bash
node ./skills/coding-workflow/scripts/kanban_update.js --task <uuid> \
  --set-status review \
  --done-subtask "<subtask title snippet>" \
  --append-discussion "需要主人驗收：..."
```

Rules:
- Mark completed subtasks done.
- Add **at most one** discussion entry for human verification.
- Move status:
  - to **review** if human verification is required
  - to **done** only when verification is not required

### Step 5 — Report
Your final message must include:
- what changed (high level)
- where (files)
- smoke test result
- **Acceptance Checklist** (bullets)

## References
- Acceptance checklist template: `references/acceptance-checklist.md`
