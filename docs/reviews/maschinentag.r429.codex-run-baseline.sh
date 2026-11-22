set -eu
export PYTHONDONTWRITEBYTECODE=1
export LCNC_LOG_DIR=/tmp/r429/logs
py=/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python
cd /tmp/r429/p1b/lcnc-gateway
"$py" -m pytest -q test_jog_lease.py test_jog_lease_gateway.py test_r427_codex.py test_r428_codex.py > /tmp/r429/p1b-backend.txt 2>&1
cd /tmp/r429/p1b
"$py" -m pytest -q scripts/test_native_stage.py -k 'lease or blocked_page_judge' > /tmp/r429/p1b-native.txt 2>&1
cd /tmp/r429/p1b/lcnc-webui
./node_modules/.bin/vitest run src/jogLease.test.ts > /tmp/r429/p1b-frontend.txt 2>&1
cd /tmp/r429/p3/lcnc-gateway
"$py" -m pytest -q test_trace_rotation.py test_trace_bundle.py test_trip_trace.py test_r428_codex.py -k 'not test_crash_snapshot_keeps' > /tmp/r429/p3-backend.txt 2>&1
