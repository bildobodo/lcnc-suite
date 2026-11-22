#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r435/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r435/head/lcnc-gateway
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -q test_toolsetter_basis.py test_bulk_pipeline.py > /tmp/r435/product-baseline.txt 2>&1
printf 'product baseline exit=%s\n' "$?"
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -v test_r435_codex_product.py > /tmp/r435/product-probes.txt 2>&1
printf 'product probes exit=%s\n' "$?"
cd /tmp/r435/head
"$py" -m pytest -p no:cacheprovider -v scripts/test_native_stage.py -k 'parse_basis or parse_nice or pb_owed or quiet_wait or r430 or r431 or r432 or r433 or the_window_is_the_gateways_stream or a_window_rotated_within or a_window_is_framed_only or a_slow_confirmed_read_back' > /tmp/r435/native-baseline.txt 2>&1
printf 'native baseline exit=%s\n' "$?"
"$py" -m pytest -p no:cacheprovider -v scripts/test_r435_codex_nice.py > /tmp/r435/nice-probes.txt 2>&1
printf 'nice probes exit=%s\n' "$?"
