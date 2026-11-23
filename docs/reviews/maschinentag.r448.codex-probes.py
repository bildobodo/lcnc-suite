"""R448 follow-up probes: real lifecycle with only the worker/file I/O mocked.
No live controller or server is contacted (gateway conftest + fake LinuxCNC).
"""
import asyncio
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

from test_calc_lifetime_gateway import _Base, _run, gateway, linuxcnc

OUT = Path('/tmp/r448')

class TestR448(_Base):
    def test_actual_refresh_marks_the_program_before_its_first_file_read(self):
        import bulk_pipeline
        from test_bulk_pipeline import _pipeline
        seen = {}
        with tempfile.TemporaryDirectory() as folder:
            ini, prog = Path(folder)/'m.ini', Path(folder)/'p.ngc'
            ini.write_text('[EMC]\n'); prog.write_text('M2\n')
            b = _pipeline(str(ini))
            b.generation = self.gen
            b._run_gcode_worker_blocking = lambda *a: (0, b'\x81\xa4file\xc0', b'__SCHEMA__\t7\n')
            entered, release = threading.Event(), threading.Event()
            real_source = bulk_pipeline.program_source
            def source(path):
                if not entered.is_set():
                    entered.set()
                    if not release.wait(5): raise RuntimeError('probe did not release source read')
                return real_source(path)
            st = SimpleNamespace(interp_state=linuxcnc.INTERP_READING, current_vel=1.0)
            async def scenario():
                tasks=[]
                def spawn(coro):
                    task=asyncio.create_task(coro); tasks.append(task); return task
                self.assertTrue(b.schedule_refresh(str(prog), 'file', spawn))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 3))
                    self.assertEqual(b.spawned_program_gen, 0, 'set by refresh itself before program_source')
                    self.gen.began('mode')
                    seen['before_source'] = dict(spawned=b.spawned_program_gen, gen=self.gen.snapshot(), wait=gateway._restart_wait(st, True))
                    self.assertEqual(seen['before_source']['wait'], 'not_idle')
                finally:
                    release.set()
                    await tasks[0]
                self.assertFalse(b.preview_available(), 'the outdated first parse cannot publish')
                self.assertEqual(b.job_ends[1], {'why':'discarded'})
                # A caller may replace the diagnostic reason; identity persists.
                b.reparse_pending_reason='operator-reparse'
                self.assertEqual(gateway._restart_wait(st, True), 'not_idle')
                st.interp_state=linuxcnc.INTERP_IDLE; st.current_vel=0
                with gateway._file_effect('macro_file'):
                    self.assertIsNotNone(gateway._restart_wait(st, True))
                self.assertEqual(gateway._restart_wait(st, True), 'debounce')
                self.clock.t += 2.1
                self.assertIsNone(gateway._restart_wait(st, True))
                gateway._program_began('load')
                self.assertNotEqual(b.spawned_program_gen, self.gen.snapshot()[0])
                self.assertIsNone(gateway._restart_wait(st, True), 'a genuinely new load is admitted')
                self.assertTrue(b.schedule_refresh(str(prog), 'file', spawn))
                await tasks[-1]
                self.assertEqual(b.spawned_program_gen, self.gen.snapshot()[0])
                self.assertTrue(b.preview_available())
                st.interp_state=linuxcnc.INTERP_READING; st.current_vel=1
                self.clock.t += 2.1
                self.assertEqual(gateway._restart_wait(st, True), 'not_idle', 'the second generation now has its own restart')
                seen['after_reload']=dict(spawned=b.spawned_program_gen, gen=self.gen.snapshot(), published=b.preview_available(), wait=gateway._restart_wait(st, True))
            with patch.object(gateway,'_bulk',b), patch.object(bulk_pipeline,'program_source',side_effect=source):
                _run(scenario())
        (OUT/'actual-lifecycle.json').write_text(json.dumps(seen,indent=2))

    def test_overdue_is_named_once_and_controller_abort_leaves_file_until_its_error(self):
        events=[]
        with patch.object(gateway._trace,'emit',side_effect=lambda tag,**kw: events.append({'tag':tag,**kw})):
            with self.assertRaises(OSError):
                with gateway._file_effect('macro_file'):
                    controller = self.ledger.begin(None,'mdi','mdi')
                    self.assertEqual(self.ledger.end_all('aborted'),1)
                    self.assertEqual(controller.outcome,'aborted')
                    self.assertEqual(self.ledger.busy(),'observed:macro_file')
                    self.poll(dt=301)
                    self.poll(dt=301)
                    self.assertFalse(gateway._actions_quiet())
                    self.assertEqual(len([r for r in events if r['tag']=='action.file_overdue']),1)
                    raise OSError('file write failed at its actual end')
            self.assertIsNone(self.ledger.busy())
            self.assertEqual(self.ledger.last_end,self.clock.t)
            self.poll(dt=0)
            file_ends=[r for r in events if r['tag']=='action.ended' and r.get('what')=='macro_file']
            self.assertEqual([r['outcome'] for r in file_ends],['unknown'])
        (OUT/'overdue-and-controller.json').write_text(json.dumps(events,indent=2))
