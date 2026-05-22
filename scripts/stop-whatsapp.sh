#!/usr/bin/env bash

set -euo pipefail

PG_BIN="${EVOLUTION_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PG_DATA_DIR="${EVOLUTION_PG_DATA_DIR:-$HOME/.evolution-postgres/data}"

echo "Parando Evolution API (se estiver rodando)..."
pkill -f "services/evolution-api.*src/main.ts" 2>/dev/null || true
pkill -f "services/evolution-api.*dist/main" 2>/dev/null || true

if [ -x "$PG_BIN/pg_ctl" ] && [ -d "$PG_DATA_DIR" ]; then
  if "$PG_BIN/pg_ctl" -D "$PG_DATA_DIR" status >/dev/null 2>&1; then
    echo "Parando PostgreSQL local da Evolution..."
    "$PG_BIN/pg_ctl" -D "$PG_DATA_DIR" stop
  fi
fi

echo "WhatsApp stack finalizada."
