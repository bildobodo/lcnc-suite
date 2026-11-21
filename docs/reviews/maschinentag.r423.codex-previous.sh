set -eu
cd /tmp/codex-r422/lcnc-webui
npx vitest run src/r423-dragLifecycle.test.ts > /tmp/r423/previous-unit.txt 2>&1
