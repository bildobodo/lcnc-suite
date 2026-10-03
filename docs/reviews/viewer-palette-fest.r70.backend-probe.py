"""R70 counterprobes: real gateway, fake_linuxcnc, private temporary files.
Expected invariants are asserted; failures are review findings, not live tests.
Run from the archived lcnc-gateway with its normal test dependencies.
"""
import asyncio
import json
import os
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_macros_gateway import _Folder, _run, rev, PARK, gateway, linuxcnc

RESULTS = Path(__file__).resolve().parents[1] / 'evidence' / 'viewer-palette-fest.r70.counterprobes.jsonl'

def record(kind, **values):
    row = {'case': kind, **values}
    with RESULTS.open('a') as f:
        f.write(json.dumps(row, ensure_ascii=False)+'\n')
    print(json.dumps(row, ensure_ascii=False), flush=True)

def request(text):
    async def chunks():
        yield text.encode()
    return SimpleNamespace(stream=chunks)

async def until(fn):
    for _ in range(500):
        if fn(): return
        await asyncio.sleep(.01)
    raise AssertionError('probe synchronization timed out')

class ReviewR70(_Folder):
    def test_cancelled_rename_keeps_old_name_locked_until_unlink_finishes(self):
        entered, release = threading.Event(), threading.Event()
        orig = gateway._unlink_renamed
        def slow_unlink(path):
            entered.set()
            if not release.wait(8): raise RuntimeError('probe release missing')
            orig(path)
        newer = PARK + '; second client saved this\n'
        moved = PARK.replace('o<park>', 'o<park2>')
        async def go():
            first = asyncio.create_task(gateway.put_macro(request(moved), name='park2', base='new',
                rename_from='park', rename_base=rev(PARK)))
            try:
                await until(entered.is_set)
                first.cancel()
                await until(lambda: not gateway._get_source_lock().locked())
                second = await gateway.put_macro(request(newer), name='park', base=rev(PARK),
                                                rename_from=None, rename_base=None)
                self.assertTrue(second['ok'])
                self.assertEqual((self.mdir/'park.ngc').read_text(), newer)
            finally:
                release.set()
                try: await first
                except asyncio.CancelledError: pass
        with patch.object(gateway, '_unlink_renamed', slow_unlink):
            _run(go())
        old, new = self.mdir/'park.ngc', self.mdir/'park2.ngc'
        record('cancelled rename versus second save', old_exists=old.exists(),
               new_exists=new.exists(), second_save_was_acknowledged=True,
               second_save_survives=old.exists() and old.read_text()==newer)
        self.assertTrue(old.exists() and old.read_text()==newer,
                        'cancelled rename deleted the second client\'s acknowledged save')

    def test_cancelled_publish_cannot_replace_the_file_after_a_start(self):
        entered, release = threading.Event(), threading.Event()
        old = self.mdir/'park.ngc'
        orig = os.replace
        def slow_replace(src, dest):
            if str(dest)==str(old):
                entered.set()
                if not release.wait(8): raise RuntimeError('probe release missing')
            return orig(src, dest)
        newer = PARK+'; changed revision\n'
        async def go():
            first = asyncio.create_task(gateway.put_macro(request(newer), name='park', base=rev(PARK),
                                                         rename_from=None, rename_base=None))
            try:
                await until(entered.is_set)
                first.cancel()
                await until(lambda: not gateway._get_source_lock().locked())
                self.assertEqual(old.read_text(), PARK)
                async with gateway._get_cmd_lock():
                    await gateway._cmd_blocking(self.cmd.mdi, 'o<park> call', wait=None)
            finally:
                release.set()
                try: await first
                except asyncio.CancelledError: pass
        with patch.object(gateway.os, 'replace', slow_replace):
            _run(go())
        record('cancelled publish versus start', sent=self.cmd.calls,
               claims=[{'state': c.state, 'serial': c.serial} for c in gateway._source_claims],
               file_changed_after_start=old.read_text()!=PARK)
        self.assertEqual(old.read_text(), PARK, 'a still-running start claim did not prevent a late publish')

    def test_rcs_error_with_queued_mdi_is_not_completion_proof(self):
        _run(gateway._cmd_blocking(self.cmd.mdi, 'o<park> call', wait=None))
        gateway.STAT.echo_serial_number = self.cmd.serial+1
        gateway.STAT.state = 3 # RCS_ERROR: another rejected command, no queue-empty proof
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        gateway.STAT.queued_mdi_commands = 1
        gateway._release_start_claims()
        record('RCS_ERROR with queued MDI', claims_remaining=len(gateway._source_claims),
               queued_mdi_commands=gateway.STAT.queued_mdi_commands,
               write_refusal=gateway._source_write_refusal())
        self.assertEqual(len(gateway._source_claims), 1, 'RCS_ERROR cleared an unproven pending start')

    def test_save_conflict_provides_the_revision_required_by_keep_editing(self):
        async def go():
            try:
                await gateway.put_macro(request(PARK+'; draft\n'), name='park', base=rev('old'),
                                        rename_from=None, rename_base=None)
            except gateway.HTTPException as e:
                return e.status_code, e.detail
            raise AssertionError('expected a conflict')
        status, detail = _run(go())
        record('PUT conflict response', status=status, detail=detail, expected_revision=rev(PARK))
        self.assertEqual(detail.get('revision'), rev(PARK), 'Keep editing receives null and changes base to new')

    def test_macro_get_enforces_the_same_folder_scope_as_the_list(self):
        outside = self.cfg/'outside.ngc'
        outside.write_text('private text outside macro folder\n')
        (self.mdir/'escape.ngc').symlink_to(outside)
        listed = [e['name'] for e in gateway._list_macros()['macros']]
        async def go():
            try:
                r = await gateway.get_macro(name='escape')
                return r.status_code, r.body.decode()
            except gateway.HTTPException as e:
                return e.status_code, str(e.detail)
        status, body = _run(go())
        record('symlink GET scope', listed=listed, get_status=status, get_body=body)
        self.assertIn(status, (400,403,404), 'GET read a symlink excluded by the folder list')
