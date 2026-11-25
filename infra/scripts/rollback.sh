#!/usr/bin/env bash
# Roll the application images back to the previous successfully deployed tag.
# Database migrations are never reversed here (Expand -> Migrate -> Contract).
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker/compose.prod.yml"}
STATE_DIR=${STATE_DIR:-"$ROOT_DIR/infra/docker/data"}
WAIT_TIMEOUT=${WAIT_TIMEOUT:-180}

TARGET_TAG=${1:-}
if [[ -z "$TARGET_TAG" ]]; then
  if [[ ! -f "$STATE_DIR/previous-tag" ]]; then
    echo "no previous tag recorded; pass the target tag explicitly" >&2
    exit 1
  fi
  TARGET_TAG=$(cat "$STATE_DIR/previous-tag")
fi

if [[ "$TARGET_TAG" == "latest" ]]; then
  echo "refusing to roll back to the mutable 'latest' tag" >&2
  exit 1
fi

current=""
if [[ -f "$STATE_DIR/current-tag" ]]; then
  current=$(cat "$STATE_DIR/current-tag")
fi

export IMAGE_TAG="$TARGET_TAG"
compose=(docker compose -f "$COMPOSE_FILE")

echo "==> rolling back from ${current:-unknown} to $TARGET_TAG"
"${compose[@]}" config --quiet
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout "$WAIT_TIMEOUT"

printf '%s\n' "$TARGET_TAG" > "$STATE_DIR/current-tag"
if [[ -n "$current" && "$current" != "$TARGET_TAG" ]]; then
  printf '%s\n' "$current" > "$STATE_DIR/previous-tag"
fi

echo "==> rolled back to $TARGET_TAG"
