"""R345: a multi-purpose form through the real command dispatcher.

Fake LinuxCNC, no live connection. Force multiple MDI chunks so an abort
or a changed feature has something left to prevent after the first write.
"""
import asyncio
import json
import threading
import unittest

import test_feature_switches as fs
import test_command_dispatch as td
import gateway


class ReviewCombinedParams(fs._Store, unittest.TestCase):
    setUp = fs.TestEachSwitch.setUp
    _send = fs.TestEachSwitch._send
    mdis = fs.TestEachSwitch.mdis

    def sets(self):
        return {purpose: {str(k): 1 for k in sorted(fs.features.PURPOSE_VARS[purpose])}
                for purpose in ("probe", "surface")}

    def test_cancel_in_first_chunk_leaves_no_followup_chunk_or_file_write(self):
        entered, release = threading.Event(), threading.Event()
        def blocked():
            entered.set()
            if not release.wait(2):
                raise AssertionError("probe barrier timeout")
        self.cmd = td.TestHandlerExecution._rcs(self, block=blocked)
        sets = self.sets()
        unique = fs.features.merged_sets(sets)
        self.assertGreater(len(" ".join(f"#{k}={v:.6f}" for k, v in unique.items())), 250)

        async def run():
            gateway._shared_status = td._payload()
            task = asyncio.create_task(gateway.handle_command(
                {"cmd": "set_params", "sets": sets}, True, self.key))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                task.cancel()  # the same cancellation the stop preemption delivers
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            finally:
                release.set()
                await asyncio.gather(task, return_exceptions=True)
        with unittest.mock.patch.object(gateway, "_write_var_file_updates") as write:
            asyncio.run(run())
            print("COMBINED_CANCEL", json.dumps({"purposes": list(sets),
                "union_keys": len(unique), "mdi_chunks": self.mdis(),
                "file_writes": write.call_count}), flush=True)
            self.assertEqual(len(self.mdis()), 1)
            write.assert_not_called()

    def test_every_chunk_checks_all_purposes_again(self):
        original = self.cmd.mdi
        def flip_after_write(text):
            out = original(text)
            self.put("features", fs.off("surfaceMap"))
            return out
        flip_after_write.__name__ = "mdi"
        self.cmd.mdi = flip_after_write
        r = self._send({"cmd": "set_params", "sets": self.sets()})
        print("COMBINED_CHANGED_FEATURE", json.dumps({"reply": r, "mdi_chunks": self.mdis()}), flush=True)
        self.assertFalse(r["mdi_set"], r)
        self.assertEqual(len(self.mdis()), 1)

    def test_invalid_later_set_never_leaves_a_partial_initial_write(self):
        for bad in ({"3054": float("inf")}, {"3054": "not a number"}, {"3102": 5}):
            self.cmd.calls.clear()
            r = self._send({"cmd": "set_params", "sets": {"probe": {"3014": 99}, "surface": bad}})
            print("COMBINED_INVALID", json.dumps({"sets": bad, "reply": r, "mdi": self.mdis()}), flush=True)
            self.assertFalse(r["ok"], r)
            self.assertEqual(self.mdis(), [])


if __name__ == "__main__":
    unittest.main()
