#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r437/logs
py=/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python
cd /tmp/r437/head/lcnc-gateway
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -q test_estop_reset_outcome.py test_tool_edit_contract.py test_tool_table_watch.py test_error_line_golden.py test_command_policy.py test_payload_contract.py test_bulk_pipeline.py > /tmp/r437/backend-baseline.txt 2>&1
printf 'baseline exit=%s\n' "$?"
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -v test_r437_codex_reset.py > /tmp/r437/reset-probes.txt 2>&1
printf 'reset probe exit=%s\n' "$?"
"$py" /tmp/r437/error-probe.py > /tmp/r437/error-probe.json
printf 'error-line probe exit=%s\n' "$?"
