"""Run from the archived lcnc-gateway directory; no live controller calls.

Put native_probe.py there as r92.native_probe.py. Put this file and the
native-cases.json in the adjacent evidence directory. The native probe
replaces linuxcnc.stat and makes linuxcnc.command raise before worker.parse.
"""
import json
import subprocess
import sys
from pathlib import Path

evidence = Path('../evidence')
cases = json.loads((evidence / 'viewer-palette-fest.r92.codex-native-cases.json').read_text())
results = {}
for name in cases:
    output = evidence / ('viewer-palette-fest.r92.codex-' + name + '.msgpack')
    p = subprocess.run([sys.executable, 'r92.native_probe.py', name, str(output)],
                       capture_output=True, text=True, timeout=45)
    lines = [line for line in p.stdout.splitlines() if line.startswith('{')]
    results[name] = {'returncode': p.returncode,
                     'result': json.loads(lines[-1]) if lines else None,
                     'stderr': p.stderr}
    print(name, json.dumps(results[name]), flush=True)
(evidence / 'viewer-palette-fest.r92.codex-native.json').write_text(
    json.dumps(results, indent=2) + '\n')
