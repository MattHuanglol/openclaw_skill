#!/usr/bin/env bash
set -euo pipefail

# Run full dump -> core dump -> markdown report.
# Safe: read-only SELECTs only.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DUMP_OUT="${DUMP_OUT:-/home/matt/clawd/tmp/mssql-schema-dump.json}"
REPORT_OUT="${REPORT_OUT:-/home/matt/clawd/tmp/mssql-schema-report.md}"
CORE_TOP="${CORE_TOP:-20}"
CORE_DEPTH="${CORE_DEPTH:-1}"

node "${ROOT_DIR}/scripts/mssql_schema_dump.js" \
  --out "${DUMP_OUT}" \
  --core-top "${CORE_TOP}" \
  --core-depth "${CORE_DEPTH}"

node "${ROOT_DIR}/scripts/mssql_schema_report.js" \
  --in "${DUMP_OUT}" \
  --out "${REPORT_OUT}"

echo "OK" >&2
echo "- dump:   ${DUMP_OUT}" >&2
echo "- report: ${REPORT_OUT}" >&2
