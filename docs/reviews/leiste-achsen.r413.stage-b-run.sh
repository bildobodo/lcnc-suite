#!/bin/bash
# stage B proof in the dc9dc3e4 archive tree: today / r411 / b1, Chromium (touch) then Firefox (desktop)
OUT=${OUTDIR:-$HOME/claude-work/stripfit/axes-plan/stageb}; [ -n "$KEEP" ] || rm -rf $OUT; mkdir -p $OUT
cd $HOME/claude-work/stripfit/atree/lcnc-webui
cp ~/claude-work/stripfit/axes-plan/stage-b.spec.ts e2e/
cat > playwright.stageb-ff.config.ts <<'CFG'
import { defineConfig } from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({ ...base, testMatch: /stage-b\.spec\.ts$/, grep: undefined });
CFG
FF=$(python3 -I ../scripts/fetch_firefox.py path)
for v in ${VARIANTS:-today r411 b1}; do
  echo "== $v chromium"; STAGE_B=$v SHOT_DIR=$OUT LCNC_E2E_WORKERS=3 npx playwright test e2e/stage-b.spec.ts --reporter=line 2>&1 | grep -E "passed|failed|✘|flaky" | tail -4
  echo "== $v firefox"; LCNC_FIREFOX=$FF STAGE_B=$v SHOT_DIR=$OUT LCNC_E2E_WORKERS=3 npx playwright test -c playwright.stageb-ff.config.ts --reporter=line 2>&1 | grep -E "passed|failed|✘|flaky" | tail -4
done
rm -f e2e/stage-b.spec.ts playwright.stageb-ff.config.ts
