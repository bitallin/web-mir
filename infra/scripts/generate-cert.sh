#!/usr/bin/env bash
# Self-signed certificate for staging and local edge drills. Production should
# use a CA-issued certificate mounted at the same paths.
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CERT_DIR=${TLS_CERT_DIR:-"$ROOT_DIR/infra/docker/nginx/certs"}
CN=${TLS_CN:-localhost}
DAYS=${TLS_DAYS:-30}

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [[ -f "$CERT_DIR/fullchain.pem" && -f "$CERT_DIR/privkey.pem" && "${FORCE:-false}" != "true" ]]; then
  echo "certificate already exists in $CERT_DIR (set FORCE=true to replace)"
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/CN=$CN" \
  -addext "subjectAltName=DNS:$CN,IP:127.0.0.1"

chmod 600 "$CERT_DIR/privkey.pem"
chmod 644 "$CERT_DIR/fullchain.pem"
echo "wrote $CERT_DIR/fullchain.pem and $CERT_DIR/privkey.pem (CN=$CN, ${DAYS}d)"
