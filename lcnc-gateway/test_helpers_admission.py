"""hal_watchdog.py / hal_reader.py as REAL subprocesses under a stub `hal`
(fake_hal.py), driven by the real HalBridge — the receiver side of session
binding end to end.

The "LinuxCNC instance" is a copy of /bin/sleep with a unique basename so the
helper's InstanceResolver (WEBUI_INSTANCE_COMM) finds exactly it. Pin writes
are read back from the fake_hal journal.
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

import hal_bridge
import session_bind as sb

HERE = os.path.dirname(os.path.abspath(__file__))
SLEEP = shutil.which("sleep")


def _noop(*_a, **_k):
    pass


@unittest.skipIf(SLEEP is None, "needs /bin/sleep")
class _HelperHarness(unittest.TestCase):
    script = ""          # helper file name
    sock_env = ""        # env var the helper reads its socket path from

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        # The fake LinuxCNC instance: a sleep with a unique comm.
        comm = f"svr{os.getpid() % 100000}"
        exe = os.path.join(root, comm)
        shutil.copy(SLEEP, exe)
        os.chmod(exe, 0o755)
        self.svr = subprocess.Popen([exe, "120"])
        self.instance = sb.instance_for_pid(self.svr.pid)
        self.assertIsNotNone(self.instance)
        # Stub hal on PYTHONPATH.
        stub = os.path.join(root, "stub")
        os.makedirs(stub)
        with open(os.path.join(stub, "hal.py"), "w") as f:
            f.write("from fake_hal import *\n")
        self.journal = os.path.join(root, "hal.journal")
        self.sock = os.path.join(root, "helper.sock")
        env = dict(os.environ,
                   PYTHONPATH=f"{stub}:{HERE}",
                   FAKE_HAL_JOURNAL=self.journal,
                   WEBUI_INSTANCE_COMM=comm,
                   LCNC_LOG_DIR=os.path.join(root, "logs"))
        env[self.sock_env] = self.sock
        self.helper = subprocess.Popen(
            [sys.executable, os.path.join(HERE, self.script)],
            env=env, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for _ in range(100):
            if os.path.exists(self.sock):
                break
            time.sleep(0.05)
        else:
            self.fail("helper never bound its socket:\n" + self._helper_output())
        time.sleep(0.2)
        self.rejections = []

    def tearDown(self):
        if self.helper.poll() is None:
            self.helper.send_signal(signal.SIGTERM)
            try:
                self.helper.wait(3.0)
            except subprocess.TimeoutExpired:
                self.helper.kill()
                self.helper.wait()
        if self.svr.poll() is None:
            self.svr.kill()
            self.svr.wait()
        self.tmp.cleanup()

    def _helper_output(self) -> str:
        try:
            self.helper.kill()
            return self.helper.communicate(timeout=2)[0] or ""
        except Exception:
            return ""

    def _bridge(self, instance, **kw):
        args = dict(set_phase=_noop, on_reader_connect=_noop,
                    hello=lambda: sb.make_hello(instance),
                    on_rejected=lambda role, reason: self.rejections.append((role, reason)),
                    watchdog_path=self.sock, reader_path=self.sock,
                    reject_backoff_sec=0.3, helper_reply_sec=1.0)
        args.update(kw)
        return hal_bridge.HalBridge(**args)

    def _journal_lines(self):
        if not os.path.exists(self.journal):
            return []
        with open(self.journal) as f:
            return [json.loads(l) for l in f if l.strip()]

    def _raw_verdict(self, first_line: bytes) -> dict:
        """Connect like an arbitrary client, send one line, return the reply."""
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect(self.sock)
        s.sendall(first_line)
        data = s.recv(4096)
        s.close()
        return json.loads(data.decode().split("\n", 1)[0])


class TestWatchdogAdmission(_HelperHarness):
    script = "hal_watchdog.py"
    sock_env = "WEBUI_SAFETY_SOCK"

    def _pump(self, b, n=8, msg=None):
        for i in range(n):
            b.watchdog_send(msg or {"heartbeat": bool(i % 2), "connected": True})
            time.sleep(0.05)

    def test_admit_reject_replace_end(self):
        # 1. A bound gateway is admitted; its heartbeats reach the pins.
        a = self._bridge(self.instance)
        self._pump(a)
        self.assertTrue(a.watchdog_admitted, self._journal_lines())
        writes = self._journal_lines()
        names = [w["name"] for w in writes]
        self.assertIn("webui-safety.heartbeat", names)
        self.assertIn("webui-safety.connected", names)
        n_before = len(writes)

        # 2. An old-code gateway (heartbeat first) is cut off on its first line
        #    and the admitted gateway's pins are NOT touched.
        v = self._raw_verdict(b'{"heartbeat": true, "connected": true}\n')
        self.assertEqual(v, {"type": "rejected", "reason": "no_hello"})
        time.sleep(0.15)
        self.assertEqual(len(self._journal_lines()), n_before)
        self._pump(a, n=2)
        self.assertTrue(a.watchdog_admitted)

        # 3. A gateway bound to another instance is stale ...
        c = self._bridge((self.instance[0], self.instance[1] + 1))
        self._pump(c, n=4)
        self.assertFalse(c.watchdog_connected)
        self.assertEqual(c.watchdog_reject_reason, "stale_instance")
        # ... and a second bound gateway is a duplicate while A is attached.
        d = self._bridge(self.instance)
        self._pump(d, n=4)
        self.assertEqual(d.watchdog_reject_reason, "duplicate_gateway")
        self.assertIn(("watchdog", "stale_instance"), self.rejections)
        self.assertIn(("watchdog", "duplicate_gateway"), self.rejections)

        # 4. A goes away → EOF → pins LOW; after its backoff D is admitted.
        a.watchdog_disconnect()
        time.sleep(0.5)
        self._pump(d, n=10)
        self.assertTrue(d.watchdog_admitted, self.rejections)
        tail = [w for w in self._journal_lines()[n_before:] if w["name"] == "webui-safety.connected"]
        self.assertIn(False, [w["value"] for w in tail])   # forced LOW on A's EOF

        # 5. The instance ends → nothing else is ever admitted.
        d.watchdog_disconnect()
        self.svr.kill()
        self.svr.wait()
        e = self._bridge(self.instance)
        self._pump(e, n=6)
        self.assertEqual(e.watchdog_reject_reason, "instance_ended")

        # 6. Clean cooperative shutdown.
        self.helper.send_signal(signal.SIGTERM)
        self.assertEqual(self.helper.wait(3.0), 0)
        out = self.helper.stdout.read()
        self.assertIn("admitted", out)
        self.assertIn("REJECTED", out)


class TestReaderAdmission(_HelperHarness):
    script = "hal_reader.py"
    sock_env = "WEBUI_READER_SOCK"

    def test_admit_rpc_and_reject(self):
        import asyncio

        async def run():
            b = self._bridge(self.instance, reader_stale_sec=0.5)
            task = asyncio.create_task(b.reader_recv_loop())
            try:
                for _ in range(100):
                    if b.reader_connected and not b.reader_is_stale():
                        break
                    await asyncio.sleep(0.02)
                self.assertTrue(b.reader_connected)
                self.assertFalse(b.reader_is_stale())     # snapshots flowing
                self.assertIsNone(b.reader_get("trip_latched"))  # stub has no pins → absent, honest
                await b.reader_request("set_p", pin="compensation.reload-req", value="1")
                writes = [w for w in self._journal_lines() if w["kind"] == "set_p"]
                self.assertEqual(writes[-1]["name"], "compensation.reload-req")
                n_setp = len(writes)

                # A pending (never admitted) client cannot issue RPC: its first
                # line is parsed only as a hello.
                v = await asyncio.to_thread(
                    self._raw_verdict, b'{"id": 1, "req": "set_p", "pin": "x", "value": "1"}\n')
                self.assertEqual(v["reason"], "no_hello")
                await asyncio.sleep(0.2)
                self.assertEqual(len([w for w in self._journal_lines() if w["kind"] == "set_p"]), n_setp)

                # Duplicate while the first is attached.
                d = self._bridge(self.instance)
                task_d = asyncio.create_task(d.reader_recv_loop())
                for _ in range(50):
                    if d.reader_reject_reason:
                        break
                    await asyncio.sleep(0.02)
                self.assertEqual(d.reader_reject_reason, "duplicate_gateway")
                task_d.cancel()
                # The first one still works.
                await b.reader_request("halshow_dump")
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
