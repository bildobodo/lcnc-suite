#!/usr/bin/env python3
"""R510: pure countermodels of plan v3, plus read-only NR-src re-evaluation.

No product imports, LinuxCNC commands, native runs, or live connections.
Frame equations follow the supplied canon source. These counterexamples
test a proposed inference, not an implementation or native reachability.
"""
from dataclasses import asdict, dataclass, replace
import hashlib
import json
import math
from pathlib import Path
import subprocess


ZERO = (0.0, 0.0, 0.0)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def rotate(p, degrees):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return (c * p[0] - s * p[1], s * p[0] + c * p[1], p[2])


def same(a, b):
    return all(abs(x - y) <= 1e-6 for x, y in zip(a, b))


@dataclass(frozen=True)
class Frame:
    row: tuple = ZERO
    g92: tuple = ZERO
    tlo: tuple = ZERO
    rotation: float = 0.0
    index: int = 1

    def work(self, machine):
        return sub(rotate(sub(sub(machine, self.tlo), self.row), -self.rotation), self.g92)

    def machine(self, work):
        return add(add(rotate(add(work, self.g92), self.rotation), self.row), self.tlo)


def proposed_class(interp, stat, stored_row, stored_r, stored_g92, at):
    if (interp.index != stat.index or not same(interp.work(at), stat.work(at))
            or any(interp.tlo) != any(stat.tlo)):
        return "INCONSISTENT"
    narrowed = (same(stored_row, stat.row) and abs(stored_r - stat.rotation) <= 1e-6
                and same(stored_g92, stat.g92))
    return "NARROWED" if narrowed else "TOTAL"


def models():
    out = {}
    # At the rotation's fixed point all printed values agree. The stored
    # rotation equals STAT (direct #5230 writes need not change the applied R).
    i, s = Frame(rotation=90.0), Frame()
    at, target = ZERO, (10.0, 0.0, 0.0)
    cls = proposed_class(i, s, ZERO, 0.0, ZERO, at)
    assert cls == "NARROWED"
    assert same(i.work(at), s.work(at))
    assert same(i.machine(i.work(at)), at)  # proposed _abs self-check also passes
    assert not same(i.machine(target), s.machine(target))
    out["rotation_fixed_point"] = {
        "interpreter": asdict(i), "status": asdict(s), "read_at": at,
        "stored_rotation": 0.0, "class": cls, "next_word": "G0 X10 Y0",
        "actual_machine_target": i.machine(target), "preview_machine_target": s.machine(target),
        "after_jog_machine": target, "interpreter_work_after_jog": i.work(target),
        "status_work_after_jog": s.work(target), "plan_jog_opens": False,
    }
    # Changing only the stored rotation to 90 gives TOTAL. Ordinary motion
    # still exposes the rotation without any of the listed exposing words.
    cls = proposed_class(i, s, ZERO, 90.0, ZERO, at)
    assert cls == "TOTAL"
    out["total_without_exposing_word"] = {"class": cls, "next_word": "G0 X10 Y0",
        "actual_machine_target": i.machine(target), "preview_machine_target": s.machine(target)}

    # TLO/G92 cancel with both TLO flags true. Stored G92 can equal STAT
    # while applied G92 differs (a numbered parameter is not its getter).
    i = Frame(tlo=(0.0, 0.0, 50.0))
    s = Frame(tlo=(0.0, 0.0, 40.0), g92=(0.0, 0.0, 10.0))
    at = (0.0, 0.0, 50.0)
    cls = proposed_class(i, s, ZERO, 0.0, s.g92, at)
    assert cls == "NARROWED"
    i49, s49 = replace(i, tlo=ZERO), replace(s, tlo=ZERO)
    assert not same(i49.machine(ZERO), s49.machine(ZERO))
    out["narrowed_split_then_g49"] = {"interpreter": asdict(i), "status": asdict(s),
        "stored_g92": s.g92, "class": cls, "read_at": at,
        "words": ["G49", "G0 Z0"], "actual_machine_target": i49.machine(ZERO),
        "preview_machine_target": s49.machine(ZERO)}

    # A TOTAL caused by G92/TLO, not by the row. Z touch-off to zero at
    # machine Z50 computes row Z0 again; issuing that row cannot reveal the
    # other two components' cancelled discrepancy, even on a complete read.
    cls = proposed_class(i, s, ZERO, 0.0, i.g92, at)
    assert cls == "TOTAL"
    new_row_z = at[2] - i.tlo[2] - i.g92[2] - 0.0
    new_row = (0.0, 0.0, new_row_z)
    after_i, after_s = replace(i, row=new_row), replace(s, row=new_row)
    after_cls = proposed_class(after_i, after_s, new_row, 0.0, i.g92, at)
    assert new_row_z == 0 and after_cls == "TOTAL"
    out["touch_postread_not_a_general_detector"] = {
        "interpreter": asdict(i), "status": asdict(s), "read_at": at,
        "stored_g92": i.g92, "class_before": cls, "word": "G10 L20 P1 Z0",
        "new_row": new_row, "class_after": after_cls, "postread_detects_inconsistent": False}

    # The plan's own first-TLO example is caught by its tlo_on term.
    i = Frame(row=(0.0, 0.0, 50.0), tlo=(0.0, 0.0, 50.0))
    s = Frame(row=(0.0, 0.0, 100.0))
    cls = proposed_class(i, s, i.row, 0.0, ZERO, (0.0, 0.0, 100.0))
    assert cls == "INCONSISTENT"
    out["plan_g16_example"] = {"interpreter": asdict(i), "status": asdict(s),
        "actual_plan_class": cls, "class_claimed_in_g16": "TOTAL", "reason": "tlo_on differs"}

    # s is relative 1e-9, not machine-precision rounding slack.
    d, t = 1_000_000.0, 1_000_000.0005
    bound = 0.5e-6 + 1e-9 * max(1, abs(d))
    assert abs(t - d) <= bound and abs(t - d) > 1e-6
    out["rounding_bound"] = {"double": d, "token": t, "difference": abs(t-d),
        "printed_vs_double_bound": bound, "accepts": True,
        "g20_half_quantum_in_mm": 0.5e-6 * 25.4}

    # Even eleven out-of-budget values need not truncate END. Range and
    # completeness are different checks.
    packet = 'F5X' + '0' * 16 + ' 01/01 ' + ''.join(f'{-1e9:.6f} ' for _ in range(11)) + 'END'
    assert len(packet.encode()) == 238 and packet.endswith('END')
    out["value_range_not_implied_by_end"] = {
        "values": 11, "value": -1e9, "bytes": len(packet.encode()),
        "within_240": True, "has_end": True}

    # FULL applied fields and two correct current-state comparisons do
    # not validate the publication's stored-row input for a later selection.
    applied, stored, seed, patch = 0.0, 5.0, 5.0, 0.0
    assert applied == patch and stored == seed and stored != patch
    out["publication_roles_must_be_compared"] = {
        "applied_g54_x_and_status": applied, "stored_g54_x_and_file_seed": stored,
        "publication_g54_patch": patch, "applied_components_full": True,
        "ledger_vs_seed_equal": stored == seed, "applied_vs_overlay_equal": applied == patch,
        "words": ["G55", "G54", "G0 X10"],
        "actual_machine_x": stored + 10, "preview_machine_x": patch + 10,
        "full_publication_need_equal": False}
    return out


