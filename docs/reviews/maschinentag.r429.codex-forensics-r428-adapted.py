"""R428: counterexamples using the candidate's real writer and bundler."""
import errno
import json
import os

import lcnc_trace as tr
from test_trace_bundle import _bundler, _rec


def _rows(path):
    rows = []
    for line in path.read_bytes().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def test_a_reentrant_loss_during_the_report_is_not_erased(tmp_path):
    path = tmp_path / 'trace.ndjson'
    h = tr.CoordinatedFileHandler(str(path), str(tmp_path / 'trace.lock'),
                                 max_bytes=0, backups=5, report_prefix='trace')
    def full(fd, data):
        raise OSError(errno.ENOSPC, 'injected full disk')
    h.raw_write = full
    assert h.append(_rec(1, 'lost.enospc')) is False
    called = False
    def report_reenters(fd, data):
        nonlocal called
        if not called:
            called = True
            assert h.append(_rec(2, 'lost.reentrant')) is False
        return os.write(fd, data)
    h.raw_write = report_reenters
    try:
        assert h.append(_rec(3, 'after'))
        h.raw_write = os.write
        assert h.append(_rec(4, 'next'))
        reports = [r for r in _rows(path) if r.get('tag') == 'trace.write_lost']
        assert sum(r['count'] for r in reports) + h.pending_report()['lost'] == 2, {
            'reports': reports, 'pending': h.pending_report()}
    finally:
        h.close()


def test_crash_snapshot_keeps_the_first_good_line_after_a_rotated_fragment(tmp_path):
    path = tmp_path / 'crash.log'
    # A terminated process can leave this last, incomplete line (R426).
    path.write_bytes(b'{"cut":')
    h = tr.CoordinatedFileHandler(str(path), str(tmp_path / 'crash.lock'),
                                 max_bytes=32, backups=5, report_prefix='crash')
    try:
        assert h.append(_rec(2, 'crash.after', level='error'))
    finally:
        h.close()
    assert 'crash.after' in [r['tag'] for r in _rows(path)]
    assert (tmp_path / 'crash.log.1').read_bytes() == b'{"cut":\n'
    out = tmp_path / 'bundle'
    out.mkdir()
    account = _bundler().copy_crash_log(str(tmp_path), str(out))
    assert account['lock'] == 'held'
    assert 'crash.after' in [r.get('tag') for r in _rows(out / 'crash-snapshot.log')], {
        'snapshot': (out / 'crash-snapshot.log').read_text(), 'account': account}
