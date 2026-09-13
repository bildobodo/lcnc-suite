"""Session binding (session_bind.py) — identity, admission, gate, launcher bind.

Pure/stdlib: no HAL, no gateway import. Sockets are real ``socketpair``s
(SO_PEERCRED works on them: the peer is this process), /proc identity runs
against a temp fake proc tree AND against this process, and the PDEATHSIG
test spawns a real bash "launcher" and SIGKILLs it.
"""
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

import session_bind as sb

HERE = os.path.dirname(os.path.abspath(__file__))


def _write_proc(root: str, pid: int, comm: str, state: str = "S", start: int = 100) -> None:
    d = os.path.join(root, str(pid))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "comm"), "w") as f:
        f.write(comm + "\n")
    # pid (comm) state + 18 filler fields + starttime (field 22) + trailing fields
    tail = " ".join(["0"] * 18)
    with open(os.path.join(d, "stat"), "w") as f:
        f.write(f"{pid} ({comm}) {state} {tail} {start} 1 2 3 4\n")


class TestIdentity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_self_is_identifiable(self):
        inst = sb.instance_for_pid(os.getpid())
        self.assertIsNotNone(inst)
        self.assertEqual(inst[0], os.getpid())
        self.assertGreater(inst[1], 0)
        comm = sb.proc_comm(os.getpid())
        self.assertIn(os.getpid(), sb.find_pids_by_comm(comm))

    def test_missing_pid_is_none(self):
        self.assertIsNone(sb.instance_for_pid(None))
        self.assertIsNone(sb.instance_for_pid(999999999, self.root))
        self.assertIsNone(sb.proc_start_ticks(999999999, self.root))

    def test_comm_with_spaces_and_parens(self):
        _write_proc(self.root, 42, "weird (comm) name", start=777)
        self.assertEqual(sb.proc_stat_fields(42, self.root), (b"S", 777))
        self.assertEqual(sb.instance_for_pid(42, self.root), (42, 777))

    def test_zombie_is_not_an_instance(self):
        _write_proc(self.root, 43, "linuxcncsvr", state="Z", start=5)
        self.assertEqual(sb.proc_start_ticks(43, self.root), 5)  # readable...
        self.assertIsNone(sb.instance_for_pid(43, self.root))    # ...but not an instance
        self.assertEqual(sb.discover_instance(self.root), (None, []))

    def test_discover_newest_of_several(self):
        _write_proc(self.root, 10, "linuxcncsvr", start=100)
        _write_proc(self.root, 11, "linuxcncsvr", start=300)
        _write_proc(self.root, 12, "linuxcncsvr", start=200)
        _write_proc(self.root, 13, "milltask", start=999)
        _write_proc(self.root, 14, "linuxcncsvr", state="Z", start=5000)  # zombie ignored
        newest, found = sb.discover_instance(self.root)
        self.assertEqual(newest, (11, 300))
        self.assertEqual(found, [(10, 100), (12, 200), (11, 300)])


class TestResolver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.logs = []
        self.emits = []

    def tearDown(self):
        self.tmp.cleanup()

    def _resolver(self):
        return sb.InstanceResolver("wd", log=self.logs.append,
                                   emit=lambda tag, **kw: self.emits.append((tag, kw)),
                                   proc_root=self.root)

    def test_lazy_then_cache_once(self):
        r = self._resolver()
        self.assertIsNone(r.current())          # linuxcncsvr not up yet
        _write_proc(self.root, 20, "linuxcncsvr", start=50)
        self.assertEqual(r.current(), (20, 50))  # binds
        self.assertEqual([e[0] for e in self.emits], ["wd.instance_bound"])
        # A NEWER instance appearing later must NOT be adopted.
        _write_proc(self.root, 21, "linuxcncsvr", start=60)
        self.assertEqual(r.current(), (20, 50))
        self.assertFalse(r.ended())
        # The bound instance dying is reported as ended, not re-resolved.
        os.remove(os.path.join(self.root, "20", "stat"))
        self.assertTrue(r.ended())
        self.assertEqual(r.current(), (20, 50))

    def test_multiple_instances_logged_once(self):
        _write_proc(self.root, 30, "linuxcncsvr", start=1)
        _write_proc(self.root, 31, "linuxcncsvr", start=2)
        r = self._resolver()
        self.assertEqual(r.current(), (31, 2))
        multi = [e for e in self.emits if e[0] == "wd.multiple_instances"]
        self.assertEqual(len(multi), 1)
        self.assertEqual(multi[0][1]["level"], "error")
        self.assertEqual(multi[0][1]["pids"], [30, 31])


