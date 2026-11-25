"""R471 independent probes: final admission poll and REST reload ownership.
Only fake_linuxcnc; real gateway entry paths, temporary files.
"""
import asyncio
import io
import json
import threading
import unittest
from unittest.mock import patch

from test_tool_proof_gateway import _Tools, _Io, INI, gateway, current, FakeConnection, swap_connection
from fastapi import UploadFile
from tool_table import parse_tool_table


class ReviewR471(_Tools):
    def edit_at_final_poll(self, action):
        msg = {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 49.0,
               'flutes': 5, 'expected': self.expect(1)}
        stat = current().stat
        real_admit, real_poll = gateway._write_admission_refusal, stat.poll
        phase, admissions = threading.local(), []
        reached, release = threading.Event(), threading.Event()
        before = (self.table.read_bytes(), self.store._path.read_bytes())

        def poll():
            if getattr(phase, 'second', False):
                reached.set()
                if not release.wait(3):
                    raise AssertionError('review harness: final poll never released')
            return real_poll()

        def admission(*a, **kw):
            admissions.append(1)
            phase.second = len(admissions) == 2
            try:
                return real_admit(*a, **kw)
            finally:
                phase.second = False

        async def run():
            gateway._cmd_lock = None
            t = asyncio.create_task(gateway._execute_client_command(901, self.writer, None, msg))
            try:
                self.assertTrue(await asyncio.to_thread(reached.wait, 3), 'final poll reached')
                action()  # the event loop's client owner, while the actual write thread waits
            finally:
                release.set()
            await t

        with patch.object(gateway, '_write_admission_refusal', admission), patch.object(stat, 'poll', poll):
            asyncio.run(run())
        r = self.replies[-1]
        after = (self.table.read_bytes(), self.store._path.read_bytes())
        print(json.dumps({'case': self._testMethodName, 'reply': r, 'admissions': len(admissions),
                          'loads': self.io.loads, 'table_changed': before[0] != after[0],
                          'metadata_changed': before[1] != after[1]}), flush=True)
        return r, before, after

    def test_control_final_poll_with_unchanged_writer_commits(self):
        r, before, after = self.edit_at_final_poll(lambda: None)
        self.assertTrue(r['ok'], r)
        self.assertNotEqual(before, after)
        self.assertEqual(self.io.loads, 1)

    def test_disarm_during_final_admission_poll_writes_nothing(self):
        r, before, after = self.edit_at_final_poll(lambda: setattr(self.writer, 'armed', False))
        self.assertEqual(after, before, 'the final admission may not retain an arm read before its own poll')
        self.assertFalse(r['ok'], r)
        self.assertEqual(self.io.loads, 0)

    def test_disconnect_during_final_admission_poll_writes_nothing(self):
        r, before, after = self.edit_at_final_poll(lambda: gateway._clients.pop(901, None))
        self.assertEqual(after, before, 'the final admission may not retain a connection read before its own poll')
        self.assertFalse(r['ok'], r)
        self.assertEqual(self.io.loads, 0)

    def import_case(self, replace_link):
        raw = json.dumps({'data': [{'type': 'flat end mill', 'post-process': {'number': 1},
                    'geometry': {'DC': 6, 'OAL': 60, 'LB': 45}, 'description': 'imported'}]}).encode()
        new = FakeConnection()
        new.stat.ini_filename = INI # same configuration: a reconnect, not merely a key mismatch
        new.stat.interp_state = gateway.linuxcnc.INTERP_IDLE
        other_table = self.dir / 'other-tool.tbl'
        other_table.write_text('T99 P99 Z99 D9 ; other loaded table\n')
        other_io = _Io(new.stat, other_table)
        other_io.show()
        new.cmd = other_io
        real_write = gateway.write_tool_table
        def write(*args):
            data = real_write(*args)
            if replace_link:
                swap_connection(new)
            return data
        async def run():
            gateway._cmd_lock = None
            return await gateway.apply_tool_library_import(
                UploadFile(file=io.BytesIO(raw), filename='tools.json'), x_conn_key=self.writer.conn_key)
        with patch.object(gateway, 'write_tool_table', write), \
             patch.object(gateway, 'get_ini_config', lambda: {'linear_units':'mm'}), \
             patch.object(gateway, 'TOOL_RELOAD_WAIT_S', .03), \
             patch.object(gateway, 'TOOL_RELOAD_POLL_S', .002):
            r = asyncio.run(run())
        job = gateway._tool_write_job
        print(json.dumps({'case': self._testMethodName, 'reply': r, 'old_loads': self.io.loads,
                          'new_loads': other_io.loads, 'job_outcome': job.outcome,
                          'job_is_new_link': job.link is gateway.current_link(),
                          'library': json.loads(self.store._path.read_text())}), flush=True)
        self.assertEqual([x['T'] for x in parse_tool_table(str(self.table))], [1])
        self.assertEqual(set(json.loads(self.store._path.read_text())), {INI})
        return r, other_io

    def test_control_import_unchanged_link_reloads_it(self):
        r, other = self.import_case(False)
        self.assertTrue(r['ok'], r)
        self.assertEqual((self.io.loads, other.loads), (1, 0))

    def test_import_after_replace_must_not_reload_a_new_link(self):
        _r, other = self.import_case(True)
        self.assertEqual(other.loads, 0, 'an import may not rebind its NML write after its file commit')


    def test_metadata_committed_after_link_lost_before_reload_write(self):
        msg = {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 49.0,
               'flutes': 5, 'expected': self.expect(1)}
        real = gateway._cmd_blocking
        async def write(conn, command, *args, **kw):
            if command.name == 'load_tool_table':
                # File is already replaced, the reload has selected the old
                # Link, but its actual write has not begun.
                swap_connection(None)
            return await real(conn, command, *args, **kw)
        with patch.object(gateway, '_cmd_blocking', write):
            r = self.send(msg)
        library = json.loads(self.store._path.read_text())
        z = next(t['Z'] for t in parse_tool_table(str(self.table)) if t['T'] == 1)
        print(json.dumps({'case': self._testMethodName, 'reply': r, 'z': z, 'library': library,
                          'loads': self.io.loads}), flush=True)
        self.assertEqual(z, 49)
        self.assertEqual(self.io.loads, 0)
        self.assertEqual(library[INI]['1'].get('flutes'), 5,
                         'a refused reload must not drop metadata of an already written edit')

    def test_metadata_committed_after_reload_command_error(self):
        msg = {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 49.0,
               'flutes': 5, 'expected': self.expect(1)}
        with patch.object(self.io, 'load_tool_table', side_effect=gateway.linuxcnc.error('reload write failed')):
            r = self.send(msg)
        library = json.loads(self.store._path.read_text())
        z = next(t['Z'] for t in parse_tool_table(str(self.table)) if t['T'] == 1)
        print(json.dumps({'case': self._testMethodName, 'reply': r, 'z': z, 'library': library}), flush=True)
        self.assertEqual(z, 49)
        self.assertEqual(library[INI]['1'].get('flutes'), 5,
                         'metadata prepared for the committed edit is still owed after the NML error')

if __name__ == '__main__':
    unittest.main(verbosity=2)
