#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVOLUTION_DIR="$ROOT_DIR/services/evolution-api"
PG_BIN="/Applications/Postgres.app/Contents/Versions/17/bin"
PG_DATA_DIR="${EVOLUTION_PG_DATA_DIR:-$HOME/.evolution-postgres/data}"
PG_LOG_DIR="${EVOLUTION_PG_LOG_DIR:-$HOME/.evolution-postgres/logs}"
PG_LOG_FILE="$PG_LOG_DIR/postgres.log"
PG_PORT="${EVOLUTION_PG_PORT:-5433}"

if [ ! -d "$EVOLUTION_DIR" ]; then
  echo "services/evolution-api nao encontrado. Clone/configure a Evolution API primeiro."
  exit 1
fi

if [ ! -x "$PG_BIN/pg_ctl" ]; then
  echo "Postgres.app nao encontrado em /Applications/Postgres.app."
  echo "Instale o Postgres.app ou ajuste PG_BIN no script scripts/dev-whatsapp.sh."
  exit 1
fi

if [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  unset npm_config_prefix
  unset NPM_CONFIG_PREFIX
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  mkdir -p "$NVM_DIR"
  # shellcheck source=/dev/null
  . "/usr/local/opt/nvm/nvm.sh"
  nvm use 20 >/dev/null || nvm install 20
fi

mkdir -p "$PG_DATA_DIR" "$PG_LOG_DIR"

if [ ! -f "$PG_DATA_DIR/PG_VERSION" ]; then
  echo "Inicializando PostgreSQL local da Evolution..."
  LC_ALL=C LANG=C "$PG_BIN/initdb" -D "$PG_DATA_DIR"
fi

if ! "$PG_BIN/pg_ctl" -D "$PG_DATA_DIR" status >/dev/null 2>&1; then
  echo "Iniciando PostgreSQL local na porta $PG_PORT..."
  "$PG_BIN/pg_ctl" -D "$PG_DATA_DIR" -l "$PG_LOG_FILE" -o "-p $PG_PORT" start
fi

cd "$EVOLUTION_DIR"

if [ ! -d node_modules ]; then
  echo "Instalando dependencias da Evolution API..."
  npm install
fi

if [ ! -f .env ]; then
  echo ".env da Evolution API nao encontrado em $EVOLUTION_DIR/.env"
  echo "Crie esse arquivo antes de rodar (ou copie de .env.example)."
  exit 1
fi

echo "Subindo Evolution API em modo dev na porta 8080..."
npm run dev:server
