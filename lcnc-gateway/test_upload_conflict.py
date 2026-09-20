"""Upload no-replace contract (WP0, UI-09).

``POST /upload`` never replaces an existing program unless ``overwrite=1``:
the publish is an ``os.link`` of the fsynced temp, which refuses an existing
name atomically (exactly one of two concurrent same-name uploads wins), and a
filesystem that cannot link makes the upload REFUSE — never a copy fallback
that would expose a partial file under the final name.

Runs off-machine like test_command_dispatch (fake linuxcnc installed first):

    .venv/bin/python3 -m pytest test_upload_conflict.py
"""
import asyncio
import errno
import os
import shutil
import tempfile
import unittest
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _run(coro):
    gateway._cmd_lock = None
    return asyncio.run(coro)


class _FakeUpload:
    """Minimal stand-in for Starlette UploadFile: async chunked read."""
    def __init__(self, data: bytes, filename: str = "prog.ngc"):
        import io
        self._buf = io.BytesIO(data)
        self.filename = filename

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)


class _GatedUpload(_FakeUpload):
    """Yields one chunk, then waits for the test to release it — a window in
    which the destination must not exist yet."""
    def __init__(self, data: bytes):
        super().__init__(data)
        self.first_read_done = asyncio.Event()
        self.release = asyncio.Event()
        self._reads = 0

    async def read(self, n: int = -1) -> bytes:
        self._reads += 1
        if self._reads == 2:
            self.first_read_done.set()
            await self.release.wait()
        return self._buf.read(n)


class TestUploadNoReplace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _parts(self):
        return [n for n in os.listdir(self.tmp) if n.endswith(".part")]

    def _dest(self, name="prog.ngc"):
        return os.path.join(self.tmp, name)

    def _upload(self, data, replace, dest=None):
        return _run(gateway._atomic_stream_upload(
            _FakeUpload(data), dest or self._dest(), 10 << 20, chunk_size=1024, replace=replace))

    def test_first_upload_publishes_without_flag(self):
        n = self._upload(b"G1 X1\n" * 100, replace=False)
        self.assertEqual(n, 600)
        with open(self._dest(), "rb") as f:
            self.assertEqual(f.read(), b"G1 X1\n" * 100)
        self.assertEqual(self._parts(), [], "left a .part temp behind")

    def test_same_name_without_flag_is_409_and_original_untouched(self):
        self._upload(b"ORIGINAL\n", replace=False)
        with self.assertRaises(HTTPException) as cm:
            self._upload(b"REPLACEMENT\n", replace=False)
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(cm.exception.detail, {"error": "exists", "filename": "prog.ngc"})
        with open(self._dest(), "rb") as f:
            self.assertEqual(f.read(), b"ORIGINAL\n")
        self.assertEqual(self._parts(), [], "left a .part temp behind after 409")

    def test_same_name_with_flag_replaces(self):
        self._upload(b"ORIGINAL\n", replace=False)
        self._upload(b"REPLACEMENT\n", replace=True)
        with open(self._dest(), "rb") as f:
            self.assertEqual(f.read(), b"REPLACEMENT\n")
        self.assertEqual(self._parts(), [])

    def test_two_concurrent_same_name_uploads_have_exactly_one_winner(self):
        a, b = b"AAAA\n" * 300, b"BBBB\n" * 300

        async def _both():
            return await asyncio.gather(
                gateway._atomic_stream_upload(_FakeUpload(a), self._dest(), 10 << 20, chunk_size=256, replace=False),
                gateway._atomic_stream_upload(_FakeUpload(b), self._dest(), 10 << 20, chunk_size=256, replace=False),
                return_exceptions=True,
            )

        results = _run(_both())
        oks = [r for r in results if isinstance(r, int)]
        conflicts = [r for r in results if isinstance(r, HTTPException) and r.status_code == 409]
        self.assertEqual(len(oks), 1, results)
        self.assertEqual(len(conflicts), 1, results)
        with open(self._dest(), "rb") as f:
            content = f.read()
        self.assertIn(content, (a, b), "published file is neither upload — torn write")
        self.assertEqual(self._parts(), [])

    def test_concurrent_reader_sees_nothing_then_the_whole_file(self):
        data = b"G1 X1\n" * 2000
        up = _GatedUpload(data)

        async def _drive():
            task = asyncio.ensure_future(
                gateway._atomic_stream_upload(up, self._dest(), 10 << 20, chunk_size=512, replace=False))
            await asyncio.wait_for(up.first_read_done.wait(), 5)
            # Mid-stream: the destination name does not exist (only a .part temp).
            self.assertFalse(os.path.exists(self._dest()), "destination visible before publish")
            self.assertEqual(len(self._parts()), 1)
            up.release.set()
            return await task

        n = _run(_drive())
        self.assertEqual(n, len(data))
        with open(self._dest(), "rb") as f:
            self.assertEqual(f.read(), data)
        self.assertEqual(self._parts(), [])

    def test_link_unsupported_refuses_with_500_and_no_dest(self):
        def _no_link(src, dst, *a, **k):
            raise OSError(errno.ENOTSUP, "Operation not supported")

        with mock.patch.object(gateway.os, "link", _no_link):
            with self.assertRaises(HTTPException) as cm:
                self._upload(b"G1 X1\n", replace=False)
        self.assertEqual(cm.exception.status_code, 500)
        self.assertIn("no-replace", str(cm.exception.detail))
        self.assertFalse(os.path.exists(self._dest()), "published despite refusing")
        self.assertEqual(self._parts(), [], "left a .part temp behind after refusal")

    def test_error_mid_write_leaves_no_dest(self):
        class _Boom(_FakeUpload):
            async def read(self, n: int = -1) -> bytes:
                chunk = self._buf.read(n)
                if not chunk:
                    raise RuntimeError("stream broke")
                return chunk

        with self.assertRaises(RuntimeError):
            _run(gateway._atomic_stream_upload(_Boom(b"G1 X1\n" * 10), self._dest(), 10 << 20,
                                               chunk_size=16, replace=False))
        self.assertFalse(os.path.exists(self._dest()))
        self.assertEqual(self._parts(), [])


class TestUploadRoute(unittest.TestCase):
    """The route maps the ``overwrite`` query to the replace flag."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._patch = mock.patch.object(gateway, "get_nc_files_dir", return_value=self.tmp)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_default_refuses_replace_and_flag_allows_it(self):
        first = _run(gateway.upload_gcode(_FakeUpload(b"ONE\n", "a.ngc"), overwrite=0))
        self.assertTrue(first["ok"])
        with self.assertRaises(HTTPException) as cm:
            _run(gateway.upload_gcode(_FakeUpload(b"TWO\n", "a.ngc"), overwrite=0))
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(cm.exception.detail["filename"], "a.ngc")
        with open(os.path.join(self.tmp, "a.ngc"), "rb") as f:
            self.assertEqual(f.read(), b"ONE\n")
        second = _run(gateway.upload_gcode(_FakeUpload(b"TWO\n", "a.ngc"), overwrite=1))
        self.assertTrue(second["ok"])
        with open(os.path.join(self.tmp, "a.ngc"), "rb") as f:
            self.assertEqual(f.read(), b"TWO\n")


if __name__ == "__main__":
    unittest.main()
