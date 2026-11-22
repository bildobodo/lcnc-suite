#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r436/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r436/head
"$py" -m pytest -p no:cacheprovider -v scripts/test_native_stage.py -k 'parse_basis or parse_nice or pb_owed or quiet_wait or r430 or r431 or r432 or r433 or r435 or the_window_is_the_gateways_stream or a_window_rotated_within or a_window_is_framed_only or a_slow_confirmed_read_back' > /tmp/r436/native-baseline.txt 2>&1
"$py" -m pytest -p no:cacheprovider -v scripts/test_r435_codex_nice.py scripts/test_r436_codex_nice.py > /tmp/r436/nice-probes.txt 2>&1
"$py" /tmp/r436/native-reeval.py > /tmp/r436/native-reeval.json
printf 'Native guards, unchanged R435 probes, R436 probes and stored-run re-evaluation finished.\n'
