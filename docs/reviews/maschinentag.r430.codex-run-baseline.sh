set -eu
export PYTHONDONTWRITEBYTECODE=1
export LCNC_LOG_DIR=/tmp/r430/logs
py=/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python
cd /tmp/r430/p1b/lcnc-gateway
"$py" -m pytest -q test_jog_lease.py test_jog_lease_gateway.py test_r427_codex.py test_r428_codex.py test_r429_codex.py > /tmp/r430/p1b-baseline.txt 2>&1
cd /tmp/r430/p2a/lcnc-gateway
"$py" -m pytest -q test_toolsetter_basis.py test_bulk_pipeline.py > /tmp/r430/p2a-baseline.txt 2>&1
cd /tmp/r430/p2a
"$py" -m pytest -q scripts/test_native_stage.py -k parse_basis > /tmp/r430/p2a-native-tests.txt 2>&1
