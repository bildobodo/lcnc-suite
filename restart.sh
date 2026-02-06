#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./restart.sh local   # localhost only
#   ./restart.sh lan     # accessible from LAN
# Default is local.
MODE="${1:-local}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$ROOT_DIR/lcnc-gateway"
WEBUI_DIR="$ROOT_DIR/lcnc-webui"

GATEWAY_PORT="8000"
WEBUI_PORT="5173"

OPEN_BROWSER="1"   # 0 = don't open browser
USE_RELOAD="0"     # 1 = uvicorn --reload

LOG_DIR="$ROOT_DIR/runlogs"
mkdir -p "$LOG_DIR"
ts() { date +"%Y-%m-%d_%H-%M-%S"; }

# Resolve LAN IP (best-effort)
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

case "$MODE" in
  local)
    GATEWAY_HOST="127.0.0.1"
    WEBUI_HOST="127.0.0.1"
    OPEN_URL="http://localhost:$WEBUI_PORT"
    ;;
  lan)
    # Bind to all IPv4 interfaces
    GATEWAY_HOST="0.0.0.0"
    WEBUI_HOST="0.0.0.0"
    OPEN_URL="http://${LAN_IP:-localhost}:$WEBUI_PORT"
    ;;
  *)
    echo "ERROR: unknown mode '$MODE' (use: local|lan)"
    exit 1
    ;;
esac

echo "==> Mode:       $MODE"
echo "==> Root:       $ROOT_DIR"
echo "==> Gateway:    $GATEWAY_DIR"
echo "==> Web UI:     $WEBUI_DIR"
echo "==> LAN IP:     ${LAN_IP:-unknown}"

echo "==> Stopping existing processes (if any)..."

# Kill gateway on port
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -t -iTCP:"$GATEWAY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo " - Killing gateway on :$GATEWAY_PORT -> $PIDS"
    kill -TERM $PIDS 2>/dev/null || true
    sleep 0.3
    kill -KILL $PIDS 2>/dev/null || true
  fi
else
  pkill -f "uvicorn.*gateway:app" 2>/dev/null || true
fi

# Kill Vite on port
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -t -iTCP:"$WEBUI_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo " - Killing webui on :$WEBUI_PORT -> $PIDS"
    kill -TERM $PIDS 2>/dev/null || true
    sleep 0.3
    kill -KILL $PIDS 2>/dev/null || true
  fi
else
  pkill -f "vite" 2>/dev/null || true
  pkill -f "npm run dev" 2>/dev/null || true
fi

echo "==> Starting gateway..."
GW_LOG="$LOG_DIR/gateway_$(ts).log"

(
  cd "$GATEWAY_DIR"
  # Activate venv (needed for uvicorn/fastapi), but with system-site-packages so linuxcnc works
  # shellcheck disable=SC1091
  source .venv/bin/activate

  RELOAD_FLAG=""
  if [[ "$USE_RELOAD" == "1" ]]; then
    RELOAD_FLAG="--reload"
  fi

  exec python3 -m uvicorn gateway:app \
    --host "$GATEWAY_HOST" \
    --port "$GATEWAY_PORT" \
    $RELOAD_FLAG
) >"$GW_LOG" 2>&1 &

GW_PID=$!
echo " - gateway pid: $GW_PID  log: $GW_LOG"

echo "==> Starting web UI (Vite)..."
UI_LOG="$LOG_DIR/webui_$(ts).log"

(
  cd "$WEBUI_DIR"
  exec npm run dev -- --host "$WEBUI_HOST" --port "$WEBUI_PORT" --strictPort
) >"$UI_LOG" 2>&1 &

UI_PID=$!
echo " - webui pid:   $UI_PID  log: $UI_LOG"

echo "==> Quick readiness check..."
for i in {1..60}; do
  GW_UP="0"
  UI_UP="0"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$GATEWAY_PORT/health" >/dev/null 2>&1 && GW_UP="1" || true
    curl -fsS "http://127.0.0.1:$WEBUI_PORT/" >/dev/null 2>&1 && UI_UP="1" || true
  else
    GW_UP="1"
    UI_UP="1"
  fi

  if [[ "$GW_UP" == "1" && "$UI_UP" == "1" ]]; then
    echo " - gateway OK, webui OK"
    break
  fi
  sleep 0.15
done

echo
echo "Done."
echo "Gateway local: http://127.0.0.1:$GATEWAY_PORT  (WS: ws://127.0.0.1:$GATEWAY_PORT/ws)"
echo "WebUI local:   http://localhost:$WEBUI_PORT"
if [[ -n "${LAN_IP:-}" ]]; then
  echo "Gateway LAN:   http://$LAN_IP:$GATEWAY_PORT      (WS: ws://$LAN_IP:$GATEWAY_PORT/ws)"
  echo "WebUI LAN:     http://$LAN_IP:$WEBUI_PORT"
fi
echo "Logs:          $LOG_DIR"
echo

if [[ "$OPEN_BROWSER" == "1" ]]; then
  echo "==> Opening browser: $OPEN_URL"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$OPEN_URL" >/dev/null 2>&1 || true
  elif command -v firefox >/dev/null 2>&1; then
    firefox "$OPEN_URL" >/dev/null 2>&1 || true
  elif command -v chromium >/dev/null 2>&1; then
    chromium "$OPEN_URL" >/dev/null 2>&1 || true
  else
    echo " - No opener found. Open manually: $OPEN_URL"
  fi
fi
