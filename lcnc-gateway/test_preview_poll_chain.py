"""The status poller's preview chain as gateway.py writes it — the file edge,
the doomed in-flight parse, the pinned parse its run outlived — executed over
a synthetic status against the real BulkPipeline.cancel_inflight (Codex R177
answer 2, after his probe viewer-palette-fest.r177.codex-poller.py).

The chain is lifted out of gateway.py's source (the `if _fe is not None:`
statement, cut after the `pinned_parse_outlived` branch) and run with a fake
worker handle: gateway.py is never imported (it binds the live LinuxCNC), no
process starts, no command is sent. The re-planning after it is the idle
edges' and is not run here."""
import ast
import copy
import os
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

import gateway_util
from bulk_pipeline import BulkPipeline

HERE = Path(__file__).resolve().parent


def _chain():
    tree = ast.parse((HERE / "gateway.py").read_text())
    root = next(n for n in ast.walk(tree)
                if isinstance(n, ast.If) and ast.unparse(n.test) == "_fe is not None")
    node = copy.deepcopy(root)
    c = node
    while c.orelse and isinstance(c.orelse[0], ast.If):
        if "pinned_parse_outlived(" in ast.unparse(c.test):
            c.orelse = []
            break
        c = c.orelse[0]
    assert "pinned_parse_outlived(" in ast.unparse(c.test), "the chain lost its pinned-parse branch"
    return compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])),
                   "gateway.py:preview-poll-chain", "exec")


class _Worker:
    def __init__(self):
        self.terminations = 0

    def terminate(self):
        self.terminations += 1

    def poll(self):
        return 0


class _Trace:
    def emit(self, *a, **k):
        pass


class TestPreviewPollChain(unittest.TestCase):
    CODE = None

    @classmethod
    def setUpClass(cls):
        cls.CODE = _chain()

    def run_chain(self, *, pinned, idle, running, edge, twice=False):
        b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: "mm",
                         build_wcs_rotation_patches=lambda: {})
        b.refresh_running = running
        b.inflight = {"pinned": pinned, "t0": time.monotonic(), "file": "/test.ngc"}
        b.gcode_parse_proc = _Worker()
        ns = {"_fe": edge, "_bulk": b,
              "st": NS(active_file="/test.ngc", rotary_abc=[0, 0, 0], interp_state=1 if idle else 3),
              "linuxcnc": NS(INTERP_IDLE=1), "inflight_doomed_reason": gateway_util.inflight_doomed_reason,
              "pinned_parse_outlived": gateway_util.pinned_parse_outlived, "_trace": _Trace()}
        with patch("threading.Timer"):
            exec(self.CODE, ns)
            if twice:
                exec(self.CODE, ns)
        return b

    def test_a_pinned_parse_ends_with_its_run(self):
        for twice in (False, True):
            b = self.run_chain(pinned=True, idle=True, running=True, edge=None, twice=twice)
            self.assertEqual((b.cancel_reason, b.gcode_parse_proc.terminations), ("run_ended", 1), twice)
            self.assertFalse(b.reparse_pending)

    def test_a_paused_run_a_plain_parse_and_no_parse_running_are_left_alone(self):
        for kw in (dict(pinned=True, idle=False, running=True), dict(pinned=False, idle=True, running=True),
                   dict(pinned=True, idle=True, running=False)):
            b = self.run_chain(edge=None, **kw)
            self.assertEqual((b.cancel_reason, b.gcode_parse_proc.terminations), (None, 0), kw)

    def test_the_file_edge_comes_first(self):
        b = self.run_chain(pinned=True, idle=True, running=True, edge="cancel:file")
        self.assertEqual((b.cancel_reason, b.gcode_parse_proc.terminations), ("file", 1))


if __name__ == "__main__":
    unittest.main()
