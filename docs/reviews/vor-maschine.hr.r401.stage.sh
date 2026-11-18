#!/bin/bash
# Staged load: the heavy unit set (CPU on every core) beside the stall guards, --repeat-each=$2.
# $1 = output tag. Runs in ~/lcnc-suite-hr/lcnc-webui at its current head.
set -u
TAG=$1; REP=${2:-4}; OUT=~/claude-work/holdrace/stage
cd ~/lcnc-suite-hr/lcnc-webui
git rev-parse --short HEAD > $OUT/$TAG.head
npx vitest run src/viewer/collisionContacts.test.ts src/viewer/collisionRangeOracle.test.ts src/viewer/sweepShards.test.ts \
  src/viewer/contactViewCross.test.ts src/viewer/collisionLineSample.test.ts src/viewer/collisionOracle.test.ts \
  src/viewer/collisionBounds.test.ts src/viewer/contactViewIndexed.test.ts > $OUT/$TAG.load.log 2>&1 &
LOAD=$!
sleep 25
npx playwright test e2e/hold-stall.spec.ts e2e/hold-stall-mouse.spec.ts --repeat-each=$REP --workers=2 --reporter=line 2>&1 \
  | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' > $OUT/$TAG.txt
echo "load still running: $(kill -0 $LOAD 2>/dev/null && echo yes || echo no)" >> $OUT/$TAG.txt
pkill -P $LOAD 2>/dev/null; kill $LOAD 2>/dev/null; wait 2>/dev/null
echo done >> $OUT/$TAG.txt
