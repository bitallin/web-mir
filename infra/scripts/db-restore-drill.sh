#!/usr/bin/env bash
# Restore a backup into a throwaway database and verify it against the
# manifest captured at backup time (ADR-023). Never targets the primary DB.
#
# Usage: DATABASE_URL=... infra/scripts/db-restore-drill.sh <backup.dump> <manifest.json>
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PG_TOOL_IMAGE=${PG_TOOL_IMAGE:-docker.m.daocloud.io/postgres@sha256:a9abf4275f9e99bff8e6aed712b3b7dfec9cac1341bba01c1ffdfce9ff9fc34a}
: "${DATABASE_URL:?DATABASE_URL is required}"

DUMP=${1:-}
MANIFEST=${2:-}
if [[ -z "$DUMP" || -z "$MANIFEST" ]]; then
  echo "usage: $0 <backup.dump> <manifest.json>" >&2
  exit 1
fi
if [[ ! -f "$DUMP" || ! -f "$MANIFEST" ]]; then
  echo "backup or manifest file not found" >&2
  exit 1
fi
if [[ "${NODE_ENV:-}" == "production" ]]; then
  echo "refusing to run a restore drill with NODE_ENV=production" >&2
  exit 1
fi

DRILL_DB=${DRILL_DB:-"web_legend_drill_$(date -u +%Y%m%d_%H%M%S)"}
if [[ ! "$DRILL_DB" =~ ^web_legend_drill_[a-z0-9_]+$ ]]; then
  echo "unsafe drill database name: $DRILL_DB" >&2
  exit 1
fi
RESTORE_URL="${DATABASE_URL%/*}/$DRILL_DB"

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$@"
  else
    docker run --rm -i --network host "$PG_TOOL_IMAGE" psql "$@"
  fi
}

echo "==> creating drill database $DRILL_DB"
run_psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "create database \"$DRILL_DB\""

cleanup() {
  echo "==> dropping drill database $DRILL_DB"
  run_psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "drop database if exists \"$DRILL_DB\" with (force)" || true
}
trap cleanup EXIT

echo "==> restoring $DUMP"
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" --exit-on-error "$DUMP"
else
  # Omit the filename: pg_restore then reads the custom-format archive from
  # stdin ("-" would be treated as a literal filename).
  docker run --rm -i --network host "$PG_TOOL_IMAGE" \
    pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" --exit-on-error < "$DUMP"
fi

echo "==> verifying restored data"
(
  cd "$ROOT_DIR"
  pnpm exec tsx infra/scripts/verifyRestore.ts --check "$MANIFEST" "$RESTORE_URL"
)

echo "restore drill passed for $DRILL_DB"
