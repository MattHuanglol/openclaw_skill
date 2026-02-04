---
name: remember-idea
description: Store a pasted idea into Project Kanban 點子庫 (Idea Bank). Use when the user says "加入點子/記憶點子" or pastes a long idea/article and wants it saved with both raw text preserved and a TL;DR summary, plus an initial 妲己 AI 評註/討論 entry.
---

# Remember Idea (記憶點子)

## What to do when the user pastes an idea

### 1) Capture both Raw + Summary
- **Raw**: Preserve the user’s original full text (verbatim).
- **Summary**: Create a compact TL;DR for fast scanning.

**Preferred storage (when supported by Idea Bank):**
- `rawText` = full original text
- `summary` = TL;DR

**Fallback (if rawText/summary fields are not available yet):**
- Store TL;DR in `description`
- Append raw text under a separator:
  - `--- 原文 RAW ---` (verbatim)

### 2) Create the idea in Idea Bank
- Use Kanban API `POST /api/interests`.
- Set:
  - `title`: short, searchable title
  - `url`: if provided
  - `targetAudience`, `painPoints`, `status`: optional

### 3) Add AI 評註 / 討論 (initial)
After creating the idea, append an initial discussion entry via:
- `POST /api/interests/:id/discussions`

Use the structured template:
- 【我先理解的版本】
- 【亮點 / 可能價值】
- 【風險 / 需要釐清】
- 【建議下一步（最小可行）】
- 【我想問你的問題】(1–3)

### 4) Reply back to the user
Return:
- created idea id
- title
- any link
- confirm AI 評註已建立

## Deterministic Runner (recommended)
Use the script:
- `scripts/remember_idea.js`

Examples:
```bash
# Minimal
node /home/matt/clawd/skills/custom/remember-idea/scripts/remember_idea.js \
  --title "Claude Code 進階技巧" \
  --url "https://example.com" \
  --raw-file ./raw.txt \
  --summary "..."

# Read raw from stdin
cat raw.txt | node /home/matt/clawd/skills/custom/remember-idea/scripts/remember_idea.js --title "..." --summary "..."
```

Env:
- `KANBAN_BASE_URL` (default: `http://localhost:3001`)
