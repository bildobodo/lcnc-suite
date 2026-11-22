"""R431: native measurement negative evidence, no controller or live process."""
import json
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import pytest
import native_run as nr
from test_support import native_cases as nc

KEYS = [3004,3005,3006,3007,3009,3010,3013,3014] + list(range(3100,3116))


def ops(last='confirmed'):
    ev = [{'tag':'gcode.spawn_start','reason':'tool_offset','nice':19}]
    for i in range(3):
        v = i * 4 + 3
        ev += [
            {'tag':'toolsetter.basis','version':v-2,'origin':'assumed','keys':[3014]},
            {'tag':'toolsetter.basis','version':v-1,'origin':'applied','keys':[3014]},
            {'tag':'toolsetter.basis','version':v,'origin':'assumed','keys':KEYS},
            {'tag':'gcode.reparse_toolsetter_held','version':v,'why':'read_back'},
        ]
        outcome = 'confirmed' if i < 2 else last
        if outcome == 'confirmed':
            ev += [{'tag':'toolsetter.basis','version':v+1,'origin':'read','keys':KEYS},
                   {'tag':'toolsetter.read_back_outcome','attempt_version':v,'outcome':'confirmed'},
                   {'tag':'toolsetter.read_back','version':v+1,'state':'confirmed'}]
        elif outcome in ('failed','aborted'):
            ev += [{'tag':'toolsetter.read_back_outcome','attempt_version':v,'outcome':outcome}]
        elif outcome in ('cap','no_anchor'):
            ev += [{'tag':'toolsetter.read_back_outcome','attempt_version':v,'outcome':'not_admitted'},
                   {'tag':'gcode.reparse_toolsetter_hold_ended','version':v,'why':outcome}]
    return ev


@pytest.mark.parametrize('last', ['failed', 'aborted', 'cap', 'no_anchor'])
def test_unconfirmed_last_attempt_is_not_a_zero_parse_pass(last):
    row = nc.eval_parse_basis('pb', {'framed':True,'events':ops(last)}, ops=3, quiet_s=4.5)
    assert row['status'] == 'incomplete', row


def test_complete_confirmations_are_a_pass():
    row = nc.eval_parse_basis('pb', {'framed':True,'events':ops()}, ops=3, quiet_s=4.5)
    assert row['status'] == 'PASS', row


def test_another_revisions_outcome_does_not_settle_the_last_attempt():
    ev = ops(None) + [{'tag':'toolsetter.read_back_outcome','attempt_version':10,'outcome':'confirmed'}]
    row = nc.eval_parse_basis('pb', {'framed':True,'events':ev}, ops=3)
    assert row['status'] == 'incomplete', row


def test_a_framed_gateway_loss_is_no_evidence_that_no_parse_ran():
    pid, token = 101, 'codex-r431'
    prefix = {'proc':'gateway', 'pid':pid, 't_wall_ns':100}
    events = [dict(prefix, tag='client.diag', native_mark=token, edge='start')]
    events += [dict(prefix, **e) for e in ops()]
    # The P3 handler explicitly reports records whose contents did not reach
    # this otherwise well-formed stream. They can include the parse start.
    events += [dict(prefix, tag='trace.write_lost', log='trace.ndjson', count=2, t_wall_ns=150,
                    since_ns=101, why={'lock_busy':2})]
    events += [dict(prefix, tag='client.diag', native_mark=token, edge='end', t_wall_ns=200)]
    raw = ''.join(json.dumps(e)+'\n' for e in events).encode()
    window = nc.frame_window([('trace.ndjson',42,raw)],token,pid)
    row = nc.eval_parse_basis('pb',window,ops=3,quiet_s=4.5)
    nice = nc.eval_parse_nice('pb.nice',window)
    assert (row['status'], nice['status']) == ('incomplete','incomplete'), {'framed':window['framed'], 'basis':row, 'nice':nice}


class Clock:
    t = 0.0
    def monotonic(self):return self.t
    def sleep(self,s):self.t += s


def test_temporary_trace_read_failure_does_not_end_the_owed_wait():
    clock, calls = Clock(), []
    pid = 101
    def files(_path):
        calls.append(round(clock.t,3))
        if 0.5 <= clock.t < 1.0:
            return [], ['trace.ndjson: PermissionError: transient read failure']
        ev = ops('confirmed' if clock.t >= 5.0 else None)
        data = ''.join(json.dumps(dict(e,pid=pid,proc='gateway',t_wall_ns=100))+'\n' for e in ev).encode()
        return [('trace.ndjson',42,data)], []
    with patch.object(nr, 'time', clock), patch.object(nr, '_trace_files', files):
        try:
            waited = nr._pb_quiet(SimpleNamespace(status={'preview_refresh':None}), 'pb',
                owed=lambda:nc.pb_owed(nr._gateway_events_since({'gateway_pid':pid,'run':Path('/unused')},0)))
        except nr.Refused:
            return  # Refusing the damaged observation is safe too.
    assert waited >= 5.0 + nr.PB_QUIET_S, {'waited':waited,'reads_at':calls}
