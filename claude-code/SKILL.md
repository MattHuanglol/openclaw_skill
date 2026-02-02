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
# Best Practice: JSON output + Auto-approve
# Wait for the JSON response before proceeding.
claude -p "Refactor src/utils.js" --dangerously-skip-permissions --output-format json
```

**Tips:**
- Always be specific about file paths.
- Combine with `--dangerously-skip-permissions` to bypass prompts.
- Use `--output-format json` to get machine-readable results (success/failure).

### 2. Interactive Session
Start a persistent session to discuss code or run multiple steps.

```javascript
// Start the session (must use pty=true)
exec({ command: "claude", pty: true });

// Send commands
process({ action: "write", data: "/bug Fix the crash in main.rs\n" });
```

### 3. Background Task with Auto-Notification (Recommended)
For long-running tasks, chain a system event to wake the agent upon completion.

```bash
claude -p "Refactor db.js" --output-format json && \
openclaw system event --text "claude done: Refactor db.js" --mode now
```

**Why?** This ensures the agent wakes up immediately to process the result.

## ⚙️ Configuration

- **Compact Mode**: Use `--compact` to reduce output noise.
- **Verbose**: Use `--verbose` for debugging.

## 🏗 Spec-Driven Workflow (OpenSpec)

Use [OpenSpec](https://github.com/Fission-AI/OpenSpec) to plan changes before coding.

### Setup
`npm install -g @fission-ai/openspec`

### Workflow
1. **Initialize** (Once per project):
   ```bash
   cd project-root && openspec init
   ```
2. **New Feature**:
   ```bash
   openspec new <feature-name>
   # This creates openspec/changes/<feature-name>/ with templates
   ```
3. **Plan**:
   ```bash
   claude -p "Read openspec/changes/<feature-name>/proposal.md. Fill in the details, then generate specs/requirements.md and tasks.md based on it." --output-format json
   ```
4. **Implement**:
   ```bash
   claude -p "Read openspec/changes/<feature-name>/tasks.md. Implement the tasks one by one. Update the checklist in tasks.md as you go." --output-format json
   ```

## 📋 Example Workflow

1.  **Read Context**: The agent reads files.
2.  **Delegate**: Agent calls `claude -p "Analyze these files and fix X"`.
3.  **Review**: Agent checks the changes made by Claude Code.
