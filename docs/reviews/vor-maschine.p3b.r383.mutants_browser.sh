#!/bin/bash
# Browser mutants for probe live (Codex R380 VM380-01): each send-site mutant
# applied alone in App.vue, the UI built, the two fixture cases of
# probe-click.spec run (must be red), and the map guard probePanelJobs.test.ts
# run (stays green: only the browser case holds the send site). Restored after.
set -uo pipefail
T=/home/cnc/lcnc-suite-pl/lcnc-webui
OUT=/home/cnc/claude-work/p3b-probe/mutants-browser.txt
: > "$OUT"
cd "$T"
run() {
  local name="$1" old="$2" new="$3"
  python3 - "$old" "$new" <<'PY'
import sys
p = "src/App.vue"; s = open(p).read(); old, new = sys.argv[1], sys.argv[2]
assert s.count(old) == 1, s.count(old)
open(p, "w").write(s.replace(old, new))
PY
  npm run build >/dev/null 2>&1 || echo "build failed" >> "$OUT"
  npx playwright test e2e/probe-click.spec.ts -g "the job the button sends" --workers=1 --reporter=line > /tmp/claude-1000/pl-bm.txt 2>&1
  local pw=$?
  npx vitest run src/probePanelJobs.test.ts > /tmp/claude-1000/pl-bv.txt 2>&1
  local vt=$?
  git checkout -- src/App.vue
  echo "$name: browser rc=$pw ($(grep -Eo '[0-9]+ (passed|failed)' /tmp/claude-1000/pl-bm.txt | paste -sd' ')), map guard rc=$vt ($(grep -Eo 'Tests +[0-9]+ (passed|failed)' /tmp/claude-1000/pl-bv.txt | head -1))" >> "$OUT"
  grep -E "✘|Error:|Expected|Received" /tmp/claude-1000/pl-bm.txt | head -6 | sed 's/^/    /' >> "$OUT"
}
run "B1 the probe send site sends mode 1" 'void fireJob("Probe", { cmd: "probe_run", routine: macro, vars }, "machineFrame");' 'void fireJob("Probe", { cmd: "probe_run", routine: macro, vars: { ...vars, "3030": 1 } }, "machineFrame");'
run "B2 the scan send site changes #3054" 'void fireJob("Surface scan", { cmd: "surface_scan_run", vars }, "surfaceComp");' 'void fireJob("Surface scan", { cmd: "surface_scan_run", vars: { ...vars, "3054": (vars["3054"] ?? 0) + 1 } }, "surfaceComp");'
npm run build >/dev/null 2>&1 && echo "rebuilt clean" >> "$OUT"
git status --short >> "$OUT"
echo "== end $(date -Is)" >> "$OUT"
