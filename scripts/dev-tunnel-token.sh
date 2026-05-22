#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"

if [ -z "${TOKEN// /}" ]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN nao configurado."
  echo "Pegue o token no Cloudflare Dashboard (Tunnels > seu tunnel > Add a replica)."
  exit 1
fi

echo "Iniciando Cloudflare Tunnel via token (ingress em .tmp-cloudflared-config.yml)..."
cloudflared tunnel --config "$ROOT_DIR/.tmp-cloudflared-config.yml" run --token "$TOKEN"

