"""Offline test launcher with a 20-ms selector wake-up for this sandbox.

The sandbox's asyncio cross-thread wake-up did not wake select (see the
diagnostic). A periodic callback bounds select's wait without replacing
to_thread, any product function, or test assertions. No timing proof claimed.
Usage: backend-runner.py unit | probe OUTPUT_JSON
"""
import asyncio
import runpy
import sys
import unittest
from pathlib import Path

class PollingPolicy(asyncio.DefaultEventLoopPolicy):
    def new_event_loop(self):
        loop = super().new_event_loop()
        def tick():
            if not loop.is_closed():
                loop.call_later(0.02, tick)
        loop.call_later(0.02, tick)
        return loop

asyncio.set_event_loop_policy(PollingPolicy())
if sys.argv[1] == "unit":
    suite = unittest.defaultTestLoader.loadTestsFromName("test_bulk_pipeline.TestRunBinding")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
else:
    sys.argv = [str(Path(__file__).with_name("backend-probe.py")), sys.argv[2]]
    runpy.run_path(sys.argv[0], run_name="__main__")
