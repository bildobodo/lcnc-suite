#!/bin/bash
# The jog-lease spec hardening's stability record (Codex R439/R440): the
# page-clock test 30 times under three parallel workers and CPU load, then the
# OLD real-time test (594e333c) the same way. Every result is reported — no
# retry, no selection; 0/30 failures of the old test is an honest outcome.
# Run from the tree's root under the heavy lock. The load: two Node busy
# loops (nothing installed), stopped at the end whatever happens.
#
#   bash docs/reviews/jog-lease-hardening.load.sh <out-dir>
set -u
OUT=${1:?out dir}
mkdir -p "$OUT"
cd "$(dirname "$0")/../../lcnc-webui" || exit 2
TITLE="a held jog button names its lease, the page renews it, its release ends exactly that lease"
node -e 'for(;;){}' & L1=$!
node -e 'for(;;){}' & L2=$!
OLD=e2e/zz-old-jog-lease.spec.ts
cleanup() { kill "$L1" "$L2" 2>/dev/null; rm -f "$OLD"; }
trap cleanup EXIT
run() {   # $1 label, $2 spec
  PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/$1.json" npx playwright test "$2" -g "$TITLE" \
    --repeat-each=30 --workers=3 --retries=0 --reporter=json >/dev/null 2>"$OUT/$1.stderr"
  echo "$1 rc $?"
}
run new e2e/jog-lease.spec.ts
git show 594e333c:lcnc-webui/e2e/jog-lease.spec.ts > "$OLD"
run old "$OLD"
python3 -I - "$OUT" <<'EOF'
import json, sys, pathlib
out = pathlib.Path(sys.argv[1])
summary = {}
for label in ("new", "old"):
    d = json.loads((out / f"{label}.json").read_text())
    runs = []
    def walk(suite):
        for s in suite.get("suites", []):
            walk(s)
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                for r in t.get("results", []):
                    err = (r.get("error") or {}).get("message", "")
                    runs.append({"status": r.get("status"), "ms": r.get("duration"),
                                 "worker": r.get("workerIndex"), "error": err.splitlines()[0][:200] if err else None})
    for s in d.get("suites", []):
        walk(s)
    summary[label] = {"runs": len(runs), "passed": sum(r["status"] == "passed" for r in runs),
                      "failed": sum(r["status"] != "passed" for r in runs), "each": runs}
(out / "summary.json").write_text(json.dumps(summary, indent=1))
print(json.dumps({k: {kk: v[kk] for kk in ("runs", "passed", "failed")} for k, v in summary.items()}))
EOF
