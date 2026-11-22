set -eu
export PYTHONDONTWRITEBYTECODE=1
export LCNC_LOG_DIR=/tmp/r428/logs
py=/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python
cd /tmp/r428/p1b/lcnc-gateway
"$py" -m pytest -q test_jog_lease.py test_jog_lease_gateway.py test_r427_codex.py > /tmp/r428/p1b-backend.txt 2>&1
cd /tmp/r428/p1b
"$py" -m pytest -q scripts/test_native_stage.py -k lease > /tmp/r428/p1b-native-unit.txt 2>&1
python3 -I /tmp/r428/r427-native-adapted.py > /tmp/r428/r427-native-adapted.json
cd /tmp/r428/p3/lcnc-gateway
"$py" -m pytest -q test_trace_rotation.py test_trace_bundle.py test_trip_trace.py > /tmp/r428/p3-backend.txt 2>&1
cd /tmp/r428/p3/lcnc-webui
./node_modules/.bin/vitest run src/stallWindow.test.ts src/holdGesture.test.ts src/ws/telemetry.test.ts src/viewerPerf.test.ts > /tmp/r428/p3-unit.txt 2>&1
