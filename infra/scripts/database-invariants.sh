#!/usr/bin/env bash
# Asset/economy invariant report for Alpha acceptance. Exits non-zero when any
# "must be zero" invariant is violated. Requires DATABASE_URL; uses a local
# psql when present and the pinned PostgreSQL image otherwise.
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PG_TOOL_IMAGE=${PG_TOOL_IMAGE:-docker.m.daocloud.io/postgres@sha256:a9abf4275f9e99bff8e6aed712b3b7dfec9cac1341bba01c1ffdfce9ff9fc34a}
SQL="$ROOT_DIR/infra/scripts/database-invariants.sql"
# Default to a rolling "latest" file so a routine check never overwrites a
# historical phase report (AGENTS §11: history is append-only).
OUT=${1:-"$ROOT_DIR/docs/phase-reports/database-invariants.txt"}

if [[ -z "${DATABASE_URL:-}" && -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi
: "${DATABASE_URL:?DATABASE_URL is required}"

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$@"
  else
    docker run --rm -i --network host "$PG_TOOL_IMAGE" psql "$@"
  fi
}

mkdir -p "$(dirname "$OUT")"
{
  echo "# database invariants, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Feed SQL on stdin: the docker fallback has no repository mount.
  run_psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -f - < "$SQL"
} > "$OUT"

failures=0
check_zero() {
  local name=$1
  local query=$2
  local value
  value=$(run_psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$query")
  printf 'assert %s=%s\n' "$name" "$value" | tee -a "$OUT"
  if [[ "$value" != "0" ]]; then
    failures=$((failures + 1))
  fi
}

check_zero wallet_ledger_mismatch \
  "select count(*) from wallets w left join (select character_id, sum(delta) total from currency_ledger group by character_id) l on l.character_id=w.character_id where coalesce(l.total,0)<>w.balance"
check_zero negative_wallets "select count(*) from wallets where balance < 0"
check_zero dup_equip_slot "select count(*) from (select character_id, equip_slot from item_instances where container='equipment' group by character_id, equip_slot having count(*)>1) d"
check_zero dup_inv_slot "select count(*) from (select character_id, slot_index from item_instances where container='inventory' group by character_id, slot_index having count(*)>1) d"
check_zero ground_without_drop "select count(*) from item_instances i left join world_drops d on d.item_instance_id=i.id where i.container='ground' and d.id is null"
check_zero claimed_but_ground "select count(*) from world_drops d join item_instances i on i.id=d.item_instance_id where d.claimed_at is not null and i.container='ground'"
check_zero stale_expired_open_ground "select count(*) from world_drops d join item_instances i on i.id=d.item_instance_id where d.claimed_at is null and d.expires_at < now() - interval '2 minutes' and i.container='ground'"

if [[ "$failures" -ne 0 ]]; then
  echo "invariant failures: $failures (see $OUT)" >&2
  exit 1
fi
echo "all asset invariants passed (report: $OUT)"
