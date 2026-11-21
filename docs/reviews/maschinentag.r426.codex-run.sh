#!/usr/bin/env bash
# Actual R426 invocation. Archive: ad16dff3 in /tmp/codex-r425.
# /tmp/r426/run.sh executes:
#   set -eu
#   python3 -I /tmp/r426/partial-probe.py > /tmp/r426/partial-probe.json
#   printf 'R426 partial-record probe: assertions passed\n'
# The accompanying codex-partial-probe.py is unchanged from that run.
set -eu
python3 -I /tmp/codex-r425/scripts/test_support/heavy_lock.py --who codex-r426-review --wait 50 -- bash /tmp/r426/run.sh
