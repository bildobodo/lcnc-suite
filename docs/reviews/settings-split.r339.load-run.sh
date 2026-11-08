#!/bin/bash
# The per-device simulation load measurement (drive.py, browsers.mjs,
# report.py). Runs under the heavy lock — no gate, native run or load repro
# beside it:
#   python3 -I ~/lcnc-suite-sim/scripts/test_support/heavy_lock.py --who simload -- bash run.sh <head> <outdir> [program]
# The LAN test sim (lcnc-sim-gates) runs the branch at <head> in production
# (the built page) for the run, and comes back in its dev mode ON the branch
# (operator 2026-10-29: the test sim stays on the branch under work).
set -uo pipefail
HEAD=$1; OUT=$2; PROG=${3:-bpc_parse.ngc}
HERE=$(cd "$(dirname "$0")" && pwd)
G=$HOME/lcnc-suite-gates; CFG=$HOME/linuxcnc/configs/lcnc_suite_sim_look; INI=lcnc_suite_sim_3axis_xyz_test.ini
PY=$G/lcnc-gateway/.venv/bin/python3
mkdir -p "$OUT"
git -C "$G" rev-parse HEAD > "$OUT/gates-head-before"

down() {
  systemctl --user stop bg-keepalive lcnc-sim-gates 2>/dev/null
  for i in $(seq 90); do pgrep -f "uvicorn gateway:app" >/dev/null || pgrep -x milltask >/dev/null || break; sleep 1; done
  systemctl --user reset-failed lcnc-sim-gates bg-keepalive 2>/dev/null
}
up() {   # $1: extra env for the sim
  systemd-run --user --unit=lcnc-sim-gates --working-directory="$CFG" /usr/bin/env -u DISPLAY LCNC_WEBUI_BROWSER=0 $1 linuxcnc "$INI"
  for i in $(seq 180); do curl -sf http://127.0.0.1:8000/ready >/dev/null && break; sleep 1; done
  systemd-run --user --unit=bg-keepalive --working-directory="$HOME" "$PY" "$HOME/claude-work/bg/keepalive_ini.py" "$CFG/$INI"
}

down
git -C "$G" checkout -q --detach "$HEAD"
(cd "$G/lcnc-webui" && npm run build > "$OUT/build.log" 2>&1) || { echo "build failed"; exit 1; }
up "LCNC_WEBUI_DEV=0"
sleep 5
cd "$HERE"
node browsers.mjs http://127.0.0.1:8000 "$OUT" > "$OUT/browsers.log" 2>&1 &
BPID=$!
"$PY" drive.py "$OUT" "$PROG" > "$OUT/drive.log" 2>&1 || echo "drive failed" >> "$OUT/drive.log"
touch "$OUT/stop"
wait $BPID
"$PY" report.py "$OUT" | tee "$OUT/report.txt"
down
up ""
git -C "$G" rev-parse HEAD > "$OUT/gates-head-after"
echo done
