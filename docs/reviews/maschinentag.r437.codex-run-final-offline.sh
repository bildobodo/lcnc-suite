#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r437/logs
py=/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python
cd /tmp/r437/head
"$py" -m pytest -p no:cacheprovider -o addopts= -q scripts/test_native_stage.py -k 'the_estop_reset_judge or the_p4_variant_is_wired or the_error_line_judge or the_harness_names_the_tool_edit_fields' > /tmp/r437/native-baseline.txt 2>&1
printf 'native baseline exit=%s\n' "$?"
cd /tmp/r437/head/lcnc-webui
node node_modules/vitest/vitest.mjs run src/probeFields.test.ts src/ws/bulkData.test.ts --reporter=verbose > /tmp/r437/unit-baseline.txt 2>&1
printf 'unit baseline exit=%s\n' "$?"
