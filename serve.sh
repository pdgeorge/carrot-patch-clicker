#!/usr/bin/env bash
# serve.sh — run the local Carrot Patch world server for development.
#
#   ./serve.sh start      build client, then serve at http://localhost:8420
#   ./serve.sh restart    stop (world saves on shutdown), rebuild, start
#   ./serve.sh stop       stop the server (world state is saved)
#   ./serve.sh status     pid, build id, and a live /api/state probe
#   ./serve.sh logs       follow the server log (ctrl-c to detach)
#   ./serve.sh wipe       stop + delete the LOCAL world save → fresh garden
#
# Port via CARROT_PATCH_PORT (default 8420); state file via CARROT_PATCH_STATE
# (default carrot_patch/patch_state.json — gitignored, purely local).
# First run creates .venv/ and installs requirements automatically.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${CARROT_PATCH_PORT:-8420}"
VENV=".venv"
PIDFILE=".server.pid"
LOG="server.log"
STATE="${CARROT_PATCH_STATE:-$PWD/carrot_patch/patch_state.json}"

ensure_venv() {
  if [ ! -x "$VENV/bin/uvicorn" ]; then
    echo "· first run: creating $VENV and installing requirements…"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q -r requirements.txt
  fi
}

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "already running (pid $(cat "$PIDFILE")) — try: ./serve.sh restart"
    exit 1
  fi
  ensure_venv
  node build.js
  CARROT_PATCH_STATE="$STATE" nohup "$VENV/bin/uvicorn" carrot_patch.main:app \
    --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 1
  if is_running; then
    echo "🥕 world server up: http://localhost:$PORT  (pid $(cat "$PIDFILE"), log: $LOG)"
  else
    echo "failed to start — tail of $LOG:" >&2
    tail -n 8 "$LOG" >&2
    rm -f "$PIDFILE"
    exit 1
  fi
}

stop() {
  if is_running; then
    kill "$(cat "$PIDFILE")"          # SIGTERM → FastAPI shutdown → patch.save()
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      is_running || break
      sleep 0.3
    done
    rm -f "$PIDFILE"
    echo "stopped (world state saved on shutdown)"
  else
    rm -f "$PIDFILE"
    echo "not running"
  fi
}

status() {
  if is_running; then
    build=$(grep -o "CC.BUILD = '[a-f0-9]*'" carrot_patch/dist/clicker.html | cut -d"'" -f2)
    echo "running: pid $(cat "$PIDFILE"), port $PORT, build $build"
    echo "state:   $STATE"
    curl -s --max-time 2 "http://localhost:$PORT/api/state" | head -c 200 && echo
  else
    echo "not running"
  fi
}

wipe() {
  stop
  rm -f "$STATE" "${STATE%.json}_tenders.db" "${STATE%.json}.tmp"
  echo "local world wiped — next start grows a fresh garden"
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  logs)    exec tail -n 40 -f "$LOG" ;;
  wipe)    wipe ;;
  *)       sed -n '2,13p' "$0"; exit 1 ;;
esac