class TestEvaluateAdmission(unittest.TestCase):
    EXP = (1000, 5555)

    def _ok_hello(self, **over):
        h = sb.make_hello(self.EXP, gateway_pid=4242)
        h.update(over)
        return h

    def _eval(self, hello, **kw):
        args = dict(peer_pid=4242, peer_uid=1000, my_uid=1000, expected=self.EXP,
                    existing_healthy=False)
        args.update(kw)
        return sb.evaluate_admission(hello, **args)

    def test_accept(self):
        self.assertEqual(self._eval(self._ok_hello()), (True, "ok"))

    def test_no_hello_variants(self):
        self.assertEqual(self._eval(None)[1], "no_hello")
        self.assertEqual(self._eval({"heartbeat": True})[1], "no_hello")   # old-code gateway
        self.assertEqual(self._eval({"type": "snapshot"})[1], "no_hello")

    def test_proto(self):
        self.assertEqual(self._eval(self._ok_hello(proto=2))[1], "proto_unsupported")

    def test_fail_closed_without_peercred(self):
        self.assertEqual(self._eval(self._ok_hello(), peer_pid=None)[1], "no_peercred")
        self.assertEqual(self._eval(self._ok_hello(), peer_uid=None)[1], "no_peercred")

    def test_uid_and_pid(self):
        self.assertEqual(self._eval(self._ok_hello(), peer_uid=0)[1], "uid_mismatch")
        self.assertEqual(self._eval(self._ok_hello(), peer_pid=4243)[1], "pid_mismatch")
        self.assertEqual(self._eval(self._ok_hello(gateway_pid="4242"))[1], "bad_hello")
        self.assertEqual(self._eval(self._ok_hello(gateway_pid=True))[1], "bad_hello")

    def test_instance_variants(self):
        self.assertEqual(self._eval(self._ok_hello(instance=None))[1], "unbound_gateway")
        self.assertEqual(self._eval(self._ok_hello(instance={"pid": 1}))[1], "bad_hello")
        self.assertEqual(self._eval(self._ok_hello(instance=[1, 2]))[1], "bad_hello")
        self.assertEqual(self._eval(self._ok_hello(instance={"pid": True, "start": 1}))[1], "bad_hello")
        self.assertEqual(self._eval(self._ok_hello(), expected=None)[1], "no_current_instance")
        self.assertEqual(self._eval(self._ok_hello(), expected_ended=True)[1], "instance_ended")
        stale = sb.make_hello((1000, 5554), gateway_pid=4242)   # same pid, older start
        self.assertEqual(self._eval(stale)[1], "stale_instance")

    def test_duplicate_only_after_identity_passes(self):
        self.assertEqual(self._eval(self._ok_hello(), existing_healthy=True)[1], "duplicate_gateway")
        stale = sb.make_hello((1, 1), gateway_pid=4242)
        # A stale orphan is named stale even while a live gateway is attached.
        self.assertEqual(self._eval(stale, existing_healthy=True)[1], "stale_instance")


