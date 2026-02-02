#!/usr/bin/env bash
set -euo pipefail

PATH_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      PATH_ARG="$2"; shift 2;;
    *)
      echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "$PATH_ARG" ]]; then
  echo "Usage: dev_smoke.sh --path <project-path>" >&2
  exit 2
fi

ROOT="/home/matt/clawd"
TARGET="$ROOT/$PATH_ARG"

if [[ ! -d "$TARGET" ]]; then
  echo "Path not found: $TARGET" >&2
  exit 1
fi

cd "$TARGET"

echo "[smoke] target=$TARGET"

# Node project
if [[ -f package.json ]]; then
  echo "[smoke] detected node project"
  if command -v node >/dev/null 2>&1; then
    # syntax check common entrypoints if present
    [[ -f server.js ]] && node -c server.js || true
    [[ -f index.js ]] && node -c index.js || true
  fi
  # best-effort: run npm test if defined
  if command -v npm >/dev/null 2>&1; then
    if node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.test?0:1)" >/dev/null 2>&1; then
      echo "[smoke] npm test"
      npm test
    else
      echo "[smoke] no npm test script (ok)"
    fi
  fi
  echo "[smoke] node smoke ok"
  exit 0
fi

# .NET project
if compgen -G "*.sln" > /dev/null || compgen -G "*.csproj" > /dev/null; then
  echo "[smoke] detected dotnet project"
  if command -v dotnet >/dev/null 2>&1; then
    dotnet build
    echo "[smoke] dotnet build ok"
    exit 0
  else
    echo "dotnet not found" >&2
    exit 1
  fi
fi

echo "[smoke] unknown project type (no package.json / csproj)."
echo "[smoke] ok (nothing to run)"
