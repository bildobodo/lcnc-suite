#!/usr/bin/env bash
# R165 browser measurement: Codex's unchanged specs (R159 budget + his R163 roundoff shapes) with repeated
# Shift presses, his acceptance script on them; the same specs waiting for the whole list; my shapes with and
# without keys, the new ones waiting for the whole list
set -u
cd /home/cnc/lcnc-suite-mut/lcnc-webui || exit 2
O=/home/cnc/claude-work/form1
S=/tmp/claude-1000/-home-cnc-lcnc-suite/b51e55ad-5023-4968-835e-f7e1362322ed/scratchpad
rm -f e2e/zz_*.ts
{ git log --oneline -1; echo "== build"; systemd-run --user --scope --quiet -p MemoryMax=8G npm run build 2>&1 | grep -E "built in|rror"
  rm -f $O/acc-r165*.json $O/lt*-r165*.json
  run() {  # keys(0/1), out, specs...
    local k=$1 out=$2; shift 2
    echo "== keys $k $* $(date +%H:%M:%S) up $(cut -d' ' -f1 /proc/uptime)"
    local env=""; [ "$k" = 1 ] && env="--setenv=LT_KEYS=1"
    systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 $env --setenv=LT_OUT=$out npx playwright test --project serial-viewer --no-deps --trace off --reporter=line "$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E " passed| failed|Error:" | head -4
  }
  # Codex's unchanged specs
  cp $O/r159.longtask.viewer.spec.ts e2e/zz_codex_lt.viewer.spec.ts; cp $O/r163-codex/viewer-palette-fest.r163.codex-roundoff.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts
  for i in 1 2; do run 1 $O/acc-r165-keys-$i.json e2e/zz_codex_lt.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts; python3 $O/r164-codex/viewer-palette-fest.r164.codex-acceptance.py $O/acc-r165-keys-$i.json $O/acc-r165-report-$i.json > /dev/null 2>&1 && echo "   acceptance $i: green" || echo "   acceptance $i: RED"; done
  # the same, waiting for the whole list
  sed -i 's|const rows = async () => (await diag(page)).rows > 0;|const rows = async () => (await page.evaluate(() => document.querySelector<HTMLElement>(".simTable")?.dataset.listComplete === "1"));|; s|async () => (await diag(page)).rows > 0));|async () => (await page.evaluate(() => document.querySelector<HTMLElement>(".simTable")?.dataset.listComplete === "1"))));|' e2e/zz_codex_lt.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts
  run 1 $O/acc-r165-keys-whole.json e2e/zz_codex_lt.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts
  python3 $O/r164-codex/viewer-palette-fest.r164.codex-acceptance.py $O/acc-r165-keys-whole.json $O/acc-r165-report-whole.json > /dev/null 2>&1 && echo "   acceptance whole: green" || echo "   acceptance whole: RED"
  run 0 $O/acc-r165-nokeys-whole.json e2e/zz_codex_lt.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts
  rm -f e2e/zz_codex_lt.viewer.spec.ts e2e/zz_codex_ro.viewer.spec.ts
  # my shapes (R158's and R160/R161's) with and without keys
  cp $O/longtask5.viewer.spec.ts e2e/zz_longtask5.viewer.spec.ts; cp $O/longtask6.viewer.spec.ts e2e/zz_longtask6.viewer.spec.ts
  run 0 $O/lt-r165-k0.json e2e/zz_longtask5.viewer.spec.ts e2e/zz_longtask6.viewer.spec.ts
  run 1 $O/lt-r165-k1.json e2e/zz_longtask5.viewer.spec.ts e2e/zz_longtask6.viewer.spec.ts
  rm -f e2e/zz_longtask5.viewer.spec.ts e2e/zz_longtask6.viewer.spec.ts
  echo "== end $(date +%H:%M:%S) up $(cut -d' ' -f1 /proc/uptime)"
} > $O/run-r165.txt 2>&1
