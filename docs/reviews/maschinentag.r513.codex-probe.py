"""R513: independent pure source models, no gateway import or controller access.

Run from /tmp. Files are created only inside TemporaryDirectory.
The L20 reference follows find_current_in_system and convert_setup; the
closed form is separate. Floating point samples are not a universal proof.
"""
import hashlib
import json
import math
import random
import shutil
import tempfile
from pathlib import Path


def rotate(v, r):
    theta = r * (math.pi / 180.0)
    c, s = math.cos(theta), math.sin(theta)
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]


def source_l20(p, oa, os, ga, gs, r, requested):
    # All values already in program units; ga/gs are applied/effective G92.
    current_in_system = [p[i] + ga[i] for i in range(9)]
    current_in_system[:2] = rotate(current_in_system[:2], r)
    current_in_system = [current_in_system[i] + oa[i] - os[i] for i in range(9)]
    current_in_system[:2] = rotate(current_in_system[:2], -r)
    current_in_system = [current_in_system[i] - gs[i] for i in range(9)]
    desired = current_in_system[:]
    for i, value in requested.items():
        desired[i] = value
    oldxy = rotate(current_in_system[:2], r)
    desiredxy = rotate(desired[:2], r)
    new_origin = os[:]
    new_origin[:2] = [oldxy[i] + os[i] - desiredxy[i] for i in range(2)]
    for i in range(2, 9):
        if i in requested:
            new_origin[i] = current_in_system[i] + os[i] - requested[i]
    after = p[:]
    after[:2] = rotate(after[:2], r)
    after = [after[i] + oa[i] - new_origin[i] for i in range(9)]
    after[:2] = rotate(after[:2], -r)
    return after


def closed_l20(p, oa, os, ga, gs, r, requested):
    delta = [a - b for a, b in zip(oa, os)]
    delta[:2] = rotate(delta[:2], -r)
    return [requested[i] + gs[i] - ga[i] if i in requested else p[i] + delta[i]
            for i in range(9)]


def check_l20():
    rng = random.Random(513)
    maximum = 0.0
    n = 0
    for r in [0, 30, 90, 359.999, -360]:
        for mask in range(512):
            vectors = [[rng.uniform(-1000, 1000) for _ in range(9)] for _ in range(5)]
            p, oa, os, ga, gs = vectors
            q = {i: rng.uniform(-100, 100) for i in range(9) if mask & (1 << i)}
            expected = closed_l20(p, oa, os, ga, gs, r, q)
            actual = source_l20(p, oa, os, ga, gs, r, q)
            error = max(abs(a - b) for a, b in zip(actual, expected))
            maximum = max(maximum, error)
            assert error < 1e-10, (r, mask, error)
            n += 1
    return {'cases': n, 'max_abs_difference_program_units': maximum,
            'limit': 'same-unit source-expression model; no native units or wrapped-axis acceptance claim'}


def check_angle():
    u = 2.0 ** -53
    rng = random.Random(513)
    max_ratio = 0.0
    n = 0
    for r in [0, 30, 90, 359.999, -360] + [rng.uniform(-360, 360) for _ in range(1000)]:
        for machine in [(1000.0, 0.0), (1e6, -1e6), (0.125, 1000.0)]:
            theta = r * math.pi / 180.0
            c, s = math.cos(theta), math.sin(theta)
            point = [machine[0] * c + machine[1] * s,
                     -machine[0] * s + machine[1] * c]
            result = rotate(point, r)
            error = max(abs(a - b) for a, b in zip(result, machine))
            scale = sum(abs(v) for v in machine)
            rho = scale + sum(abs(v) for v in point)
            bound = 32 * u * scale + (4 * u * abs(theta) + 4 * u) * rho
            assert error <= bound, (r, error, bound)
            max_ratio = max(max_ratio, error / bound)
            n += 1
    return {'cases': n, 'max_error_over_bound': max_ratio,
            'outside_domain': {'rotation': 100000, 'result_by_plan': 'UNPROVEN'},
            'limit': 'source-expression samples on Python math/libm; not compiled native or an ulp proof'}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def check_start_and_optout():
    with tempfile.TemporaryDirectory(prefix='r513-review-', dir='/tmp') as d:
        root = Path(d)
        ini = root / 'machine.ini'
        ini.write_text('[PYTHON]\nTOPLEVEL = read.py\n')
        record = {'instance': [42, 100], 'sha256': sha(ini), 'path': 'PYTHON'}
        backup = root / 'old.ini'
        backup.write_text('[DISPLAY]\nDISPLAY = dummy\n')
        import os
        os.utime(backup, (1, 1))
        shutil.copy2(backup, ini)
        assert sha(ini) != record['sha256'] and ini.stat().st_mtime == 1
        observed_path = record['path'] if sha(ini) == record['sha256'] else 'UNKNOWN'
        assert observed_path == 'UNKNOWN'
        # The shared suite asset and other INI are not part of an opt-out's writes.
        asset = root / 'read_toplevel.py'
        asset.write_text('# shared module\n')
        profile1 = root / 'xyz.ini'
        profile2 = root / 'xyzac.ini'
        line = f'TOPLEVEL = {asset}\n'
        profile1.write_text('[PYTHON]\n' + line + 'PATH_APPEND = custom\n')
        profile2.write_text('[PYTHON]\n' + line)
        other_before = profile2.read_bytes()
        profile1.write_text(profile1.read_text().replace(line, ''))
        assert asset.is_file() and profile2.read_bytes() == other_before
        assert profile1.read_text() == '[PYTHON]\nPATH_APPEND = custom\n'
        return {'restored_old_mtime': True, 'gateway_path_from_v6': observed_path,
                'shared_asset_survives': True, 'other_profile_unchanged': True,
                'foreign_key_keeps_header': True,
                'limit': 'plan model, no production launcher or installer executed'}


if __name__ == '__main__':
    print(json.dumps({'review': 'R513', 'l20': check_l20(), 'angle': check_angle(),
                      'file_models': check_start_and_optout(), 'result': 'PASS',
                      'new_native_run': False}, indent=2))
