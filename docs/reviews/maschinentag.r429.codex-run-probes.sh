export PYTHONDONTWRITEBYTECODE=1
export LCNC_LOG_DIR=/tmp/r429/logs
py=/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python
cd /tmp/r429/p1b/lcnc-gateway
"$py" -m pytest -q test_r429_codex.py > /tmp/r429/p1b-probes.txt 2>&1
printf 'p1b_probe_exit=%s\n' "$?"
python3 -I /tmp/r429/native-probes.py > /tmp/r429/native-probes.json
printf 'native_probe_exit=%s\n' "$?"
python3 -I /tmp/r429/p1b/scripts/test_support/lease_reeval.py /tmp/r429/p1b /tmp/r429/p1b/docs/reviews/jog-lease.native.json > /tmp/r429/native-reeval.json
printf 'native_reeval_exit=%s\n' "$?"
cd /tmp/r429/p3/lcnc-gateway
"$py" -m pytest -q test_r428_adapted.py test_r429_codex.py > /tmp/r429/p3-probes.txt 2>&1
printf 'p3_probe_exit=%s\n' "$?"
