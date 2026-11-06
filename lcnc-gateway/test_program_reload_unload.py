"""F-LOAD.S3 (Codex R321–R322): a reload takes the new revision, an unload
empties the program and the preview — along their actual paths.

- Reload: the WebUI's Reload sends load_file with the same path (browser,
  e2e); the poller's file edge (preview_file_changed, its use in
  _status_poller checked in the source) sees the in-place edit by the mtime;
  the parse publishes the new text's source (the pipeline with a stand-in
  worker).
- Unload: unload_file through the WebSocket path (_execute_client_command,
  where the shared preview is cleared after the handler's reply), then no
  program loaded, no preview available, /preview 404."""
import ast
import asyncio
import hashlib
import inspect
import os
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
import gateway_util  # noqa: E402
from bulk_pipeline import BulkPipeline  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from test_button_gates import _payload  # noqa: E402
from test_button_gates_b import _Admission  # noqa: E402


def _pipeline(ini):
    return BulkPipeline(get_stat=lambda: types.SimpleNamespace(ini_filename=ini),
                        get_machine_units=lambda: "mm", build_wcs_rotation_patches=lambda: {})


def _publish(b, path):
    def worker(ctx_bytes, timeout):
        return (0, b"x" * 8, b"__SCHEMA__\t8\n")
    b._run_gcode_worker_blocking = worker
    asyncio.run(b.refresh_gcode_preview(path))


class TestTheFileEdge(unittest.TestCase):

    def test_an_in_place_edit_of_the_same_path_is_an_edge(self):
        f = gateway_util.preview_file_changed
        self.assertTrue(f("/p.ngc", 2.0, "/p.ngc", 1.0), "the same path, a new mtime: re-parse")
        self.assertFalse(f("/p.ngc", 1.0, "/p.ngc", 1.0), "the same path, the same mtime: no edge")
        self.assertTrue(f("/q.ngc", 1.0, "/p.ngc", 1.0), "another file")
        self.assertFalse(f(None, None, "/p.ngc", 1.0), "nothing loaded")

    def test_the_poller_decides_its_edge_with_it(self):
        tree = ast.parse(inspect.getsource(gateway._status_poller))
        assigned = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                    and isinstance(n.value, ast.Call) and getattr(n.value.func, "id", None) == "preview_file_changed"]
        self.assertEqual(len(assigned), 1, "_status_poller computes its file edge through preview_file_changed")
        name = assigned[0].targets[0].id
        edge = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                and getattr(n.func, "id", None) == "preview_file_edge_action"]
        self.assertTrue(edge and isinstance(edge[0].args[0], ast.Name) and edge[0].args[0].id == name,
                        "its result is the edge action's first input")


class TestAReloadPublishesTheNewRevision(unittest.TestCase):

    def test_an_edited_file_reloaded_publishes_its_new_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            ini = os.path.join(tmp, "m.ini")
            Path(ini).write_text("[EMC]\n")
            ngc = os.path.join(tmp, "p.ngc")
            Path(ngc).write_text("G0 X1\nM2\n")
            b = _pipeline(ini)
            _publish(b, ngc)
            first = (b.published_source, b.preview_version)
            self.assertEqual(first[0], hashlib.sha256(b"G0 X1\nM2\n").hexdigest())
            Path(ngc).write_text("G0 X2\nM2\n")                  # the editor's Save, in place
            later = time.time() + 5
            os.utime(ngc, (later, later))
            self.assertTrue(gateway_util.preview_file_changed(ngc, os.path.getmtime(ngc), b.last_file, b.last_mtime))
            _publish(b, ngc)
            self.assertEqual(b.published_source, hashlib.sha256(b"G0 X2\nM2\n").hexdigest())
            self.assertGreater(b.preview_version, first[1])


class TestAnUnloadEmptiesProgramAndPreview(_Admission):

    def test_unload_through_the_websocket_path(self):
        with tempfile.TemporaryDirectory() as nc:
            ini = os.path.join(nc, "m.ini")
            Path(ini).write_text("[EMC]\n")
            prog = Path(nc) / "part.ngc"
            prog.write_text("G0 X1\nM2\n")
            b = _pipeline(ini)
            _publish(b, str(prog))
            self.assertTrue(b.preview_available())
            gateway.STAT.task_mode = linuxcnc.MODE_AUTO
            gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
            program = gateway._status_runtime.program = gateway._status_runtime_mod.LoadedProgram()
            program.update(None, True, time.monotonic())
            replies = []

            async def reply(ws, m):
                replies.append(m)

            def send(msg):
                gateway._shared_status = _payload()
                gateway._cmd_lock = None
                asyncio.run(gateway._execute_client_command(901, self.writer, None, dict(msg)))
                return replies[-1]
            with patch.object(gateway, "_bulk", b), patch.object(gateway, "ws_send_json", reply), \
                    patch.object(gateway, "get_nc_files_dir", return_value=nc):
                self.assertTrue(send({"cmd": "load_file", "path": str(prog)})["ok"], replies)
                program.update(str(prog), True, time.monotonic())
                self.assertEqual(program.loaded, str(prog))
                version = b.preview_version
                self.assertTrue(send({"cmd": "unload_file"})["ok"], replies)
                program.update(str(prog), True, time.monotonic())
                self.assertIsNone(program.loaded, "no program loaded")
                self.assertFalse(b.preview_available(), "no preview")
                self.assertGreater(b.preview_version, version, "every client gets the empty preview")
                with self.assertRaises(HTTPException) as e:
                    gateway.get_preview(types.SimpleNamespace(headers={}, client=None))
                self.assertEqual(e.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