class TestAdmissionGate(unittest.TestCase):
    """Real socketpairs: the peer of the server-side socket is this process."""

    def setUp(self):
        self.logs = []
        self.emits = []
        self.expected = (77, 88)
        self.healthy = False
        self.ended = False
        self.pairs = []

    def tearDown(self):
        for a, b in self.pairs:
            for s in (a, b):
                try:
                    s.close()
                except OSError:
                    pass

    def _gate(self, **kw):
        args = dict(emit=lambda tag, **f: self.emits.append((tag, f)), log=self.logs.append)
        args.update(kw)
        return sb.AdmissionGate("wd", lambda: self.expected, lambda: self.healthy,
                                expected_ended=lambda: self.ended, **args)

    def _pair(self):
        a, b = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        self.pairs.append((a, b))
        return a, b  # a = gateway side, b = helper side

    @staticmethod
    def _reply(sock):
        sock.settimeout(1.0)
        return json.loads(sock.recv(4096).decode().split("\n", 1)[0])

    def test_admit_with_pipelined_leftover(self):
        gw, srv = self._pair()
        gate = self._gate()
        gate.add(srv)
        self.assertIn(srv, gate)
        self.assertEqual(gate.socks(), [srv])
        hello = json.dumps(sb.make_hello(self.expected)) + "\n"
        gw.sendall((hello + '{"heartbeat": true}\n').encode())
        adm = gate.handle_readable(srv)
        self.assertIsNotNone(adm)
        self.assertIs(adm.sock, srv)
        self.assertEqual(adm.leftover, '{"heartbeat": true}\n')
        self.assertEqual(adm.peer_pid, os.getpid())
        self.assertNotIn(srv, gate)
        self.assertEqual(self._reply(gw), {"type": "welcome"})
        self.assertEqual([e[0] for e in self.emits], ["wd.client_admitted"])
        self.assertFalse(srv.getblocking())  # gate made it non-blocking

    def test_old_code_client_rejected_on_first_line(self):
        gw, srv = self._pair()
        gate = self._gate()
        gate.add(srv)
        gw.sendall(b'{"heartbeat": true, "connected": true}\n')
        self.assertIsNone(gate.handle_readable(srv))
        self.assertEqual(self._reply(gw), {"type": "rejected", "reason": "no_hello"})
        self.assertEqual(gw.recv(10), b"")  # closed
        self.assertNotIn(srv, gate)
        rej = [e for e in self.emits if e[0] == "wd.client_rejected"]
        self.assertEqual(rej[0][1]["reason"], "no_hello")
        self.assertEqual(rej[0][1]["level"], "error")

    def test_stale_and_duplicate_and_ended(self):
        for reason, setup, inst in (
            ("stale_instance", lambda: None, (1, 1)),
            ("duplicate_gateway", lambda: setattr(self, "healthy", True), self.expected),
            ("instance_ended", lambda: setattr(self, "ended", True), self.expected),
        ):
            self.healthy = False
            self.ended = False
            setup()
            gw, srv = self._pair()
            gate = self._gate()
            gate.add(srv)
            gw.sendall((json.dumps(sb.make_hello(inst)) + "\n").encode())
            self.assertIsNone(gate.handle_readable(srv))
            self.assertEqual(self._reply(gw)["reason"], reason)

    def test_partial_hello_stays_pending_then_admits(self):
        gw, srv = self._pair()
        gate = self._gate()
        gate.add(srv)
        line = json.dumps(sb.make_hello(self.expected)) + "\n"
        gw.sendall(line[:10].encode())
        self.assertIsNone(gate.handle_readable(srv))
        self.assertIn(srv, gate)
        gw.sendall(line[10:].encode())
        self.assertIsNotNone(gate.handle_readable(srv))

    def test_not_readable_is_not_an_error(self):
        _gw, srv = self._pair()
        gate = self._gate()
        gate.add(srv)
        self.assertIsNone(gate.handle_readable(srv))  # BlockingIOError swallowed
        self.assertIn(srv, gate)

    def test_hello_timeout(self):
        gw, srv = self._pair()
        gate = self._gate(hello_timeout=2.0)
        gate.add(srv, now=1000.0)
        gate.expire(now=1001.0)
        self.assertIn(srv, gate)
        gate.expire(now=1003.5)
        self.assertNotIn(srv, gate)
        self.assertEqual(self._reply(gw)["reason"], "hello_timeout")

    def test_too_many_pending(self):
        gate = self._gate(max_pending=2)
        gws = []
        for _ in range(3):
            gw, srv = self._pair()
            gws.append(gw)
            gate.add(srv)
        self.assertEqual(len(gate), 2)
        self.assertEqual(self._reply(gws[2])["reason"], "too_many_pending")
        gate.close_all()
        self.assertEqual(len(gate), 0)

    def test_reject_logging_is_throttled_but_counted(self):
        gate = self._gate(reject_log_interval=0.2)
        for _ in range(4):
            gw, srv = self._pair()
            gate.add(srv)
            gw.sendall(b'{"heartbeat": true}\n')
            gate.handle_readable(srv)
        rej = [e for e in self.emits if e[0] == "wd.client_rejected"]
        self.assertEqual(len(rej), 1)              # burst → one line
        self.assertEqual(rej[0][1]["count"], 1)
        time.sleep(0.25)
        gw, srv = self._pair()
        gate.add(srv)
        gw.sendall(b'{"heartbeat": true}\n')
        gate.handle_readable(srv)
        rej = [e for e in self.emits if e[0] == "wd.client_rejected"]
        self.assertEqual(len(rej), 2)
        self.assertEqual(rej[1][1]["count"], 4)    # the 3 suppressed + this one

    def test_peer_closed_before_hello(self):
        gw, srv = self._pair()
        gate = self._gate()
        gate.add(srv)
        gw.close()
        self.assertIsNone(gate.handle_readable(srv))
        self.assertNotIn(srv, gate)
        self.assertEqual([e[0] for e in self.emits], ["wd.client_dropped"])


