"""R447 independent counterexamples; fake LinuxCNC, isolated files only."""
import ast
import asyncio
import copy
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

from test_calc_lifetime_gateway import _Base, _run, gateway, linuxcnc

OUT = Path('/tmp/r448')

class TestR447(_Base):
    def writer(self, kind):
        entered, release = threading.Event(), threading.Event()
        real_replace, real_unlink = os.replace, os.unlink
        captured = {}
        with tempfile.TemporaryDirectory() as folder:
            old, dest = Path(folder)/'old.ngc', Path(folder)/'new.ngc'
            old.write_text('old macro\n')
            if kind != 'rollback':
                dest.write_text('old macro\n')
            def blocked_replace(src, dst):
                if str(dst) == str(dest):
                    entered.set()
                    if not release.wait(10):
                        raise RuntimeError('test failed to release writer')
                return real_replace(src, dst)
            def unlink(path, *args, **kw):
                if str(path) == str(old):
                    raise OSError(5, 'simulated old-name unlink failure')
                if str(path) == str(dest) and kind == 'rollback':
                    entered.set()
                    if not release.wait(10):
                        raise RuntimeError('test failed to release rollback')
                return real_unlink(path, *args, **kw)
            async def chunks():
                yield b'new macro\n'
            async def scenario():
                task = asyncio.create_task(gateway._atomic_stream_write(
                    chunks(), str(dest), 1024, replace=kind != 'rollback', gate=lambda: None,
                    after_publish=(lambda: gateway._unlink_renamed(str(old))) if kind == 'rollback' else None))
                try:
                    assert await asyncio.to_thread(entered.wait, 5), 'writer did not enter seam'
                    if kind == 'timeout':
                        self.poll(dt=301)
                    elif kind == 'abort':
                        captured['abort_reply'] = await gateway.handle_command({'cmd':'abort'}, False)
                    self.poll(dt=2.1)
                    captured.update(gen=self.gen.snapshot(), busy=self.ledger.busy(), quiet=gateway._actions_quiet(),
                        restart_wait=gateway._restart_wait(SimpleNamespace(interp_state=linuxcnc.INTERP_IDLE, current_vel=0), False),
                        before=dest.read_text(), end_before=self.ledger.last_end, now=self.clock.t,
                        decision=gateway._drift_decision_status())
                    self.clock.t += 1
                finally:
                    release.set()
                    try:
                        await task
                    except gateway.HTTPException as e:
                        captured['error'] = e.detail
                pubs=[]
                captured['accepted'] = gateway._bulk._publish_in_generation(
                    tuple(captured['gen']), lambda: pubs.append(captured['before']), 70, '/main.ngc', 'publish')
                captured.update(gen_after=self.gen.snapshot(), after=dest.read_text() if dest.exists() else None,
                    end_after=self.ledger.last_end, actual_end=self.clock.t, publications=pubs)
            with patch.object(gateway, '_macro_folder_path', return_value=folder), \
                 patch.object(gateway.os, 'replace', side_effect=blocked_replace), \
                 patch.object(gateway.os, 'unlink', side_effect=unlink), \
                 patch.object(gateway._bulk, 'unloading', False), \
                 patch.object(gateway._bulk, 'reparse_pending_reason', 'discarded:macro_file'):
                _run(scenario())
        (OUT/f'{kind}.json').write_text(json.dumps(captured, indent=2))
        self.assertFalse(captured['quiet'], captured)
        self.assertIsNotNone(captured['restart_wait'])

    def test_running_http_writer_survives_its_observer_timeout(self):
        self.writer('timeout')

    def test_controller_abort_does_not_end_a_running_http_writer(self):
        self.writer('abort')

    def test_macro_rename_is_owned_through_rollback(self):
        self.writer('rollback')

    def test_rotary_cancel_does_not_hide_an_input_generation_change(self):
        from bulk_pipeline import BulkPipeline
        from gateway_util import preview_file_changed, preview_file_edge_action, inflight_doomed_reason, rotary_hold_update, rotary_hold_settled
        from calc_lifetime import inflight_outdated
        # Unchanged actual poll statements from the file-edge decision through
        # the generation branch; stop before unrelated pinned/drift checks.
        tree=ast.parse(Path(gateway.__file__).read_text())
        code=None
        for node in ast.walk(tree):
            body=getattr(node,'body',None)
            if not isinstance(body,list): continue
            for i,s in enumerate(body):
                if not isinstance(s,ast.Assign) or not ast.unparse(s).startswith('_fe = preview_file_edge_action('): continue
                j=next(k for k in range(i,len(body)) if isinstance(body[k],ast.If) and ast.unparse(body[k].test)=='_fe is not None and st.active_file')
                root=copy.deepcopy(body[j]); c=root
                while c.orelse and isinstance(c.orelse[0],ast.If):
                    if 'inflight_outdated(' in ast.unparse(c.test):
                        c.orelse=[]; break
                    c=c.orelse[0]
                code=compile(ast.fix_missing_locations(ast.Module(body=copy.deepcopy(body[i:j])+[root],type_ignores=[])), 'gateway.py:poll-chain', 'exec')
        assert code is not None
        b=BulkPipeline(get_stat=lambda:None,get_machine_units=lambda:'mm',build_wcs_rotation_patches=lambda:{})
        b.refresh_running=True
        b.spawned_program_gen=self.gen.snapshot()[0] # R448: the running parse's new identity field
        b.inflight={'file':'/p.ngc','mtime':1.0,'rotary_seed':{'A':0,'B':0,'C':0},'gen':self.gen.snapshot()}
        self.gen.began('mode')
        st=SimpleNamespace(active_file='/p.ngc', interp_state=linuxcnc.INTERP_READING, current_vel=1.0,rotary_abc=[10,0,0])
        b.rotary_hold=rotary_hold_update(None, st.rotary_abc, 100)
        calls=[]
        def cancel(why):
            calls.append(('cancel',why)); b.refresh_running=False; b.inflight=None
            return True
        b.cancel_inflight=cancel
        b.schedule_refresh=lambda *a,**kw: calls.append(('schedule',a[1],kw.get('pinned',False))) or True
        ns={'_bulk':b,'st':st,'_now':100,'_cur_mtime':1.0,
            'file_changed':preview_file_changed(st.active_file,1.0,b.last_file,b.last_mtime),
            'preview_file_edge_action':preview_file_edge_action,'rotary_hold_settled':rotary_hold_settled,
            '_restart_wait':gateway._restart_wait,'inflight_doomed_reason':inflight_doomed_reason,
            'inflight_outdated':inflight_outdated,'_calc_gen':self.gen,
            '_spawn_preview_task':lambda c:None,'_dd_decide':lambda *a:None,
            '_trace':SimpleNamespace(emit=lambda *a,**k:None)}
        with patch.object(gateway,'_bulk',b):
            exec(code,ns) # rotary and generation invalidation compete
            ns['_now']=101.1
            exec(code,ns) # after cancellation and settled rotary pose, still running
        (OUT/'rotary-restart.json').write_text(json.dumps({'calls':calls,'reason':b.reparse_pending_reason,'file_changed':ns['file_changed']},indent=2))
        self.assertTrue(calls and calls[0][0]=='cancel')
        self.assertFalse(any(c[0]=='schedule' for c in calls), calls)
