#!/bin/bash
set -eu
cd /tmp/codex-r399/hold/lcnc-webui
node r399-state.mjs > /tmp/r399-state.json
cd /tmp/codex-r399/tooling
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r399-tool-probes.py > /tmp/r399-tool-probes.txt
