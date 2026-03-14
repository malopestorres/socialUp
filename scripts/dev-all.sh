#!/usr/bin/env bash

set -euo pipefail

MODE="${1:-core}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()

cd "$ROOT_DIR"

start_labeled() {
  local label="$1"
  shift

  (
    "$@" 2>&1 | sed -u "s/^/[$label] /"
  ) &
  PIDS+=("$!")
}

cleanup() {
  local exit_code="$?"
  trap - INT TERM EXIT

  echo ""
  echo "Encerrando processos locais..."

  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done

  wait >/dev/null 2>&1 || true

  if [ "$MODE" = "full" ]; then
    npm run stop:whatsapp >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup INT TERM EXIT

echo "Modo: $MODE"
echo "Subindo infra base (db + redis + rabbitmq)..."
npm run infra:start

echo "Iniciando backend e frontend..."
start_labeled "backend" npm run dev:backend
start_labeled "web" npm run dev:web

if [ "$MODE" = "full" ]; then
  echo "Iniciando tunnel e stack WhatsApp..."
  start_labeled "tunnel" npm run dev:tunnel
  start_labeled "whatsapp" npm run dev:whatsapp
fi

echo "Stack local em execução. Ctrl+C para encerrar tudo."

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "Nenhum processo foi iniciado."
  exit 1
fi

while true; do
  if ! wait -n "${PIDS[@]}"; then
    echo "Um processo encerrou com erro. Finalizando stack..."
    exit 1
  fi
done
