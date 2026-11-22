#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r430/logs
cd /tmp/r430/p1b/lcnc-gateway
/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python -m pytest -vv test_r430_codex.py > /tmp/r430/p1b-probes.txt 2>&1
r=$?
printf 'p1b: %s\n' "$r"
cd /tmp/r430/p2a/lcnc-gateway
/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python -m pytest -vv test_r430_codex.py::TestR430ReadbackEnd::test_r430_cancel_before_first_task_step_ends_the_hold test_r430_codex.py::TestR430ReadbackEnd::test_r430_binding_error_ends_the_hold_as_failed test_r430_codex.py::TestR430ReadbackEnd::test_r430_new_source_at_the_same_path_gets_its_readback_attempt > /tmp/r430/p2a-probes.txt 2>&1
r=$?
printf 'p2a: %s\n' "$r"
