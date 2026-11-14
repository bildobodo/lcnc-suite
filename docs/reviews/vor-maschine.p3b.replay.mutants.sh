#!/bin/bash
# Replay (3b item 2) red proofs at the browser level: each mutant built into the
# dist Playwright serves, a subset of specs run with the replay logs on, the
# checker over that run. M0 = no mutation (the subset alone passes). Run under the
# heavy lock (vite preview :4173, the per-worker mocks): CI=1 forbids reusing a
# server another tree left on :4173.
set -uo pipefail
T=$HOME/lcnc-suite-rpmut; W=$T/lcnc-webui; PY=$T/lcnc-gateway/.venv/bin/python3
OUT=$HOME/claude-work/p3b/replay-mutants-$(date +%Y%m%dT%H%M%S); mkdir -p "$OUT"
SPECS="e2e/probe-click.spec.ts e2e/jog-buttons.spec.ts e2e/setup-layout.spec.ts e2e/replay-origin.spec.ts"
HEAD=$(git -C "$T" rev-parse --short=8 HEAD)
echo "== replay mutants at $HEAD, $OUT, $(date -Is)"
mutate() {   # $1 = mutant id; edits the tree (reset before each)
  git -C "$T" checkout -q -- .
  "$PY" -I - "$T" "$1" <<'PY'
import sys
from pathlib import Path
t, m = Path(sys.argv[1]), sys.argv[2]
def sub(rel, old, new):
    p = t / rel; s = p.read_text()
    assert s.count(old) == 1, (rel, old[:60]); p.write_text(s.replace(old, new))
if m == "M1":   # VM349-01: the probe driver rebuilt on MDI
    sub("lcnc-webui/src/App.vue",
        'void fireJob("Probe", { cmd: "probe_run", routine: macro, vars }, "machineFrame");',
        'void request({ cmd: "mdi", text: `o<${macro}> call`, vars } as any);')
if m in ("M2", "M3"):   # one command's frame changed on its way out (send and request)
    hook = {"M2": 'o.cmd === "jog_cont" ? { ...o, stray: 1 } : o',
            "M3": 'o.cmd === "mdi" ? { ...o, vars: { ...(o.vars ?? {}), "4999": 1 } } : o'}[m]
    sub("lcnc-webui/src/lcncWs.ts", "export function send(obj: WsCommand): string | null {\n",
        "export function send(obj0: WsCommand): string | null {\n  const o: any = obj0; const obj: any = " + hook + ";\n")
    sub("lcnc-webui/src/lcncWs.ts", "export function request(obj: WsCommand, timeoutMs = 5000): Promise<any | null> {\n",
        "export function request(obj0: WsCommand, timeoutMs = 5000): Promise<any | null> {\n  const o: any = obj0; const obj: any = " + hook + ";\n")
if m == "M4":   # the origin cookie gone
    sub("lcnc-webui/e2e/test.ts", "      cookies: [{ name: ORIGIN_COOKIE,", "      cookies: [{ name: `off-${ORIGIN_COOKIE}`,")
print(f"{m}: mutated")
PY
}
for M in M0 M1 M2 M3 M4; do
  D=$OUT/$M; mkdir -p "$D"
  mutate "$M" || { echo "$M: the mutation did not apply"; continue; }
  git -C "$T" diff --stat | tail -1
  (cd "$W" && npx vite build > "$D/build.log" 2>&1) || { echo "$M: build FAILED"; tail -5 "$D/build.log"; continue; }
  RUN=mut-$M-$(date +%s)
  (cd "$W" && CI=1 LCNC_E2E_RUN=$RUN LCNC_E2E_EVENTS=$D/events.jsonl LCNC_E2E_REPLAY_DIR=$D/replay \
     npx playwright test -c playwright.config.ts $SPECS --retries 0 --trace off --reporter=line > "$D/playwright.log" 2>&1)
  echo "$M: playwright exit $? — $(grep -E '[0-9]+ (passed|failed)' "$D/playwright.log" | tr '\n' ' ')"
  "$PY" -I "$T/scripts/test_select/replay.py" --dir "$D/replay" --events "$D/events.jsonl" --run "$RUN" --out "$D/replay.json"
  "$PY" -I - "$D/replay.json" <<'PY'
import json, sys, collections
d = json.load(open(sys.argv[1]))
print(f"   frames {d['frames']}, attempts {d['attempts']}, connections {d['connections']}, http {d['http']}")
kinds = collections.Counter()
for f in d["findings"]:
    for k in ("probe routine through MDI", "no probe_run", "undeclared fields", "refused", "corrected",
              "without an origin", "no hello", "an origin of no attempt"):
        if k in f: kinds[k] += 1; break
    else: kinds["other"] += 1
print(f"   findings by kind: {dict(kinds)}")
for f in d["findings"][:4]: print("   ·", f[:230])
PY
done
git -C "$T" checkout -q -- .
(cd "$W" && npx vite build > "$OUT/build-restore.log" 2>&1)
echo "== end $(date -Is) (tree reset, dist rebuilt unmutated)"
