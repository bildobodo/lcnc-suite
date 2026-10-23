#!/usr/bin/env python3
"""R186 review-only proof probes. Uses the unmodified supplied report helpers
and evidence from the real viewer consumer/perf collector (context.test.ts).
Set R186_PROBE_ROOT to the temp root containing measurement-tools and context-evidence.json.
Two contract tests deliberately go red for a false-positive R verdict.
No driver main, program generator main, server or machine is used.
"""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get('R186_PROBE_ROOT', '/tmp/codex-r186-t9s1ym0l'))
sys.path.insert(0, str(ROOT / 'measurement-tools'))
import bpc2 as report

context = json.loads((ROOT / 'context-evidence.json').read_text())
evidence = {}


def spans():
    return [dict(job=9, pid=1, file='synthetic.ngc', pinned=True,
                 p0_ns=10_000_000_000, p1_ns=11_000_000_000, t_wall_ns=15_000_000_000)]


def pairs():
    # Gateway and page happen to have the same zero; the algorithm never uses that.
    # Actual gateway stamps 10150/10850 are inside the actual parse 10000..11000.
    return {'P': [dict(seq=1, hs=10100, hr=10200, g=10150, pid=1),
                  dict(seq=2, hs=10800, hr=10900, g=10850, pid=1)]}


def word(s=(10300, 10350), **kwargs):
    return dict(tag='browser.collision.sweep_witness', page='P', id=42, run_gen=7,
                range_from=0, shard=0, gen=1, s=list(s), ahead_ms=-1, **kwargs)


def verdict(name, sp=None, ps=None, words=None, ahead=None):
    slices, aw = report.slices_of([word()] if words is None else words, {'P', 'Q'})
    result = report.r_verdict(spans() if sp is None else sp, pairs() if ps is None else ps,
                              slices, set() if ahead is None else ahead, aw)
    evidence[name] = result
    return result['verdict']


class Proof(unittest.TestCase):
    def test_positive_single_source_slice(self):
        self.assertEqual(verdict('positive'), 'R overlap proven')

    def test_no_worker_end_no_proof(self):
        sp = spans(); sp[0]['p1_ns'] = None
        self.assertEqual(verdict('missing_end', sp=sp), 'R overlap not proven')

    def test_other_gateway_cannot_lend_heartbeats(self):
        ps = pairs(); ps['P'][0]['pid'] = ps['P'][1]['pid'] = 2
        self.assertEqual(verdict('other_gateway', ps=ps), 'R overlap not proven')

    def test_pauses_are_not_filled(self):
        self.assertEqual(verdict('pause', words=[word((9300, 9350, 11300, 11350))]), 'R overlap not proven')

    def test_late_completion_does_not_extend_source_work(self):
        w = word((9300, 9350)); w['t_wall_ns'] = 10_600_000_000
        self.assertEqual(verdict('late_completion', words=[w]), 'R overlap not proven')

    def test_parent_interval_never_replaces_parse_call(self):
        sp = spans(); sp[0]['p0_ns'] = 8_000_000_000; sp[0]['p1_ns'] = 9_000_000_000
        self.assertEqual(verdict('real_parse_ended_before', sp=sp), 'R overlap not proven')

    def test_pages_are_not_mixed(self):
        w = word(); w['page'] = 'Q'
        self.assertEqual(verdict('other_page', words=[w]), 'R overlap not proven')

    def test_resolution_takes_away_a_boundary_only_intersection(self):
        self.assertEqual(verdict('resolution_boundary', words=[word((10199, 10203))]), 'R overlap not proven')

    def test_detected_collision_clock_ahead_is_rejected(self):
        self.assertEqual(verdict('ahead_detected', words=[context['aheadVisible']['row']]), 'R overlap not proven')

    def test_detected_ws_clock_ahead_is_rejected(self):
        self.assertEqual(verdict('ws_ahead_detected', ahead={'P'}), 'R overlap not proven')

    def test_contract_delayed_message_cannot_mask_collision_clock_shift(self):
        case = context['collisionAheadMasked']
        self.assertLess(case['actualSlice'][1], 10000)  # source work really ended before the parse.
        got = verdict('collision_clock_masked', words=[case['row']])
        evidence['collision_clock_masked']['ground_truth'] = case
        self.assertEqual(got, 'R overlap not proven',
                         'actual slice 8300..8350, parse 10000..11000; delayed arrival masks +2000 ms')

    def test_contract_delayed_apply_cannot_mask_ws_clock_shift(self):
        case = context['wsAheadMasked']; epoch = case['epoch']
        r = copy.deepcopy(case['row']); r.update(page='P', t_wall_ns=15_000_000_000)
        ps, ahead = report.hb_pairs_of([r], {'P'}, 0, 20_000_000_000)
        self.assertEqual(ahead, set()); self.assertEqual(r['age_neg'], 0)
        # The collision clock agrees with the page. Its actual slice is AFTER the parse.
        w = word((epoch + 12300, epoch + 12350))
        got = verdict('ws_clock_masked', ps=ps, words=[w], ahead=ahead)
        evidence['ws_clock_masked']['ground_truth'] = {
            'actual_slice_page_relative_ms': [12300, 12350], 'actual_parse_page_relative_ms': [10000, 11000],
            'ws_offset_ms': 2000, 'real_status_ages_ms': case['actualAges'], 'perf_row': r,
        }
        self.assertEqual(got, 'R overlap not proven', 'the shifted heartbeat window falls after the true parse')

    def test_constant_offset_interval_control_instead_of_sign_check(self):
        # Page sends p0, worker stamps w between its receipt and reply, page receives p1.
        # Offset theta = W-P is in [w-p1, w-p0]. Each known slice is surely active only
        # on [s0-L, s1-U]. A wide uncertainty yields no certain interval, never a proof.
        def certainly_active(s, p0, w, p1):
            low, high = w-p1, w-p0
            return s[0]-low, s[1]-high
        # Accurate narrow exchange reveals the +2000 shift and maps the slice BEFORE parse.
        a = certainly_active((10300, 10350), 8000, 10001, 8002)
        self.assertEqual(a, (8301, 8349)); self.assertLess(a[1], 10000)
        # A delayed response gives large uncertainty; it cannot authorize a narrow slice.
        b = certainly_active((10300, 10350), 8000, 10001, 10102)
        self.assertGreater(b[0], b[1])
        # A real active overlap with the same nonzero clock offset is still provable.
        c = certainly_active((12300, 12350), 10000, 12001, 10002)
        self.assertEqual(c, (10301, 10349)); self.assertGreater(c[1], 10202); self.assertLess(c[0], 10798)
        evidence['bounded_relation_control'] = {'before': a, 'uncertain_empty': b, 'actual_overlap': c}


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Proof)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    evidence['_result'] = dict(run=result.testsRun, failures=len(result.failures), errors=len(result.errors))
    (ROOT / 'tools-evidence.json').write_text(json.dumps(evidence, indent=2))
    raise SystemExit(not result.wasSuccessful())
