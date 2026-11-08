"""R344 counterprobes: fake LinuxCNC, real camera route/broker/settings save.

No camera device or gateway connection is used. Run from the archived
lcnc-gateway directory with unittest. The old stream is paused at its yield,
as when HTTP backpressure delays the consumer; no product sleep is patched.
"""
import asyncio
import json
import threading
import unittest
from unittest.mock import patch

import test_feature_switches as fs
import gateway


class ReviewCamera(fs._Store, unittest.TestCase):
    def setUp(self):
        fs.TestTheChangeIsAdmitted.setUp(self)
        self.releases, self.tasks = [], []

    broker = fs.TestTheCamera.broker

    async def save_features(self, data):
        rev = self.store.view_for(None)["revs"].get("features", 0)
        return await gateway._save_settings(
            "features", data, gateway._settings_admission("features", self.key),
            base_rev=rev, writer=self.key)

    def test_old_stream_cleanup_does_not_unsubscribe_the_new_epoch(self):
        async def run():
            b = self.broker(iter(lambda: b"jpeg", None))
            old = (await gateway.camera_stream()).body_iterator
            new = None
            try:
                await asyncio.wait_for(anext(old), 1)
                await self.save_features(fs.off("camera"))
                await self.save_features(fs.ALL_ON)
                new = (await gateway.camera_stream()).body_iterator
                await asyncio.wait_for(anext(new), 1)
                before = b._subscribers
                # An old stream's pending HTTP send finally returns/closes,
                # after the camera has been re-enabled by another client.
                await old.aclose()
                after = b._subscribers
                if b._stop_handle is not None:
                    b._stop_handle.cancel()
                    b._stop_handle = None
                await b._grace_stop()   # run the scheduled 2 s grace now
                print("OLD_STREAM_CLEANUP", json.dumps({
                    "before_old_close": before, "after_old_close": after,
                    "new_producer_alive": b._task is not None,
                    "releases": len(self.releases)}), flush=True)
                self.assertEqual(after, 1, "old epoch removed the new stream's subscription")
                self.assertIsNotNone(b._task, "new stream lost its producer")
            finally:
                await old.aclose()
                if new is not None:
                    await new.aclose()
                await b.aclose()
        asyncio.run(run())

    def test_cancel_after_committed_off_still_ends_the_epoch(self):
        async def run():
            b = self.broker(iter([b"jpeg"]))
            old = (await gateway.camera_stream()).body_iterator
            entered, release = threading.Event(), threading.Event()
            original = self.store.save_section
            task = None

            def committed(*a, **kw):
                result = original(*a, **kw)
                entered.set()
                if not release.wait(2):
                    raise AssertionError("test's commit barrier timed out")
                return result

            try:
                await asyncio.wait_for(anext(old), 1)
                with patch.object(self.store, "save_section", committed):
                    task = asyncio.create_task(self.save_features(fs.off("camera")))
                    self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                    task.cancel()
                    release.set()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                print("CANCELLED_COMMITTED_OFF", json.dumps({
                    "camera_enabled": self.store.features()["camera"],
                    "epoch": b.epoch, "subscribers": b._subscribers,
                    "producer_alive": b._task is not None,
                    "released": bool(self.releases)}), flush=True)
                self.assertFalse(self.store.features()["camera"])
                self.assertGreater(b.epoch, 0, "committed OFF did not terminate the epoch")
                self.assertIsNone(b._task)
            finally:
                release.set()
                if task is not None:
                    await asyncio.gather(task, return_exceptions=True)
                await old.aclose()
                await b.aclose()
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
