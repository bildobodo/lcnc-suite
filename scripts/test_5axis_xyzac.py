# SPDX-License-Identifier: GPL-2.0-or-later
"""Off-machine acceptance: python3 scripts/test_5axis_xyzac.py (C compiler needed).

Checks the shipped meshes/config, guide coverage, and actual model frame tree
against the source-pinned LinuxCNC C oracle. No alternate runtime kinematics.
"""
import configparser
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import unittest

from gen_kins_fixtures import compile_harness, run_oracle

ROOT = Path(__file__).resolve().parents[1]
SIM = ROOT / 'examples/sim_config'
MODEL = SIM / 'machine-5axis-xyzac'
with (MODEL / 'machine.json').open() as f:
    MACHINE = json.load(f)
with (MODEL / 'dimensions.json').open() as f:
    DIMENSIONS = json.load(f)
INI = configparser.ConfigParser(strict=False)
INI.read(SIM / 'lcnc_suite_sim_5axis_xyzac.ini')


def identity():
    return [[int(i == j) for j in range(4)] for i in range(4)]


def mul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def model_matrices(joints):
    matrices = {'root': identity()}
    for group in MACHINE['groups']:
        m = identity()
        for i, value in enumerate(group.get('translate', [0, 0, 0])):
            m[i][3] = value
        for k in MACHINE['kinematics']:
            if k['group'] != group['id']:
                continue
            v = joints[k['joint']]*k['sign']
            axis = 'xyz'.index(k['direction'])
            if k['type'] == 'translate':
                m[axis][3] += v
            else:
                c, s = math.cos(math.radians(v)), math.sin(math.radians(v))
                a, b = (axis+1) % 3, (axis+2) % 3
                m[a][a] = m[b][b] = c
                m[a][b], m[b][a] = -s, s
        matrices[group['id']] = mul(matrices[group['parent']], m)
    return matrices


def tip_in_work(joints, length):
    matrices = model_matrices(joints)
    tool, work = matrices[MACHINE['toolGroup']], matrices[MACHINE['workGroup']]
    tip = [tool[i][3] - length*tool[i][2] - work[i][3] for i in range(3)]
    return [sum(work[j][i]*tip[j] for j in range(3)) for i in range(3)]


