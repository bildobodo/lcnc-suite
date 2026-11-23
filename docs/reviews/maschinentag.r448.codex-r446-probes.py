"""R446 counterexamples, isolated gateway with fake LinuxCNC; never connects live.
Run with pytest from this directory so conftest removes host discovery.
"""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

from test_calc_lifetime_gateway import _Base, _run, gateway, linuxcnc

OUT = Path('/tmp/r448')

class TestR446(_Base):
    def test_http_macro_commit_is_owned_until_replace_returns(self):
        entered, release = threading.Event(), threading.Event()
        replace = os.replace
        captured = {}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'macro.ngc'
            path.write_text('old macro\n')
            def blocked_replace(src, dst):
                if str(dst) == str(path):
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('probe failed to release writer')
                return replace(src, dst)
            async def chunks():
                yield b'new macro\n'
            async def scenario():
                task = asyncio.create_task(gateway._atomic_stream_write(chunks(), str(path), 1024, gate=lambda: None))
                try:
                    assert await asyncio.to_thread(entered.wait, 5), 'writer never reached replace'
                    self.clock.t += 2.1
                    snapshot = self.gen.snapshot()
                    captured.update(gen=snapshot, busy=gateway._actions.busy(), quiet=gateway._actions_quiet(),
                                    restart_wait=gateway._restart_wait(SimpleNamespace(interp_state=linuxcnc.INTERP_IDLE, current_vel=0), False),
                                    decision=gateway._drift_decision_status(), read_under_new_gen=path.read_text())
                finally:
                    release.set()
                    await task
                published = []
                accepted = gateway._bulk._publish_in_generation(snapshot, lambda: published.append(captured['read_under_new_gen']), 77, '/p.ngc', 'publish')
                captured.update(file_after=path.read_text(), gen_after=self.gen.snapshot(), accepted=accepted, published=published)
            with patch.object(gateway, '_macro_folder_path', return_value=folder), \
                 patch.object(gateway.os, 'replace', side_effect=blocked_replace), \
                 patch.object(gateway._bulk, 'unloading', False), \
                 patch.object(gateway._bulk, 'reparse_pending_reason', 'discarded:macro_file'):
                _run(scenario())
        (OUT / 'file-probe.json').write_text(json.dumps(captured, indent=2))
        self.assertFalse(captured['quiet'], captured)
        self.assertIsNotNone(captured['restart_wait'])

    def test_idle_edge_without_input_write_reopens_same_generation(self):
        gateway._dd_idle_edge(False)
        gateway._dd_idle_edge(True)
        gateway._dd_decide('none')
        before = gateway._drift_decision_status()
        gateway._dd_idle_edge(False)
        gateway._dd_idle_edge(True)
        after = gateway._drift_decision_status()
        result = {'first': before, 'next': after}
        (OUT / 'decision-wire.json').write_text(json.dumps(result, indent=2))
        self.assertEqual(before['gen'], after['gen'])
        self.assertEqual((before['state'], after['state']), ('none', 'pending'))

    def test_same_unpublished_file_restart_still_waits_after_cycle_start(self):
        from test_preview_poll_chain import _chain, _Trace
        from gateway_util import preview_file_changed, preview_file_edge_action
        from bulk_pipeline import BulkPipeline
        b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: 'mm', build_wcs_rotation_patches=lambda: {})
        b.spawned_program_gen = self.gen.snapshot()[0] # R448: this parse already ran
        b.reparse_pending = True
        b.reparse_pending_reason = 'discarded:mode'  # the actual previous poll's cancellation
        b.last_file = None  # the first load parse never published
        b.last_mtime = None
        st = SimpleNamespace(active_file='/p.ngc', interp_state=linuxcnc.INTERP_READING, current_vel=1.0)
        scheduled = []
        b.schedule_refresh = lambda *a, **kw: scheduled.append({'args': list(a[:2]), 'pinned': kw.get('pinned', False)}) or True
        results = []
        for held in (False, True):
            if held:
                self.ledger.hold('probe_run')
            scheduled.clear()
            changed = preview_file_changed(st.active_file, 1.0, b.last_file, b.last_mtime)
            edge = preview_file_edge_action(changed, b.reparse_pending, b.refresh_running, b.inflight, st.active_file, 1.0)
            with patch.object(gateway, '_bulk', b):
                wait = gateway._restart_wait(st, changed)
                if wait is not None:
                    edge = None
                ns = {'_fe': edge, '_bulk': b, 'st': st, 'file_changed': changed,
                      '_spawn_preview_task': lambda c: None, '_dd_decide': lambda *a: None, '_trace': _Trace()}
                exec(_chain(), ns)
                control = gateway._restart_wait(st, False)
            results.append(dict(file_changed=changed, actions_busy=self.ledger.busy(), wait=wait,
                                scheduled=list(scheduled), published_file_control=control))
        (OUT/'cycle-start-probe.json').write_text(json.dumps(results, indent=2))
        self.assertTrue(all(not r['scheduled'] for r in results), results)

    def test_current_decision_keeps_its_terminal_state_past_other_jobs(self):
        from collections import OrderedDict
        with patch.object(gateway._bulk, 'job_ends', OrderedDict()):
            gateway._dd_pending('idle')
            gateway._dd_decide('parse', 7)
            gateway._bulk._note_job_end(7, {'version': 107})
            before = gateway._drift_decision_status()
            # Same inputs, rotary jog/manual Reparse: no input action or interp idle edge.
            for job in range(8, 24):
                gateway._bulk._note_job_end(job, {'version': 100+job})
            after = gateway._drift_decision_status()
        result = dict(before=before, after=after)
        (OUT/'forgotten-end.json').write_text(json.dumps(result, indent=2))
        self.assertEqual(after.get('published'), 107, result)
