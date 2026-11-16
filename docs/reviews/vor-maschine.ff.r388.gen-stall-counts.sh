#!/bin/bash
# (Evidence copy; the run directories are local to the VM.) Regenerates the R388 stall table (vor-maschine.ff.r388.stall-counts.txt).
# Every Firefox run at a head with the display pin: 8dc5b6eb, 291ebcb5, cd23f813.
# Usage: gen-stall-counts.sh [CI dir ...]   (CI artifact dirs are added to the WebGL table)
set -u
cd "$(dirname "$0")"
FF=(mutants-8dc5b6eb/* series-8dc5b6eb/* mutants-291ebcb5/* mutants-cd23f813/*)
GATES=(~/rgff-8dc5b6eb ~/rgff-291ebcb5 ~/rgff-cd23f813)
CI=(ci-8dc5b6eb "$@")
FFD=(); for d in "${FF[@]}"; do [ -d "$d" ] && FFD+=("$d"); done
echo "R388 — the stall's signature in every Firefox run at a head with the display pin (8dc5b6eb, 291ebcb5, cd23f813). stall-count.py's rule: a load = GET / 200 under a test attempt's origin; it has its hello when a connection opened under that origin after the load and before that origin's next load received a 'hello' frame."
echo "Runs: the mutants at 8dc5b6eb, 291ebcb5 and cd23f813, the P/D series at 8dc5b6eb, the three round gates, CI at $(echo ${CI[*]#ci-} | sed "s/ / and /g"). A run = one Playwright run that left a replay file; core and guard each count as one (F6's guard left none: its fixture refused the started browser before any load; F6's core left 66 files without a load)."
echo
echo "-- by the browser's recorded WebGL answer (stall-by-webgl.py):"
python3 vor-maschine.ff.r388.stall-by-webgl.py "${FFD[@]}" "${GATES[@]}" "${CI[@]}"
echo
echo "-- the counter on R387's known hit (128d6821 F2; webgl was not recorded then):"
python3 vor-maschine.ff.r388.stall-count.py mutants-128d6821/F2
echo
echo "-- per directory, Firefox runs only (the round gates and CI are in the WebGL table above: their dirs also hold Chromium replays):"
python3 vor-maschine.ff.r388.stall-count.py "${FFD[@]}"
