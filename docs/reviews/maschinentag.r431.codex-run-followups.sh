#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r431/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r431/head/lcnc-gateway
for f in test_r430_codex.py test_r430_adapted.py; do
  "$py" -m pytest -o addopts='--ignore=test_viewer_init.py' -q "$f::TestR430ReadbackEnd::test_r430_cancel_before_first_task_step_ends_the_hold" "$f::TestR430ReadbackEnd::test_r430_binding_error_ends_the_hold_as_failed" "$f::TestR430ReadbackEnd::test_r430_new_source_at_the_same_path_gets_its_readback_attempt" > "/tmp/r431/${f%.py}.txt" 2>&1
  r=$?
  printf '%s: %s\n' "$f" "$r"
done
cd /tmp/r431/head
"$py" -m pytest -q scripts/test_native_stage.py::test_r430_the_window_closed_before_the_last_read_back_is_incomplete scripts/test_native_stage.py::test_a_slow_confirmed_read_back_inside_the_window_passes scripts/test_native_stage.py::test_not_admitted_is_owed_until_the_hold_ends_at_its_bound scripts/test_native_stage.py::test_the_quiet_wait_waits_for_the_owed_read_back_then_its_quiet > /tmp/r431/native-new-baseline.txt 2>&1
r=$?
printf 'new native guards: %s\n' "$r"
