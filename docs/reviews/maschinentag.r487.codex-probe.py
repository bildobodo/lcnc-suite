"""Independent R487 probes: anchor truth table and same-kind backtracking.
Offline interpreter only; uses the existing no_command native harness.
"""
import itertools
import json
from pathlib import Path
import msgspec
from gateway_util import list_change_indices
from test_path_kinds_worker import payload, vertices, PathKinds

out = Path('/tmp/r487')
checked = 0
for n in range(13):
    for kinds in itertools.product((0, 1), repeat=n):
        seq = [3 * i + 1 for i in range(n)]
        for k in (0, 1):
            mine = [seq[i] for i in range(n) if kinds[i] == k]
            other = [seq[i] for i in range(n) if kinds[i] != k]
            expected = set()
            for j in range(len(mine) - 1):
                if any(mine[j] < q < mine[j + 1] for q in other):
                    expected.update((j, j + 1))
            assert list_change_indices(mine, other) == expected
            checked += 1
print(json.dumps({'anchor_cases': checked}))

cases = {
    'one_reversal': 'G0 Z-2\nG0 Z15\n',
    'two_reversals': 'G0 Z-2\nG0 Z15\nG0 Z-10\nG0 Z20\n',
    'three_reversals': 'G0 Z-10\nG0 Z15\nG0 Z-5\nG0 Z20\n',
}
report = []
for name, body in cases.items():
    program = 'G21 G54 G17 G40 G49 G80 G90 G94\nG0 X50 Y30 Z40\n' + body + 'M2\n'
    src = out / (name + '.json')
    src.write_text(json.dumps([program, 'mm', 0.0, [490], {'zmin': -500, 'zmax': 500}]))
    pair = [payload('@' + str(src), full) for full in (False, True)]
    for full, d in zip((False, True), pair):
        assert d['parse_error'] is None
        (out / (name + ('.full' if full else '') + '.msgpack')).write_bytes(msgspec.msgpack.encode(d))
    # The author's guard accepts these: it proves run ends and spatial set,
    # not monotone progress within a run.
    PathKinds().holds('@' + str(src))
    rows = []
    for d in pair:
        rows.append([{'kind': v['stream'], 'seq': v['seq'], 'xyz': v['p']} for v in vertices(d)])
    report.append({'name':name, 'program':program, 'shipped':rows[0], 'unthinned':rows[1], 'author_property':'passes'})
(out/'own.json').write_text(json.dumps({'anchor_cases':checked,'cases':report}, indent=2)+'\n')
print(json.dumps(report))
