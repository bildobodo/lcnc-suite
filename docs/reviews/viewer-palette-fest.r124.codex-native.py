"""R124: native OFFLINE sensitivity of a post-M600 path to its reported result.

Run from an archive's lcnc-gateway directory:
  python ../docs/reviews/viewer-palette-fest.r124.codex-native.py r124_<case>_<ideal|delta>

Uses native_start_probe.py unchanged in memory except adding synthetic cases.
Its fake STAT, private INI/vars/tool mmap and command prohibition remain active.
The assignment AFTER M600 supplies a counterfactual probe result, not a live
measurement or a simulation of the probe input/timing/braking. G10/G43 supply
its matching length (the routine's formula at WCS/G92=0: 180 + #5063).
No repository or live file is edited by this script.
"""
import sys
from pathlib import Path
p = Path.cwd() / 'native_start_probe.py'
source = p.read_text()
prefix = 'G21 G90\nG0 X50 Y50 Z-100\nT2 M600\n'
cases = {}
for label, delta in [('ideal', 0.0), ('delta', 0.1)]:
    seed = (prefix + f'#5063 = [#5063 - {delta}]\n'
            'G10 L1 P2 Z[180 + #5063]\nG43 H2\n'
            'G0 X100 Y20 Z-90\n')
    tails = {
        'fixed': 'G1 X150 F100\nM2\n',
        'amplified': 'G1 X[150 + 100 * [#5063 + 100]] F100\nM2\n',
        'branch': ('o700 if [#5063 LT -100.05]\nG1 X50 F100\n'
                   'o700 else\nG1 X150 F100\no700 endif\nM2\n'),
    }
    for kind, tail in tails.items():
        cases[f'r124_{kind}_{label}'] = seed + tail
marker = 'program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
assert source.count(marker) == 1
injected = 'CASES.update({k: _m600(prog=v) for k, v in ' + repr(cases) + '.items()})\n'
source = source.replace(marker, injected + marker)
exec(compile(source, str(p), 'exec'), {'__name__': '__main__', '__file__': str(p)})
