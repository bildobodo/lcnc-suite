#!/usr/bin/env bash
# R425: actual invocation; /tmp/codex-r425 is a git archive of ad16dff3.
# /tmp/r425/run.sh contains exactly:
#   set -eu
#   python3 -I /tmp/r425/file-probes.py > /tmp/r425/file-probes.json
# file-probes.py is the accompanying unchanged codex-file-probes.py.
set -eu
python3 -I /tmp/codex-r425/scripts/test_support/heavy_lock.py --who codex-r425-review --wait 50 -- bash /tmp/r425/run.sh
