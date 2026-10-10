"""R126 native offline cases. Run from an archive's lcnc-gateway directory.
Uses native_start_probe's synthetic STAT, private files and command prohibition.
No actual probe input, motion controller, HAL or live gateway is accessed.
The resulting payloads are used in independent client tests with synthetic bodies.
"""
from pathlib import Path
p = Path.cwd() / 'native_start_probe.py'
source = p.read_text()
marker = 'program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
programs = {
    'r126_loop_band': ('G21 G90\nG0 X50 Y50 Z-100\n#3009=2\no100 repeat [2]\nT2 M600\n#3009=3\no100 endrepeat\nM2\n', None),
    'r126_exit_rapid': ('G21 G90\nG0 X10 Y50 Z-100\nT2 M600\nG0 X20 Y10\nM2\n', {3106: 0, 3108: 1}),
}
injected = ('\nfor _name, (_program, _vars) in ' + repr(programs) + '.items():\n'
            '    CASES[_name] = _m600(_vars, prog=_program, zvmax=100, '
            'axis_z="MAX_ACCELERATION = 500\\nOFFSET_AV_RATIO = 0.2", '
            'ini="[EMCMOT]\\nSERVO_PERIOD = 1000000")\n')
assert source.count(marker) == 1
source = source.replace(marker, injected + marker)
exec(compile(source, str(p), 'exec'), {'__name__': '__main__', '__file__': str(p)})
