---
name: model-priority
description: Manage model selection priority and usage guidance. Use when the user asks which model to use, when switching models for specific tasks, or when managing usage limits and fallbacks. Includes a full list of available models and their typical use cases.
---

# Model Priority & Selection Guide

This skill standardizes how to select the best AI model for different tasks within Matt’s OpenClaw environment.

## Available Models List

| Provider/ID | Display Name | Best For |
| :--- | :--- | :--- |
| `google-antigravity/gemini-3-pro-high` | Gemini 3 Pro (High) | Complex reasoning, creative writing, high-accuracy tasks. |
| `google-antigravity/gemini-3-pro-low` | Gemini 3 Pro (Low) | Faster pro-level reasoning with lower token cost/latency. |
| `google-antigravity/gemini-3-flash` | Gemini 3 Flash | High speed, summarizing, routine data extraction. |
| `google-antigravity/claude-sonnet-4-5` | Claude 3.5 Sonnet | Programming, complex instructions, logical consistency. |
| `google-antigravity/claude-sonnet-4-5-thinking` | Claude 3.5 Sonnet (Think) | Deep technical analysis, debugging, planning. |
| `google-antigravity/claude-opus-4-5-thinking` | Claude 3.5 Opus (Think) | Maximum intelligence for extremely complex problems. |
| `google-antigravity/gpt-oss-120b-medium` | GPT-OSS 120B | Open-source large model alternative for general tasks. |
| `google-gemini-cli/gemini-3-pro-preview` | Gemini Pro (CLI) | High-priority for one-shot Q&A and coding tasks via direct OAuth. |
| `google-gemini-cli/gemini-2.5-pro` | Gemini 2.5 Pro (CLI) | Solid alternative for general tasks via direct CLI OAuth. |
| `google-gemini-cli/gemini-2.5-flash` | Gemini 2.5 Flash (CLI) | High-speed, cost-effective 2.5 series model via CLI. |
| `google-gemini-cli/gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite (CLI) | Ultra-fast, lightweight model for quick tasks via CLI. |
| `google-gemini-cli/gemini-3-flash-preview` | Gemini Flash (CLI) | Fast CLI-based tasks and status checks. |
| `openai-codex/gpt-5.2` | Codex (ChatGPT) | General coding and multi-turn conversation (Team plan). |

## Selection Logic (Priority)

1.  **日常/一般任務**
    *   **主要**：`openai-codex/gpt-5.2` (ChatGPT)
    *   **備援**：`google-antigravity/gemini-3-pro-low`

2.  **程式開發與重構**
    *   **主要**：`google-antigravity/claude-sonnet-4-5`
    *   **備援**：`openai-codex/gpt-5.2`

3.  **背景任務 (Cron/Heartbeat)**
    *   **主要**：`google-antigravity/gemini-3-flash`
    *   **備援**：`google-gemini-cli/gemini-3-flash-preview`

4.  **複雜規劃與架構設計**
    *   **主要**：`google-antigravity/gemini-3-pro-high` 或 `claude-opus-4-5-thinking`
    *   **備援**：`google-antigravity/claude-sonnet-4-5-thinking` 或 `google-gemini-cli/gemini-3-pro-preview`

## How to Switch Models

- **Session Switch**: `/model <provider/id>`
- **Background Switch (Cron)**: Update the `payload.model` field in the cron job configuration.

## Usage Limit Management

If a model reports a usage limit error (e.g., "ChatGPT usage limit hit"):
1. Check `📊 session_status` to see remaining credits for other providers.
2. Manually switch the session or background job to a provider with 100% capacity (usually `google-antigravity`).
