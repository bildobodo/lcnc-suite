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
    names = ["test_bulk_pipeline.TestRunBinding"]
    from test_command_dispatch import TestHandlerExecution
    # The ten adjacent run-basis tests, selected by their source block.
    import ast
    source = Path("test_command_dispatch.py").read_text()
    names += ["test_command_dispatch.TestHandlerExecution." + n.name
              for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef)
              and n.name.startswith("test_") and 666 <= n.lineno < 901]
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
else:
    sys.argv = [str(Path(__file__).with_name("backend-probe.py")), sys.argv[2]]
    runpy.run_path(sys.argv[0], run_name="__main__")
