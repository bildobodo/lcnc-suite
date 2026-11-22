set -eu
cd /tmp/codex-r427/lcnc-gateway
export PYTHONDONTWRITEBYTECODE=1
export LCNC_LOG_DIR=/tmp/r427/logs
/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python -m pytest -q test_jog_lease.py test_jog_lease_gateway.py > /tmp/r427/backend-baseline.txt 2>&1
set +e
/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python -m pytest -q test_r427_codex.py > /tmp/r427/backend-probes.txt 2>&1
r427_rc=$?
printf 'Independent regression exit: %s\n' "$r427_rc"
cat /tmp/r427/backend-probes.txt
exit 0
