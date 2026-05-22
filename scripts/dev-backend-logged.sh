#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/apps/runtime-logs"
LOG_FILE="$LOG_DIR/backend-dev.log"

mkdir -p "$LOG_DIR"

echo "Logging backend dev output to: $LOG_FILE"
echo "Started at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" | tee -a "$LOG_FILE"

# Keep console output while also persisting logs to file.
npm run dev:backend 2>&1 | tee -a "$LOG_FILE"