class TestLauncherBind(unittest.TestCase):
    def test_standalone(self):
        self.assertEqual(sb.bind_to_launcher({}), {"mode": "standalone"})
        self.assertEqual(sb.bind_to_launcher({"LCNC_LAUNCHER_PID": " "}), {"mode": "standalone"})

    def test_bad_pid(self):
        r = sb.bind_to_launcher({"LCNC_LAUNCHER_PID": "nope"}, signum=0)
        self.assertEqual((r["mode"], r["ok"], r["reason"]), ("launcher", False, "bad_launcher_pid"))

    def test_dead_launcher(self):
        p = subprocess.Popen(["true"])
        p.wait()  # reaped → pid dead
        r = sb.bind_to_launcher({"LCNC_LAUNCHER_PID": str(p.pid)}, signum=0)
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "launcher_gone")

    def test_alive_not_parent_needs_poll(self):
        p = subprocess.Popen(["sleep", "5"])
        try:
            r = sb.bind_to_launcher({"LCNC_LAUNCHER_PID": str(p.pid)}, signum=0)
            self.assertTrue(r["ok"])
            self.assertEqual(r["reason"], "ppid_mismatch")
            self.assertTrue(r["needs_poll"])
        finally:
            p.kill()
            p.wait()

    def test_parent_is_launcher(self):
        r = sb.bind_to_launcher({"LCNC_LAUNCHER_PID": str(os.getppid())}, signum=0)
        self.assertTrue(r["ok"])
        self.assertNotIn("reason", r)
        self.assertFalse(r["needs_poll"])

    def test_launcher_poll_fires_on_dead_pid(self):
        p = subprocess.Popen(["true"])
        p.wait()
        fired = []
        t = sb.start_launcher_poll(p.pid, interval=0.05, on_dead=lambda: fired.append(1))
        t.join(2.0)
        self.assertEqual(fired, [1])

    def test_pdeathsig_end_to_end(self):
        """A bash 'launcher' forks a python child that binds to it; SIGKILL the
        bash (no trap can run) → the child must die on its own."""
        with tempfile.TemporaryDirectory() as tmp:
            pidfile = os.path.join(tmp, "child.pid")
            child = (
                "import os, session_bind, signal, sys, time\n"
                "r = session_bind.bind_to_launcher()\n"
                "assert r['ok'] and not r['needs_poll'], r\n"
                f"open({pidfile!r}, 'w').write(str(os.getpid()))\n"
                "while True: time.sleep(0.1)\n"
            )
            child_py = os.path.join(tmp, "child.py")
            with open(child_py, "w") as f:
                f.write(child)
            script = f"export LCNC_LAUNCHER_PID=$$; {sys.executable} {child_py} & wait"
            env = dict(os.environ, PYTHONPATH=HERE)
            bash = subprocess.Popen(["bash", "-c", script], env=env)
            try:
                for _ in range(100):
                    if os.path.exists(pidfile) and open(pidfile).read().strip():
                        break
                    time.sleep(0.05)
                else:
                    self.fail("child never bound to the launcher")
                child_pid = int(open(pidfile).read().strip())
                self.assertTrue(sb.pid_alive(child_pid))
                os.kill(bash.pid, signal.SIGKILL)
                bash.wait()
                for _ in range(40):
                    if not sb.pid_alive(child_pid):
                        break
                    time.sleep(0.05)
                self.assertFalse(sb.pid_alive(child_pid), "child outlived its SIGKILLed launcher")
            finally:
                if bash.poll() is None:
                    bash.kill()
                    bash.wait()


if __name__ == "__main__":
    unittest.main()
