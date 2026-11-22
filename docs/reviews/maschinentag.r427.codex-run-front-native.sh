set -eu
export PYTHONDONTWRITEBYTECODE=1
python3 -I /tmp/r427/native-probes.py > /tmp/r427/native-probes.json
cd /tmp/codex-r427/lcnc-webui
./node_modules/.bin/vitest run src/jogLease.test.ts src/jogGesture.test.ts src/useGamepad.test.ts src/commandShapes.test.ts src/commandPath.test.ts > /tmp/r427/frontend-unit.txt 2>&1
