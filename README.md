# OpenClaw Custom Skills 🦞

This directory contains specialized skills tailored for this OpenClaw agent instance (**妲己**).
These skills define the agent's core capabilities, workflow standards, and integration with local tools.

## Skills List

### 🤖 Development & Coding
- **[claude-code](./claude-code/SKILL.md)**:
  - Integrates Anthropic's `claude` CLI for autonomous coding.
  - Supports **Single-Shot (`-p`)** and **Interactive** modes.
  - Implements **OpenSpec (SDD)** workflow for rigorous spec-driven development.
  - Features JSON output parsing and Wake Event auto-notification.

- **[coding-workflow](./coding-workflow/SKILL.md)**:
  - Defines the strict "Plan → Implement → Test → Report" SOP.
  - Enforces Kanban updates and smoke testing.
  - Provides helper scripts for parallel development.

### 🧠 Decision Making
- **[model-priority](./model-priority/SKILL.md)**:
  - Logic for selecting the best AI model (GPT-5.2 vs Claude 3.5 vs Gemini) based on task type.
  - Handles fallback strategies and quota management.

- **[pm-orchestrator](./pm-orchestrator/SKILL.md)**:
  - Acts as a Project Manager to break down large user requests.
  - Assigns sub-tasks to sub-agents or specific tools.

### 🛠 Operations
- **[kanban-ops](./kanban-ops/SKILL.md)**:
  - Tools for managing the local `project-kanban` service (port 3001).
  - Supports database backups, status checks, and data migration.

## Usage
These skills are automatically loaded by OpenClaw. The agent refers to them to determine *how* to execute complex requests (e.g., "Use Claude to fix this bug" -> loads `claude-code`).
