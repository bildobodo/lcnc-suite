"""R429: both log handlers retain newly counted losses on report failure too."""
import errno
import json
import os
import pytest
import lcnc_trace as tr
from test_trace_bundle import _rec, _bundler


@pytest.mark.parametrize('prefix', ['trace', 'crash'])
@pytest.mark.parametrize('report_fails', [False, True])
def test_reentry_and_report_failure_keep_all_losses(tmp_path, prefix, report_fails):
    path = tmp_path / ('crash.log' if prefix == 'crash' else 'trace.ndjson')
    h = tr.CoordinatedFileHandler(str(path), str(tmp_path / (prefix + '.lock')),
                                 max_bytes=0, backups=5, report_prefix=prefix)
    def no_space(fd, data):
        raise OSError(errno.ENOSPC, 'injected')
    h.raw_write = no_space
    assert not h.append(_rec(1, 'first.lost'))
    entered = False
    def write_report(fd, data):
        nonlocal entered
        if not entered:
            entered = True
            assert not h.append(_rec(2, 'nested.lost'))
            if report_fails:
                raise OSError(errno.EIO, 'report refused')
        return os.write(fd, data)
    try:
        h.raw_write = write_report
        assert h.append(_rec(3, 'after')) is (not report_fails)
        h.raw_write = os.write
        assert h.append(_rec(4, 'next'))
        reports = [json.loads(x) for x in path.read_bytes().splitlines()]
        reports = [r for r in reports if r['tag'] == prefix + '.write_lost']
        assert sum(r['count'] for r in reports) == (3 if report_fails else 2)
        assert h.pending_report()['lost'] == 0
        if prefix == 'crash':
            assert all(r['level'] == 'error' for r in reports)
    finally:
        h.close()


def test_multiple_old_fragmented_generations_keep_each_good_record(tmp_path):
    (tmp_path/'crash.log.2').write_bytes(_rec(1, 'first') + b'{"cut":')
    (tmp_path/'crash.log.1').write_bytes(_rec(2, 'second') + b'{"other":')
    (tmp_path/'crash.log').write_bytes(_rec(3, 'third'))
    out=tmp_path/'out'; out.mkdir()
    account=_bundler().copy_crash_log(str(tmp_path), str(out))
    rows=[]
    for line in (out/'crash-snapshot.log').read_bytes().splitlines():
        try: rows.append(json.loads(line))
        except ValueError: pass
    assert [r['tag'] for r in rows] == ['first','second','third']
    assert account['open_ends'] == ['crash.log.2','crash.log.1']
    assert account['damaged'] == {'crash.log.2':1,'crash.log.1':1}
