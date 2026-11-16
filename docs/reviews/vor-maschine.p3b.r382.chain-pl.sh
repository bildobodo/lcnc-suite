#!/bin/bash
# Package 3b probe live (plan R380–R381) at the worktree's HEAD: the offline
# mutants (P1–P21), the browser mutants, the round gate, the native stage twice (main), once with the driver
# rebuilt on mdi (the hit and the scan — must FAIL at their job rows), then the
# LAN sim back on the branch. One step after the other: nothing beside a gate.
set -uo pipefail
export LC_TREE=pl
. /home/cnc/claude-work/live-checks/env.sh
L=$REAL_HOME/claude-work/p3b-probe; WT=$LC_WT; PY=$WT/lcnc-gateway/.venv/bin/python3
C=$(git -C "$WT" rev-parse --short=8 HEAD)
echo "== start $(date -Is), tree $WT at $C"
[ -z "$(git -C "$WT" status --porcelain)" ] || { echo "tree not clean"; git -C "$WT" status --short; exit 2; }
# 0. the offline mutants (each applied alone, restored)
(cd "$WT" && "$PY" "$L/mutants_pl.py" "$WT") > "$L/mutants-pl.txt" 2>&1; echo "offline mutants rc=$?"; grep -E "^P[0-9]+" "$L/mutants-pl.txt"
[ -z "$(git -C "$WT" status --porcelain)" ] || { echo "tree not clean after the offline mutants"; exit 2; }
# 1. the browser mutants (they restore App.vue and rebuild)
"$L/mutants_browser.sh"; echo "browser mutants rc=$?"; cat "$L/mutants-browser.txt"
[ -z "$(git -C "$WT" status --porcelain)" ] || { echo "tree not clean after the browser mutants"; exit 2; }
# 2. the round gate
rm -rf "$REAL_HOME/rgpl"; mkdir -p "$REAL_HOME/rgpl"
(cd "$WT" && "$PY" scripts/test_select/round_gate.py --base cad9ac77 --out "$REAL_HOME/rgpl/gate-round.json") > "$REAL_HOME/rgpl/gate.log" 2>&1
echo "round gate rc=$? $(python3 -c "
import json; d=json.load(open('$REAL_HOME/rgpl/gate-round.json')); print('GATE', d.get('verdict') or d.get('result'), d.get('head'), 'uncommitted', d.get('uncommitted')); [print(' ', c.get('check') or c.get('name'), c.get('status') or c.get('result')) for c in d.get('checks', [])]" 2>&1)"
native() {
  local tag="$1"
  RUN=$REAL_HOME/claude-work/live-tier/$(date +%Y%m%dT%H%M%S)-pl-$tag
  echo "$RUN" >> "$L/native-runs.txt"
  systemctl --user reset-failed native-run 2>/dev/null
  systemd-run --user --unit=native-run --collect -p MemoryMax=12G -p MemorySwapMax=0 -p RuntimeMaxSec=7200 -E PATH="$PATH" -E HOME="$REAL_HOME" -p WorkingDirectory="$WT" \
    -p "ExecStopPost=$PY -I $WT/scripts/test_support/restore_lan.py --from $RUN/pre.json --out $RUN/restore-post.json" \
    "$PY" -I "$WT/scripts/native_run.py" --run-dir "$RUN" --commit "$C" --profile 3axis_xyz >/dev/null
  sleep 5
  while [ "$(systemctl --user show -p LoadState --value native-run)" = "loaded" ]; do sleep 10; done
  echo "native $tag: $RUN"
  python3 "$L/native_pl_summary.py" "$RUN"
}
# 3. the native stage twice
native main1
native main2
# 4. the driver rebuilt on mdi (VM349-01): the hit and the scan through mdi
python3 - "$WT/scripts/native_run.py" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
for old, new in (('lambda: _probe_job(c, "probe-run", "probe_run", payload))',
                  'lambda: _probe_job(c, "probe-run", "mdi", {"text": line, "vars": payload["vars"]}))'),
                 ('_probe_job(c, "surface-scan", "surface_scan_run", {"vars": dict(job["vars"])},',
                  '_probe_job(c, "surface-scan", "mdi", {"text": line, "vars": dict(job["vars"])},')):
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(p, "w").write(s)
PY
native mdi-driver
git -C "$WT" checkout -- scripts/native_run.py
git -C "$WT" status --short
# 5. the LAN sim on the branch under work
HL=("$PY" -I "$WT/scripts/test_support/heavy_lock.py" --who live-checks --wait 900 --)
"${HL[@]}" "$REAL_HOME/claude-work/settings-split/simload/lan-to.sh" "$C"
echo "lan-to rc=$? $(date -Is)"
systemctl --user is-active lcnc-sim-gates bg-keepalive
echo "== end $(date -Is)"
