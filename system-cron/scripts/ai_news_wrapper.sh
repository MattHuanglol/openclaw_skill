#!/usr/bin/env bash
# AI News: send task to main session (needs web_search tool)
set -euo pipefail
openclaw sessions send --agent main --message "📰 [系統排程] 請準備每日 AI 新聞簡報（繁體中文），用 web_search 搜尋最新 AI 新聞，選 3-6 則重點整理後用 message tool 發送給主人（target=894437982）。"
