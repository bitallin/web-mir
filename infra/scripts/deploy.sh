#!/usr/bin/env bash
# Deploy immutable images and record the tag for rollback (ADR-023).
#
# Required:
#   IMAGE_TAG, POSTGRES_PASSWORD, INTERNAL_ADMIN_TOKEN, PUBLIC_ORIGINS
# Optional:
#   COMPOSE_FILE, IMAGE_PREFIX, BUILD=1, WAIT_TIMEOUT
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker/compose.prod.yml"}
STATE_DIR=${STATE_DIR:-"$ROOT_DIR/infra/docker/data"}
WAIT_TIMEOUT=${WAIT_TIMEOUT:-180}

: "${IMAGE_TAG:?IMAGE_TAG is required (for example git-$(git rev-parse --short HEAD) )}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${INTERNAL_ADMIN_TOKEN:?INTERNAL_ADMIN_TOKEN is required}"
: "${PUBLIC_ORIGINS:?PUBLIC_ORIGINS is required}"

if [[ "$IMAGE_TAG" == "latest" ]]; then
  echo "refusing to deploy the mutable 'latest' tag" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"

compose=(docker compose -f "$COMPOSE_FILE")
build_args=()
if [[ "${BUILD:-false}" == "true" ]]; then
  build_args+=(--build)
fi

echo "==> validating compose configuration"
"${compose[@]}" config --quiet

echo "==> deploying IMAGE_TAG=$IMAGE_TAG"
"${compose[@]}" up -d --remove-orphans "${build_args[@]}" --wait --wait-timeout "$WAIT_TIMEOUT"

echo "==> checking internal metrics"
"${compose[@]}" exec -T control-api node -e \
  "fetch('http://127.0.0.1:3000/metrics/prometheus').then(async (r) => { if (!r.ok) process.exit(1); const t = await r.text(); process.exit(t.includes('web_legend_control_api_up') ? 0 : 1); }).catch(() => process.exit(1))"
"${compose[@]}" exec -T game-server node -e \
  "fetch('http://127.0.0.1:2567/metrics/prometheus').then(async (r) => { if (!r.ok) process.exit(1); const t = await r.text(); process.exit(t.includes('web_legend_game_server_up') ? 0 : 1); }).catch(() => process.exit(1))"

echo "==> checking edge"
"${compose[@]}" exec -T edge wget -q -O /dev/null http://127.0.0.1:8080/healthz

previous=""
if [[ -f "$STATE_DIR/current-tag" ]]; then
  previous=$(cat "$STATE_DIR/current-tag")
fi
if [[ -n "$previous" && "$previous" != "$IMAGE_TAG" ]]; then
  printf '%s\n' "$previous" > "$STATE_DIR/previous-tag"
fi
printf '%s\n' "$IMAGE_TAG" > "$STATE_DIR/current-tag"

echo "==> deployed $IMAGE_TAG"
if [[ -n "$previous" && "$previous" != "$IMAGE_TAG" ]]; then
  echo "    previous tag recorded for rollback: $previous"
fi
