"""R221: the generic CMD drain's wait signal and late error; fake LinuxCNC only."""
import asyncio
import gc
import threading
from unittest import mock

from test_button_gates_d import _Writer
from test_button_gates import _run
import gateway

assert gateway.linuxcnc.__lcnc_fake__


class CancelDrain(_Writer):
    def setUp(self):
        super().setUp()
        gateway._cmd_lock = None

    async def cancel_three(self, task, lock):
        for _ in range(3):
            task.cancel()
            for _ in range(3):
                await asyncio.sleep(0)
            self.assertTrue(lock.locked(), 'lock must remain held through every cancel')
            self.assertFalse(task.done(), 'cancel must wait for the thread')

    def test_cancel_signal_ends_wait_slice_and_next_owner_waits(self):
        async def go():
            loop = asyncio.get_running_loop()
            entered = asyncio.Event()
            release = threading.Event()
            lock = gateway._get_cmd_lock()
            events, waits = [], []
            task = successor = None

            def write():
                events.append('write')

            def booked():
                events.append('book')

            def wait_complete(seconds):
                waits.append(seconds)
                if len(waits) > 1:
                    raise AssertionError('cancel signal did not end the first wait slice')
                loop.call_soon_threadsafe(entered.set)
                if not release.wait(5):
                    raise AssertionError('probe did not release its mock wait')
                events.append('wait-return')
                return -1

            async def owner():
                async with lock:
                    return await gateway._cmd_blocking(write, wait=30, written=booked)

            async def next_owner():
                async with lock:
                    events.append('next-owner')

            try:
                with mock.patch.object(gateway.CMD, 'wait_complete', wait_complete):
                    task = asyncio.create_task(owner())
                    await asyncio.wait_for(entered.wait(), 2)
                    successor = asyncio.create_task(next_owner())
                    await self.cancel_three(task, lock)
                    self.assertNotIn('next-owner', events)
                    release.set()
                    result = (await asyncio.gather(task, return_exceptions=True))[0]
                    await asyncio.wait_for(successor, 2)
                return result, events, waits
            finally:
                release.set()
                pending = [t for t in (task, successor) if t is not None]
                await asyncio.gather(*pending, return_exceptions=True)

        result, events, waits = _run(go())
        print('wait slice:', type(result).__name__, events, waits)
        self.assertIsInstance(result, asyncio.CancelledError)
        self.assertEqual(events, ['write', 'book', 'wait-return', 'next-owner'])
        self.assertEqual(waits, [gateway._CMD_WAIT_SLICE])

    def test_error_after_repeated_cancel_is_retrieved_and_not_booked(self):
        async def go():
            loop = asyncio.get_running_loop()
            entered = asyncio.Event()
            release = threading.Event()
            lock = gateway._get_cmd_lock()
            events, errors = [], []
            old_handler = loop.get_exception_handler()
            loop.set_exception_handler(lambda _loop, ctx: errors.append(ctx.get('message')))
            task = None

            def failing_write():
                loop.call_soon_threadsafe(entered.set)
                if not release.wait(5):
                    raise AssertionError('probe did not release its mock write')
                events.append('write-error')
                raise RuntimeError('mock write failed before sending')

            async def owner():
                async with lock:
                    return await gateway._cmd_blocking(
                        failing_write, wait=None, written=lambda: events.append('book'))

            try:
                task = asyncio.create_task(owner())
                await asyncio.wait_for(entered.wait(), 2)
                await self.cancel_three(task, lock)
                release.set()
                result = (await asyncio.gather(task, return_exceptions=True))[0]
                self.assertFalse(lock.locked())
                task = None
                for _ in range(3):
                    await asyncio.sleep(0)
                gc.collect()
                await asyncio.sleep(0)
                return result, events, errors
            finally:
                release.set()
                if task is not None:
                    await asyncio.gather(task, return_exceptions=True)
                loop.set_exception_handler(old_handler)

        result, events, errors = _run(go())
        print('late write error:', type(result).__name__, events, errors)
        self.assertIsInstance(result, asyncio.CancelledError)
        self.assertEqual(events, ['write-error'])
        self.assertEqual(errors, [], 'no never-retrieved inner error')
