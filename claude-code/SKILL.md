---
name: claude-code
description: Run Anthropic's `claude` CLI for agentic coding. Supports single-shot commands (-p) and interactive sessions. Use this for complex refactoring, bug fixing, or when you need Claude 3.7 Sonnet's specialized coding agent capabilities.
---

# Claude Code Skill 🤖

This skill integrates the official `claude` CLI tool into OpenClaw, allowing you to leverage Anthropic's specialized coding agent.

## 🛠 Prerequisites

- **Install**: `npm install -g @anthropic-ai/claude-code`
- **Auth**: Run `claude auth login` once (interactive) or ensure `ANTHROPIC_API_KEY` is set.

## 🚀 Usage Patterns

### 1. Single-Shot Task (Best for Agents)
Use the `-p` (prompt) flag to execute a task and exit. This is the preferred method for OpenClaw automation.

```bash
# Basic usage
claude -p "Refactor src/utils.js to use arrow functions"

# Auto-approve (YOLO mode) - WARNING: Risks applying changes without review
claude -p "Fix the lint errors in app.tsx" --dangerously-skip-permissions
```

**Tips:**
- Always be specific about file paths.
- Combine with `--dangerously-skip-permissions` if you want the agent to edit files without asking (use with caution).

### 2. Interactive Session
Start a persistent session to discuss code or run multiple steps.

```javascript
// Start the session (must use pty=true)
exec({ command: "claude", pty: true });

// Send commands
process({ action: "write", data: "/bug Fix the crash in main.rs\n" });
```

## ⚙️ Configuration

- **Compact Mode**: Use `--compact` to reduce output noise.
- **Verbose**: Use `--verbose` for debugging.

## 📋 Example Workflow

1.  **Read Context**: The agent reads files.
2.  **Delegate**: Agent calls `claude -p "Analyze these files and fix X"`.
3.  **Review**: Agent checks the changes made by Claude Code.
