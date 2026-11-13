#!/bin/bash
# Package 2b after R359: every new guard of the pin / background / preemption
# round runs against the gateway.py BEFORE its fix (the head's tests, the old
# product) and must be red; the controls green. Writes red-2b-pin.txt.
set -uo pipefail
WT=/home/cnc/lcnc-suite-link; PY=$WT/lcnc-gateway/.venv/bin/python
OUT=/home/cnc/claude-work/typecheck/red-2b-pin.txt
D=$(mktemp -d /tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad/red.XXXX)
echo "== red check at $(git -C $WT rev-parse --short=8 HEAD) $(date -Is)" > $OUT
run() {   # <old rev> <-k expr> <label>
  rm -rf $D/t && mkdir -p $D/t && (cd $WT && tar --exclude=./lcnc-webui --exclude=./.git --exclude=./runlogs --exclude=./examples -cf - . | tar -xf - -C $D/t)
  git -C $WT show "$1":lcnc-gateway/gateway.py > $D/t/lcnc-gateway/gateway.py
  echo "-- $3: gateway.py of $1, tests of the head, -k '$2'" >> $OUT
  (cd $D/t/lcnc-gateway && LCNC_NO_BINDING=1 timeout 300 $PY -m pytest -p no:cacheprovider -o addopts="" -q test_link_ownership.py -k "$2" -rA 2>&1 | grep -E "^(PASSED|FAILED|ERROR) |passed|failed" | grep -v "^\[GC\]" | cut -c1-200) >> $OUT
}
run 699834be "began_without or throughout or BackgroundSequences" "pin to no connection, heal and read-back on one Link (expect 8 FAILED — the whole heal class, 3e3ec6ed's four guards included — and 2 PASSED controls)"
run 7fed7bef "AnAbortDuringTheHeal or TheReadBackOnAChangedLink" "abort preempts the heal, read-back refusal traced as link (expect 2 FAILED)"
run 211ecc45 "superseded or supersedes or defers_it or refused_there or CachesFilledOnTheirOwnLink" "the heal re-checks under the lock, caches from a read status (expect 6 FAILED)"
run 3e3ec6ed "ReservedRowsOnlyOnATwpMachine" "reserved rows only on a TWP machine (expect 2 FAILED: the TCP trunnion's tick and the heal without TWP; 2 PASSED controls)"
rm -rf $D
cat $OUT
