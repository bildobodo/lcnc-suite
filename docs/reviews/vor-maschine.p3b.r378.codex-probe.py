"""R378: review-only probes using the repository's fake latch client/servo.
Run with pytest from an archive of 0acf2a2b; no LinuxCNC or network.
"""
import sys
import os
import time
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(os.environ.get('R378_REPO', Path.cwd())) / 'scripts'))
import test_native_stage as h
from test_support import servo_cases as sc


def row(rows):
    return next(r for r in rows if r['case'] == 'latch-sticky')


def test_a_frame_received_during_the_judgement_before_ack_is_not_dropped(tmp_path, monkeypatch):
    c = h.LatchClient()
    ctx, _ = h._latch_step(tmp_path, monkeypatch, c, [h._latch(after=200), h._recovery()])
    real_judge, real_request = sc.eval_latch_sticky, c.request
    observed = {}
    def judge(*args, **kwargs):
        # A receiver can run while the evaluator processes the captured list.
        # Both frames are before the acknowledgement, with valid provenance.
        c.hide = True
        c.frame()
        observed['bad'] = c.basis_history[-1]
        c.hide = False
        c.frame()
        return real_judge(*args, **kwargs)
    def request(cmd, **kwargs):
        if cmd == 'safety_trip_ack':
            observed['ack'] = time.monotonic()
        return real_request(cmd, **kwargs)
    monkeypatch.setattr(sc, 'eval_latch_sticky', judge)
    c.request = request
    try:
        result = row(h.nr.latch_cases()[1](ctx))
    finally:
        c.until = 0
    assert observed['bad'][0] < observed['ack']
    assert sc.latch_frame_validity([observed['bad']], 'e1') == [None]
    assert observed['bad'][1]['latched'] is True and observed['bad'][2] is None
    print('before-ack', {'actual': result['status'], 'bad_frame_before_ack': True,
          'bad_frame_in_report': any(f[1]['gen'] == observed['bad'][1]['gen'] for f in result['frame_list'])})
    assert result['status'] == 'FAIL', 'A valid TRUE/no-trip frame before the ack must fail'


def test_a_servo_end_failure_still_keeps_the_independent_display_failure(tmp_path, monkeypatch):
    c = h.LatchClient(hide=True)
    broken = {**h._latch(after=200), 'end_error': 'injected end failure', 'problems': ['end unconfirmed']}
    ctx, _ = h._latch_step(tmp_path, monkeypatch, c, [broken, h._recovery()])
    try:
        with pytest.raises(h.nr.StepFailed, match='servo measurement failed'):
            h.nr.latch_cases()[1](ctx)
    finally:
        c.until = 0
    print('failed-end', {'cases': [r['case'] for r in ctx['rows']], 'ack_sent': any(x[0] == 'safety_trip_ack' for x in c.sent)})
    assert any(r['case'] == 'latch-sticky' and r['status'] == 'FAIL' for r in ctx['rows']), 'The display failure must survive the servo END error'


def test_first_post_cont_frame_during_state_save_still_triggers_reset(tmp_path, monkeypatch):
    c = h.LatchClient()
    ctx, _ = h._latch_step(tmp_path, monkeypatch, c, [h._latch(after=200), h._recovery()])
    def cont(state, save, rec, **kwargs):
        s0, s1 = time.monotonic(), time.monotonic()
        c.latched = True
        # Still paused, so exactly one receiver frame while cont() has not
        # returned (representing arrival during save(state)).
        c.frame()
        state['stopped'] = []
        state.setdefault('continued', []).append({**rec, 'outcome': 'continued', 'sigcont': [s0, s1]})
        time.sleep(0.01)
        return 'continued'
    monkeypatch.setattr(h.tp, 'cont', cont)
    monkeypatch.setattr(h.nr, 'LATCH_RESUME_WAIT_S', 0.06)
    try:
        try:
            h.nr.latch_cases()[1](ctx)
        except h.nr.Refused as exc:
            assert 'no status frame after' in str(exc), str(exc)
    finally:
        c.until = 0
    print('first-frame', {'post_cont_frames': len([f for f in c.basis_history if f[1]['latched']]), 'sent': c.sent})
    assert any(cmd == 'estop_reset' for cmd, _ in c.sent), 'A processed frame after SIGCONT already arrived'


def test_control_nominal_step_passes(tmp_path, monkeypatch):
    c = h.LatchClient()
    ctx, _ = h._latch_step(tmp_path, monkeypatch, c, [h._latch(after=200), h._recovery()])
    try:
        result = row(h.nr.latch_cases()[1](ctx))
    finally:
        c.until = 0
    assert result['status'] == 'PASS', result


def test_control_bad_frame_in_the_capture_is_detected():
    result = h._sticky([h._base(), h._old(0), h._new(0, trip=None)])
    assert result['status'] == 'FAIL', result
