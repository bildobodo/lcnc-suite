"""R343 review counterexamples, fake binding only; no live controller."""
import asyncio
import ast
import unittest
from pathlib import Path
from unittest.mock import patch
import test_feature_switches as fs
import gateway


class ReviewR343(fs._Store, unittest.TestCase):
    setUp = fs.TestEachSwitch.setUp
    _send = fs.TestEachSwitch._send
    mdis = fs.TestEachSwitch.mdis

    def test_calibration_reset_job_from_the_ui_runs(self):
        with patch.object(gateway, 'get_probe_macros', return_value=['probe_cal_reset']):
            result = self._send({'cmd': 'probe_run', 'routine': 'probe_cal_reset', 'vars': {}})
        print('CAL_RESET', result, 'MDI', self.mdis(), flush=True)
        self.assertTrue(result['ok'], result)
        self.assertIn('O<probe_cal_reset> CALL', self.mdis())

    def test_native_stage_still_sent_parameter_command_is_accepted(self):
        source = Path(__file__).resolve().parents[1] / 'scripts/native_run.py'
        tree = ast.parse(source.read_text())
        uses = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name) and n.func.id == '_when_free'
                and len(n.args) > 1 and isinstance(n.args[1], ast.Constant)
                and n.args[1].value == 'set_probe_vars']
        # Replay the command the versioned runner really sends. This uses
        # only its message shape, never starts the live runner.
        if not uses:
            return
        result = self._send({'cmd': 'set_probe_vars', 'vars': {'3102': -179}})
        print('NATIVE_PARAMETER_CALLS', uses, 'REPLY', result, flush=True)
        self.assertTrue(result['ok'], 'native_stage sends a removed command; migrate its calls and fakes')


class CameraR343(fs._Store, unittest.TestCase):
    def setUp(self):
        self.make_store()

    def test_switch_off_ends_a_frame_silent_existing_stream(self):
        from camera_broker import CameraBroker

        async def run():
            releases, tasks = [], []
            samples = iter([b'first'])
            def register(t):
                tasks.append(t)
                return t
            # Real broker: camera opens and supplies one image, then read()
            # yields no more images (disconnected camera case).
            broker = CameraBroker(lambda: next(samples, None), lambda: True,
                                  lambda: releases.append(True), register)
            broker._GRACE_S = .01
            with patch.object(gateway, '_camera_broker', broker):
                response = await gateway.camera_stream()
                it = response.body_iterator
                first = await asyncio.wait_for(anext(it), 1)
                waiter = asyncio.create_task(anext(it))
                await asyncio.sleep(.02)
                self.put('features', fs.off('camera'))
                try:
                    done, _ = await asyncio.wait({waiter}, timeout=.3)
                    ended = bool(done) and isinstance(waiter.exception(), StopAsyncIteration)
                    print('CAMERA_NO_FRAME', {'first': b'first' in first,
                          'stream_ended': ended, 'subscribers': broker._subscribers,
                          'producer_running': broker._task is not None and not broker._task.done(),
                          'released': bool(releases)}, flush=True)
                    self.assertTrue(ended, 'camera off waits forever if no next frame arrives')
                finally:
                    waiter.cancel()
                    await asyncio.gather(waiter, return_exceptions=True)
                    await it.aclose()
                    await broker.aclose()
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