class XYZACAcceptance(unittest.TestCase):
    def test_config_and_closed_export_manifest(self):
        self.assertEqual(INI['KINS']['KINEMATICS'], 'xyzac-trt-kins sparm=identityfirst')
        self.assertEqual(INI['DISPLAY']['WEBUI_MACHINE_DIR'], MODEL.name)
        self.assertEqual(INI['DISPLAY']['WEBUI_HOST'], '127.0.0.1')
        self.assertEqual(INI['TRAJ']['COORDINATES'], 'X Y Z A C')
        for j, axis in enumerate('XYZAC'):
            for section in (f'AXIS_{axis}', f'JOINT_{j}'):
                actual = [float(INI[section][k]) for k in ('MIN_LIMIT', 'MAX_LIMIT')]
                self.assertEqual(actual, DIMENSIONS['joint_limits'][j])
            home = float(INI[f'JOINT_{j}']['HOME'])
            self.assertLessEqual(DIMENSIONS['joint_limits'][j][0], home)
            self.assertGreaterEqual(DIMENSIONS['joint_limits'][j][1], home)
        for section, key in [('EMCIO', 'TOOL_TABLE'), ('RS274NGC', 'PARAMETER_FILE'), ('DISPLAY', 'OPEN_FILE')]:
            self.assertTrue((SIM / INI[section][key]).is_file())
        with (SIM / 'lcnc_suite_sim_5axis_xyzac.ini').open() as f:
            ini_text = f.read()
        for pin, value in DIMENSIONS['pins'].items():
            self.assertIn(f'setp xyzac-trt-kins.{pin} {value}', ini_text)
        self.assertIn('motion.tooloffset.z => xyzac-trt-kins.tool-offset', ini_text)
        groups = {'root'}
        for group in MACHINE['groups']:
            self.assertIn(group['parent'], groups)
            groups.add(group['id'])
        self.assertIn(MACHINE['workGroup'], groups)
        self.assertIn(MACHINE['toolGroup'], groups)
        self.assertEqual(len({p['id'] for p in MACHINE['parts']}), len(MACHINE['parts']))
        self.assertEqual({p['file'] for p in MACHINE['parts']}, {p.name for p in MODEL.glob('*.stl')},
                         'Removed components must not leave stale STL exports')
        reports = {p['id']: p for p in DIMENSIONS['parts']}
        for part in MACHINE['parts']:
            self.assertIn(part['group'] or 'root', groups)
            with (MODEL / part['file']).open('rb') as f:
                mesh = f.read()
            self.assertFalse(mesh.startswith(b'version https://git-lfs'), 'Run git lfs pull first')
            count = struct.unpack_from('<I', mesh, 80)[0]
            self.assertEqual(len(mesh), 84 + 50*count)
            self.assertEqual(count, reports[part['id']]['triangles'])
            self.assertTrue(reports[part['id']]['valid'] and reports[part['id']]['closed'])
            for facet in struct.iter_unpack('<12fH', mesh[84:]):
                self.assertTrue(all(math.isfinite(v) for v in facet[:12]))
        self.assertEqual(reports['a_yoke_casting']['solids'], 1, 'The yoke must be a connected casting')
        self.assertEqual(reports['a_bearing_pedestals']['solids'], 2)

    def test_all_guide_blocks_stay_on_rails(self):
        for layout in DIMENSIONS['guides']['layout']:
            axis = layout['axis']
            joint = 'xyz'.index(axis)
            limits = DIMENSIONS['joint_limits'][joint]
            sign = next(k['sign'] for k in MACHINE['kinematics'] if k['joint'] == joint)
            lo, hi = sorted(v*sign for v in limits)
            left = min(layout['block_centres']) + lo - DIMENSIONS['guides']['block_length']/2
            right = max(layout['block_centres']) + hi + DIMENSIONS['guides']['block_length']/2
            self.assertGreaterEqual(left - layout['rail_start'], 10, axis)
            self.assertGreaterEqual(layout['rail_start'] + layout['rail_length'] - right, 10, axis)
            self.assertAlmostEqual((left+right)/2, layout['rail_start']+layout['rail_length']/2, msg=axis)
            self.assertEqual((layout['rails'], layout['blocks']), (2, 4))

    def test_frame_tree_matches_linuxcnc_with_tool_compensation(self):
        rng = random.Random(500)
        joints = [[rng.uniform(*limits) for limits in DIMENSIONS['joint_limits']] for _ in range(2000)]
        worst = 0.0
        with tempfile.TemporaryDirectory(prefix='xyzac5-oracle-') as temp:
            exe = compile_harness(Path(temp))
            for length in (0, 60, 100, 180):
                params = (0, 0, 0, 0, 0, 0, length)
                result = run_oracle(exe, 'xyzac', params,
                                    ['F ' + ' '.join(map(str, q)) + ' 0\n' for q in joints])
                for q, world in zip(joints, result):
                    # Canon adds/removes G43 Z around the kinematics module.
                    oracle_tip = [world[0], world[1], world[2] - length]
                    error = max(abs(a-b) for a, b in zip(tip_in_work(q, length), oracle_tip))
                    worst = max(worst, error)
                    self.assertLess(error, 1e-8)
                back = run_oracle(exe, 'xyzac', params,
                                  ['I ' + ' '.join(map(str, w)) + '\n' for w in result])
                for a, b in zip(joints, back):
                    self.assertLess(max(abs(x-y) for x, y in zip(a, b)), 1e-8)
            # The demo's TCP segment is a fixed tip at (0, 0, 260) with T1.
            world = [[0, 0, 360, a, 0, c] for a in range(-25, 26) for c in range(0, 361, 5)]
            demo = run_oracle(exe, 'xyzac', (0, 0, 0, 0, 0, 0, 100),
                              ['I ' + ' '.join(map(str, w)) + '\n' for w in world])
            for q in demo:
                for value, (lo, hi) in zip(q, DIMENSIONS['joint_limits']):
                    self.assertTrue(lo <= value <= hi)
                self.assertLess(max(abs(v-t) for v, t in zip(tip_in_work(q, 100), (0, 0, 260))), 1e-8)
        print(f'8000 frame/oracle comparisons + inverse roundtrips; worst error {worst:.3g} mm; '
              f'{len(demo)} TCP demo poses inside joint limits')


if __name__ == '__main__':
    unittest.main(verbosity=2)