def native_recheck():
    root = Path('/home/cnc/claude-work/start/step0/runs')
    result = []
    for run in ('20261126T134657-nrsrc2A', '20261126T135215-nrsrc2B'):
        path = root / run / 'report.json'
        data = path.read_bytes()
        r = json.loads(data)
        cases = r['nrsrc']['cases']
        stale = cases['STALE']['row_stale']
        sample = cases['STALE']['plain_start']['sample']['machine_pos']
        assert same(sample, (14.090389553440874, 10.833504408394036, 0.0))
        assert stale['stat_after']['rotation_xy'] == 0
        assert stale['interp']['p5230'] == 5
        trace = root / run / 'logs/trace.ndjson'
        starts = [x for line in trace.read_text().splitlines()
                  if (x := json.loads(line)).get('tag') == 'run_basis.start'
                  and x.get('file') == 'nrsrc2_plain.ngc']
        assert len(starts) == 1 and starts[0]['verified'] is True
        coord = cases['COUNTERS']['c1']['interp']['coord']
        h2 = cases['COUNTERS']['G43_H2']['snap']
        assert h2['interp']['p5403'] == 50
        assert h2['stat_after']['tool_offset'][2] == 47.690467
        result.append({'run': run, 'report_sha256': hashlib.sha256(data).hexdigest(),
                       'commit': r['commit'], 'case_errors': r['nrsrc']['case_errors'],
                       'restore': r['restore']['outcome'],
                       'read_active_index_name': coord,
                       'h2_status_tlo_z': h2['stat_after']['tool_offset'][2],
                       'h2_p5403': h2['interp']['p5403'],
                       'stale_row': {'status_r': stale['stat_after']['rotation_xy'],
                                     'stored_r': stale['interp']['p5230'],
                                     'program_point': [stale['interp']['ix'],stale['interp']['iy']]},
                       'plain_run_machine_sample': sample, 'trace_start': starts[0],
                       'trace_sha256': hashlib.sha256(trace.read_bytes()).hexdigest()})
    return result


if __name__ == '__main__':
    repo = '/home/cnc/lcnc-suite'
    changed = subprocess.check_output(['git', '-C', repo, 'diff', '--name-only',
        'dbd14cab', '4abc58ba', '--', 'lcnc-gateway/gateway.py', 'lcnc-gateway/bulk_pipeline.py'], text=True).splitlines()
    assert changed
    print(json.dumps({'kind': 'plan countermodels and existing native data re-evaluation',
                      'new_native_run': False, 'product_tests_run': False,
                      'models': models(), 'native_recheck': native_recheck(),
                      'native_head_not_product_identical_to_plan_base': changed,
                      'result': 'all assertions passed; no native reachability claimed for models'},
                     ensure_ascii=False, indent=2))
