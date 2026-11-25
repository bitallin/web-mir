#!/usr/bin/env bash
# PostgreSQL logical backup (custom format) plus a content/asset manifest.
#
# Requires DATABASE_URL. Uses a local pg_dump when available; otherwise runs
# the pinned PostgreSQL image with host networking, which reaches the dev
# database through the container gateway.
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PG_TOOL_IMAGE=${PG_TOOL_IMAGE:-docker.m.daocloud.io/postgres@sha256:a9abf4275f9e99bff8e6aed712b3b7dfec9cac1341bba01c1ffdfce9ff9fc34a}
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/infra/docker/data/backups"}
: "${DATABASE_URL:?DATABASE_URL is required}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$BACKUP_DIR/web_legend-$STAMP"
DUMP="$BASE.dump"
MANIFEST="$BASE.manifest.json"

echo "==> dumping to $DUMP"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$DATABASE_URL"
else
  docker run --rm --network host "$PG_TOOL_IMAGE" \
    pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$DUMP"
fi

echo "==> writing manifest $MANIFEST"
(
  cd "$ROOT_DIR"
  pnpm exec tsx infra/scripts/verifyRestore.ts --manifest "$MANIFEST" "$DATABASE_URL"
)

echo "==> hashing"
SHA256=$(sha256sum "$DUMP" | awk '{print $1}')
printf '%s  %s\n' "$SHA256" "$(basename "$DUMP")" > "$BASE.dump.sha256"

echo "backup: $DUMP"
echo "manifest: $MANIFEST"
echo "sha256: $SHA256"
