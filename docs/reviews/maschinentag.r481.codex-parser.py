"""Independent R481 byte/index checks. No controller or HAL connection.
Usage: python3 -I parser_probe.py ARCHIVE_ROOT ORACLE_BINARY OUTPUT_JSON
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root, oracle, output = map(Path, sys.argv[1:])
sys.path.insert(0, str(root / 'lcnc-gateway'))
from tool_table import home_tools, tool_table_bytes, ToolTableUnreadable

cases = []
for n in (0, 1, 998, 999, 1000, 1001):
    prefix = b''.join(b'T%d P%d\n' % (i, i) for i in range(1, n + 1))
    for line in (b'T20 P20 P21\n', b'P20 Px T20\n', b'#old P20\n', b'T20 Z1\n', b';P20\n'):
        cases.append((f'index-limit-{n}-{line!r}', prefix + line + b'T30 P30\n'))
for n in (253, 254, 255, 256, 509, 510, 511, 512, 765):
    for end in (b'\n', b'\r\n', b''):
        for first in (b';', b'#'):
            cases.append((f'chunks-{n}-{first!r}-{end!r}', first + b'x' * (n - 1) +
                          b' T20 P20' + end + b'T30 P30\n'))
for n in (-2**63-1, -2**63, -2**31-1, -2**31, -1, 0, 2**31-1, 2**31, 2**63-1, 2**63):
    for field in ('T', 'P', 'Q'):
        for space in ('', '\t', '\v'):
            row = dict(T='11', P='21', Q='3')
            row[field] = space + str(n)
            cases.append((f'integer-{field}-{n}-{space!r}',
                          (' '.join(k+v for k,v in row.items()) + '\nT30 P30\n').encode()))
for n in range(1, 41):
    rows = [dict(T=i, P=i+100, Z=i/7, D=i/11, Q=i%10,
                 remark=('ä ; # T8 P8 ' * (n % 5))) for i in range(1, n + 1)]
    cases.append((f'writer-{n}', tool_table_bytes(rows)))

results = []
with tempfile.TemporaryDirectory(prefix='r481-oracle-') as folder:
    path = Path(folder) / 'tool.tbl'
    for name, data in cases:
        path.write_bytes(data)
        p = subprocess.run([str(oracle), str(path)], capture_output=True)
        native = {int(i):(int(t),int(p)) for i,t,p in re.findall(rb'ROW (\d+) (-?\d+) (-?\d+) ', p.stdout)}
        try:
            ours = home_tools(data)
            ok = p.returncode == 0 and ours == native
            results.append(dict(case=name, ok=ok, count=len(ours),
                                **({} if ok else dict(data=data.hex(), ours=ours,native=native))))
        except ToolTableUnreadable as e:
            results.append(dict(case=name, ok=False, error=str(e)))
out = dict(head='0d43896e', oracle=str(oracle),
           oracle_sha256=hashlib.sha256(oracle.read_bytes()).hexdigest(),
           source_sha256=hashlib.sha256((oracle.parent/'tooldata_common.cc').read_bytes()).hexdigest(),
           total=len(results), passed=sum(r['ok'] for r in results), results=results)
output.write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({k:v for k,v in out.items() if k != 'results'}))
raise SystemExit(0 if all(r['ok'] for r in results) else 1)
