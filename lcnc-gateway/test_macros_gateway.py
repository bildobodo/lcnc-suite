"""Macro files in the gateway (package 5, stage B; plan makros.plan.md
Fassung 3, Codex VP69-01..03): the start claims every MDI/AUTO start takes,
the write admission under _source_lock, the macro routes, the program-name
exclusion, the macro folder's state and the run_macro command.

Real gateway module under the fake linuxcnc (pytest only)."""
import asyncio
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
import macro_files  # noqa: E402

FACE = """(MACRO Face top)
(UNITS mm)
(PARAM 1 depth "Depth" length 0.5 min=0 max=5)
(PARAM 2 feed "Feed" feed 600 min=1)
o<face_top> sub
  M73
  G21 G90 G94
  G1 Z[-#1] F#2
o<face_top> endsub
"""
PARK = "(FRAME machine)\no<park> sub\nG53 G0 Z0\no<park> endsub\n"
RCS_EXEC = 2


def _run(coro):
    gateway._cmd_lock = None
    gateway._source_lock = None
    return asyncio.run(coro)


def rev(text):
    return macro_files.revision_of(text.encode())


class _Cmd:
    """A CMD with the binding's method NAMES (mdi / auto / mode) — the start
    hook reads them; serials count up like the binding's."""
    def __init__(self):
        self.calls = []
        self.serial = 0
        self.fail_mdi = False
        self.on_mode = None

    def mdi(self, text):
        if self.fail_mdi:
            raise linuxcnc.error("NML write failed")
        self.serial += 1
        self.calls.append(("mdi", text))

    def auto(self, code, *a):
        self.serial += 1
        self.calls.append(("auto", code) + a)

    def mode(self, m):
        self.serial += 1
        self.calls.append(("mode", m))
        gateway.STAT.task_mode = m
        if self.on_mode:
            self.on_mode()

    def wait_complete(self, *_a):
        return 1


class _Base(unittest.TestCase):
    def setUp(self):
        gateway.lcnc_connected = True
        gateway.STAT = linuxcnc.stat()
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        gateway.STAT.task_mode = linuxcnc.MODE_MDI
        gateway.STAT.enabled = True
        gateway.STAT.state = 1
        gateway.STAT.echo_serial_number = 0
        self.cmd = _Cmd()
        gateway.CMD = self.cmd
        gateway._source_claims.clear()
        self.addCleanup(gateway._source_claims.clear)


class StartClaims(_Base):
    def test_a_start_is_claimed_until_the_controller_is_through(self):
        _run(gateway._cmd_blocking(self.cmd.mdi, "G0 X1", wait=None))
        self.assertEqual([(c.what, c.state, c.serial) for c in gateway._source_claims], [("mdi", "sent", 1)])
        S = gateway.STAT
        for echo, state, interp in [(0, 1, linuxcnc.INTERP_IDLE),          # task has not seen it
                                    (1, RCS_EXEC, linuxcnc.INTERP_IDLE),   # still executing
                                    (1, 1, linuxcnc.INTERP_READING)]:      # done, interpreter busy
            S.echo_serial_number, S.state, S.interp_state = echo, state, interp
            gateway._release_start_claims()
            self.assertEqual(len(gateway._source_claims), 1, (echo, state, interp))
        S.echo_serial_number, S.state, S.interp_state = 1, 1, linuxcnc.INTERP_IDLE
        gateway._release_start_claims()
        self.assertEqual(gateway._source_claims, [])

    def test_only_reading_commands_are_starts(self):
        _run(gateway._cmd_blocking(self.cmd.mode, linuxcnc.MODE_MDI, wait=None))
        _run(gateway._cmd_blocking(self.cmd.auto, linuxcnc.AUTO_PAUSE, wait=None))
        self.assertEqual(gateway._source_claims, [])
        for code in (linuxcnc.AUTO_RUN, linuxcnc.AUTO_STEP, linuxcnc.AUTO_RESUME):
            _run(gateway._cmd_blocking(self.cmd.auto, code, wait=None))
        self.assertEqual([c.what for c in gateway._source_claims], ["auto"] * 3)

    def test_a_command_that_never_left_drops_its_claim(self):
        self.cmd.fail_mdi = True
        with self.assertRaises(linuxcnc.error):
            _run(gateway._cmd_blocking(self.cmd.mdi, "G0 X1", wait=None))
        self.assertEqual([c.state for c in gateway._source_claims], ["unsent"])
        gateway._release_start_claims()
        self.assertEqual(gateway._source_claims, [])

    def test_a_cancelled_handler_keeps_its_claim(self):
        # the write went out; the handler waiting for it is cancelled (an
        # abort preempting it, a disconnect) — the claim stays until the
        # status poller proves the controller through
        release = threading.Event()

        class _Slow(_Cmd):
            def wait_complete(self, *_a):
                release.wait(2)
                return -1
        gateway.CMD = cmd = _Slow()

        async def go():
            t = asyncio.ensure_future(gateway._cmd_blocking(cmd.mdi, "G0 X1", wait=5))
            await asyncio.sleep(0.05)
            t.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await t
        _run(go())
        self.assertEqual([(c.state, c.serial) for c in gateway._source_claims], [("sent", 1)])

    def test_a_write_waits_for_every_claim_and_for_an_idle_interpreter(self):
        self.assertIsNone(gateway._source_write_refusal())
        gateway._source_claims.append(gateway._StartClaim("mdi"))
        self.assertIn("starting or running", gateway._source_write_refusal())
        gateway._source_claims.clear()
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        self.assertIn("runs", gateway._source_write_refusal())

    def test_no_command_reaches_the_controller_around_the_start_hook(self):
        src = Path(gateway.__file__).read_text()
        self.assertEqual(re.findall(r"CMD\.(?:mdi|auto)\s*\(", src), [],
                         "every MDI/AUTO goes through _cmd_blocking, where the start is claimed")


class _Folder(_Base):
    """A macro folder, a program folder and a config folder in a temp dir;
    macro_dir_state patched to describe them."""
    def setUp(self):
        super().setUp()
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        root = Path(t.name)
        self.mdir, self.nc, self.cfg = root / "macros", root / "nc", root / "cfg"
        for d in (self.mdir, self.nc, self.cfg):
            d.mkdir()
        (self.mdir / "face_top.ngc").write_text(FACE)
        (self.mdir / "park.ngc").write_text(PARK)
        self.state = {"dir": str(self.mdir), "problems": [], "prefix": str(self.nc),
                      "subroutine_dirs": [str(self.mdir)], "cwd": str(self.cfg)}
        p = patch.object(gateway, "macro_dir_state", lambda: {**self.state, "problems": list(self.state["problems"])})
        p.start()
        self.addCleanup(p.stop)
        p2 = patch.object(gateway, "get_nc_files_dir", lambda: str(self.nc))
        p2.start()
        self.addCleanup(p2.stop)


class Routes(_Folder):
    def setUp(self):
        super().setUp()
        p = patch.object(gateway, "WEBUI_TOKEN", "t")
        p.start()
        self.addCleanup(p.stop)

    def call(self, method, url, auth=True, **kw):
        async def go():
            gateway._source_lock = None
            transport = httpx.ASGITransport(app=gateway.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                return await c.request(method, url, headers={"X-Auth-Token": "t"} if auth else {}, **kw)
        return asyncio.run(go())

    def test_every_route_needs_the_token(self):
        for m, u in [("GET", "/macros"), ("GET", "/macro?name=park"), ("PUT", "/macro?name=x&base=new"),
                     ("DELETE", f"/macro?name=park&base={rev(PARK)}"), ("POST", "/macro-upload")]:
            self.assertEqual(self.call(m, u, auth=False).status_code, 401, u)

    def test_the_list_says_what_runs_and_why_not(self):
        (self.mdir / "broken.ngc").write_text("(PARM)\no<broken> sub\no<broken> endsub\n")
        (self.nc / "park.ngc").write_text("G0 X0\n")   # a program shadowing park
        body = self.call("GET", "/macros").json()
        by = {m["name"]: m for m in body["macros"]}
        self.assertTrue(by["face_top"]["runnable"])
        self.assertEqual(by["face_top"]["revision"], rev(FACE))
        self.assertEqual([p["key"] for p in by["face_top"]["params"]], ["depth", "feed"])
        self.assertIn("Shadowed by", by["park"]["reason"])
        self.assertIn("Header error", by["broken"]["reason"])
        r = self.call("GET", "/macro?name=face_top")
        self.assertEqual((r.text, r.headers["X-Macro-Revision"]), (FACE, rev(FACE)))

    def test_save_is_bound_to_its_base(self):
        r = self.call("PUT", "/macro?name=new_one&base=new", content=b"o<new_one> sub\no<new_one> endsub\n")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.call("PUT", "/macro?name=new_one&base=new", content=b"x").status_code, 409)
        r = self.call("PUT", f"/macro?name=face_top&base={rev('old')}", content=b"x")
        self.assertEqual(r.status_code, 409)
        self.assertIn("Changed on disk", r.json()["detail"]["reason"])
        self.assertEqual((self.mdir / "face_top.ngc").read_text(), FACE)
        r = self.call("PUT", f"/macro?name=face_top&base={rev(FACE)}", content=FACE.replace("600", "700").encode())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["macro"]["revision"], rev(FACE.replace("600", "700")))

    def test_no_write_while_a_start_is_open(self):
        gateway._source_claims.append(gateway._StartClaim("mdi"))
        r = self.call("PUT", f"/macro?name=face_top&base={rev(FACE)}", content=b"changed")
        self.assertEqual(r.status_code, 409)
        self.assertIn("starting or running", r.json()["detail"]["reason"])
        self.assertEqual((self.mdir / "face_top.ngc").read_text(), FACE)

    def test_a_program_name_is_no_macro_name_and_back(self):
        (self.nc / "taken.ngc").write_text("G0 X0\n")
        r = self.call("PUT", "/macro?name=taken&base=new", content=b"o<taken> sub\no<taken> endsub\n")
        self.assertEqual(r.status_code, 409)
        self.assertIn("Name taken by a program", r.json()["detail"]["reason"])
        r = self.call("POST", "/upload", files={"file": ("face_top.ngc", b"G0 X1\n")})
        self.assertEqual(r.status_code, 409)
        self.assertIn("Name taken by a macro", r.json()["detail"]["reason"])
        self.assertFalse((self.nc / "face_top.ngc").exists())
        self.assertEqual(self.call("POST", "/upload", files={"file": ("other.ngc", b"G0 X1\n")}).status_code, 200)
        # only the exact name the interpreter opens shadows
        self.assertEqual(self.call("POST", "/upload", files={"file": ("Face_top.ngc", b"G0 X1\n")}).status_code, 200)

    def test_a_replacing_import_is_bound_to_the_confirmed_revision(self):
        r = self.call("POST", "/macro-upload", files={"file": ("face_top.ngc", FACE.encode())})
        self.assertEqual(r.status_code, 409)
        r1 = r.json()["detail"]["revision"]
        self.assertEqual(r1, rev(FACE))
        # client B saves r2 meanwhile; A's confirmation still names r1
        r2 = FACE.replace("600", "650")
        self.assertEqual(self.call("PUT", f"/macro?name=face_top&base={r1}", content=r2.encode()).status_code, 200)
        r = self.call("POST", f"/macro-upload?replace={r1}", files={"file": ("face_top.ngc", b"A's import")})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["revision"], rev(r2))
        self.assertEqual((self.mdir / "face_top.ngc").read_text(), r2, "B's save survives")
        r = self.call("POST", f"/macro-upload?replace={rev(r2)}", files={"file": ("face_top.ngc", FACE.encode())})
        self.assertEqual(r.status_code, 200, r.text)

    def test_delete_is_bound_to_its_base(self):
        self.assertEqual(self.call("DELETE", f"/macro?name=park&base={rev('x')}").status_code, 409)
        self.assertTrue((self.mdir / "park.ngc").exists())
        self.assertEqual(self.call("DELETE", f"/macro?name=park&base={rev(PARK)}").status_code, 200)
        self.assertFalse((self.mdir / "park.ngc").exists())

    def test_a_rename_is_one_step_bound_to_the_old_revision(self):
        # the editor dialog's file name (operator 2026-10-03): the text under
        # the new name, the old file gone — only while the old file is still
        # the revision the editor read, and only to a free name
        moved = FACE.replace("o<face_top>", "o<face_flat>")
        url = "/macro?name=face_flat&base=new&rename_from=face_top&rename_base="
        r = self.call("PUT", url + rev("someone else's"), content=moved.encode())
        self.assertEqual(r.status_code, 409)
        self.assertIn("Changed on disk", r.json()["detail"]["reason"])
        self.assertEqual((self.mdir / "face_top.ngc").read_text(), FACE)
        self.assertFalse((self.mdir / "face_flat.ngc").exists())
        r = self.call("PUT", "/macro?name=park&base=new&rename_from=face_top&rename_base=" + rev(FACE), content=b"x")
        self.assertEqual(r.status_code, 409, "the new name is taken")
        self.assertEqual(((self.mdir / "park.ngc").read_text(), (self.mdir / "face_top.ngc").read_text()), (PARK, FACE))
        gateway._source_claims.append(gateway._StartClaim("mdi"))
        r = self.call("PUT", url + rev(FACE), content=moved.encode())
        self.assertEqual(r.status_code, 409, "no rename while a start is open")
        gateway._source_claims.clear()
        self.assertTrue((self.mdir / "face_top.ngc").exists())
        r = self.call("PUT", url + rev(FACE), content=moved.encode())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["macro"]["name"], "face_flat")
        self.assertEqual((self.mdir / "face_flat.ngc").read_text(), moved)
        self.assertFalse((self.mdir / "face_top.ngc").exists())
        for bad in ["/macro?name=x2&base=" + rev(PARK) + "&rename_from=park&rename_base=" + rev(PARK),
                    "/macro?name=x2&base=new&rename_from=park&rename_base=nope",
                    "/macro?name=park&base=new&rename_from=park&rename_base=" + rev(PARK)]:
            self.assertEqual(self.call("PUT", bad, content=b"x").status_code, 400, bad)

    def test_a_rename_whose_old_name_cannot_leave_renames_nothing(self):
        def refuse(path):
            raise PermissionError(13, "Permission denied", path)
        moved = PARK.replace("o<park>", "o<park2>")
        with patch.object(gateway, "_unlink_renamed", refuse):
            r = self.call("PUT", "/macro?name=park2&base=new&rename_from=park&rename_base=" + rev(PARK),
                          content=moved.encode())
        self.assertEqual(r.status_code, 500)
        self.assertIn("Not renamed", r.json()["detail"])
        self.assertEqual((self.mdir / "park.ngc").read_text(), PARK)
        self.assertFalse((self.mdir / "park2.ngc").exists(), "the new name left again")

    def test_the_tool_table_downloads_as_linuxcnc_reads_it(self):
        table = self.cfg / "tool.tbl"
        table.write_bytes(b"T1 P1 Z12.5 D6 ;end mill\nT2 P2 Z-3 D10 ;\xc3\xa4\n")
        with patch.object(gateway, "get_tool_tbl_path", lambda: str(table)):
            self.assertEqual(self.call("GET", "/tool-table", auth=False).status_code, 401)
            r = self.call("GET", "/tool-table")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.content, table.read_bytes())
            self.assertEqual(r.headers["X-File-Name"], "tool.tbl")
            table.unlink()
            self.assertEqual(self.call("GET", "/tool-table").status_code, 404)
        with patch.object(gateway, "get_tool_tbl_path", lambda: None):
            self.assertEqual(self.call("GET", "/tool-table").status_code, 404)

    def test_names_outside_the_rule_are_refused(self):
        for n in ["Park", "../x", "a-b", ""]:
            self.assertIn(self.call("GET", f"/macro?name={n}").status_code, (400, 422), n)


class DelayedWrite(_Folder):
    def test_a_slow_write_meets_a_start_and_publishes_nothing(self):
        path = str(self.mdir / "face_top.ngc")

        async def chunks():
            yield b"part one "
            # a start arrives while the body still streams in
            gateway._source_claims.append(gateway._StartClaim("mdi"))
            yield b"part two"

        async def go():
            with self.assertRaises(gateway.HTTPException) as e:
                await gateway._atomic_stream_write(chunks(), path, 1000, replace=True,
                                                   gate=gateway._macro_write_gate(self.state, path, rev(FACE)))
            return e.exception
        e = _run(go())
        self.assertEqual(e.status_code, 409)
        self.assertEqual(Path(path).read_text(), FACE)
        self.assertEqual([p for p in os.listdir(self.mdir) if p.endswith(".part")], [], "no temp left")


class RunMacro(_Folder):
    def setUp(self):
        super().setUp()
        gateway._skip_flag_unknown = False
        gateway._rfl_task = gateway._rfl_flag_task = None
        self.jog = False
        for name, val in [("_reader_is_stale", lambda: False),
                          ("_reader_get", lambda f: self.jog if f == "jog_active" else None),
                          ("permission_reasons", lambda s: {})]:
            p = patch.object(gateway, name, val)
            p.start()
            self.addCleanup(p.stop)

        async def cycles(n, timeout=1.0):
            return True
        p = patch.object(gateway, "_status_cycles", cycles)
        p.start()
        self.addCleanup(p.stop)

    def send(self, **over):
        from types import SimpleNamespace
        gateway._shared_status = SimpleNamespace(estop=False, enabled=True, emc_enable_in=True, homed=True,
                                                 interp_state=linuxcnc.INTERP_IDLE, paused=False,
                                                 eoffset_enabled=False, rotary_at_zero=True)
        msg = {"cmd": "run_macro", "name": "face_top", "args": [1.5, 400], "revision": rev(FACE)}
        msg.update(over)
        return _run(gateway.handle_command(msg, True))

    def mdis(self):
        return [c[1] for c in self.cmd.calls if c[0] == "mdi"]

    def test_the_built_line_runs_after_a_forced_mode_switch(self):
        self.assertEqual(gateway.STAT.task_mode, linuxcnc.MODE_MDI, "already in MDI")
        r = self.send()
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.calls, [("mode", linuxcnc.MODE_MDI), ("mdi", "o<face_top> call [1.5] [400]")],
                         "the switch is sent although task is in MDI: it empties the subroutine cache")
        self.assertEqual([(c.what, c.state) for c in gateway._source_claims], [("run_macro", "sent")])

    def test_another_revision_runs_nothing(self):
        r = self.send(revision=rev("what the operator saw"))
        self.assertFalse(r["ok"])
        self.assertIn("Macro changed — hold again", r["error"])
        self.assertEqual(self.cmd.calls, [])

    def test_a_jog_or_an_unknown_jog_state_runs_nothing(self):
        self.jog = True
        self.assertIn("A jog is active", self.send()["error"])
        self.jog = None
        self.assertIn("Jog state unknown", self.send()["error"])
        self.assertEqual(self.cmd.calls, [])

    def test_an_ignored_mode_switch_runs_nothing(self):
        self.cmd.on_mode = gateway._note_mode_ignored   # the error channel said so
        r = self.send()
        self.assertFalse(r["ok"])
        self.assertIn("ignored the mode switch", r["error"])
        self.assertEqual(self.mdis(), [])
        gateway._release_start_claims()
        self.assertEqual(gateway._source_claims, [], "the claim of the call that never went is dropped")

    def test_frame_machine_needs_the_machine_frame(self):
        with patch.object(gateway, "permission_reasons", lambda s: {"machineFrame": "Machine frame and Plane only"}):
            r = self.send(name="park", args=[], revision=rev(PARK))
        # the policy's reason verbatim — never "Machine frame only — Machine frame only"
        self.assertEqual(r["error"], "Machine frame and Plane only")
        self.assertEqual(self.cmd.calls, [])
        r = self.send(name="park", args=[], revision=rev(PARK))
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.mdis(), ["o<park> call"])

    def test_values_are_checked_against_the_header(self):
        self.assertIn("at most 5", self.send(args=[9, 400])["error"])
        self.assertIn("takes 2 values", self.send(args=[1])["error"])
        self.assertEqual(self.cmd.calls, [])

    def test_a_shadowed_macro_or_a_folder_problem_runs_nothing(self):
        (self.nc / "face_top.ngc").write_text("G0 X0\n")
        self.assertIn("Shadowed by", self.send()["error"])
        (self.nc / "face_top.ngc").unlink()
        self.state["problems"] = ["Macro folder not on [RS274NGC] SUBROUTINE_PATH"]
        self.assertIn("not on [RS274NGC] SUBROUTINE_PATH", self.send()["error"])
        self.assertEqual(self.cmd.calls, [])


class FolderState(unittest.TestCase):
    """macro_dir_state reads the INI through LinuxCNC's reader (stubbed)."""
    def state(self, values, cwd="CFG"):
        class _Ini:
            def __init__(self, *_a):
                pass

            def find(self, section, key):
                return values.get((section, key))
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            for d in ("cfg", "macros", "nc"):
                (root / d).mkdir()
            ini = root / "cfg" / "machine.ini"
            ini.write_text("")
            fill = lambda v: v.replace("ROOT", t) if isinstance(v, str) else v
            values = {k: fill(v) for k, v in values.items()}
            with patch.dict(os.environ, {"LCNC_INI_FILE": str(ini)}), \
                 patch.object(gateway.linuxcnc, "ini", _Ini), \
                 patch.object(gateway, "_milltask_cwd", lambda _p: None if cwd is None else
                              (str(root / "cfg") if cwd == "CFG" else cwd)):
                return gateway.macro_dir_state()

    def test_each_problem_is_named(self):
        ok = {("DISPLAY", "WEBUI_MACRO_DIR"): "../macros", ("DISPLAY", "PROGRAM_PREFIX"): "ROOT/nc",
              ("RS274NGC", "SUBROUTINE_PATH"): "../macros"}
        self.assertEqual(self.state(ok)["problems"], [])
        self.assertIn("WEBUI_MACRO_DIR", self.state({**ok, ("DISPLAY", "WEBUI_MACRO_DIR"): None})["problems"][0])
        self.assertIn("does not exist", self.state({**ok, ("DISPLAY", "WEBUI_MACRO_DIR"): "../nope"})["problems"][0])
        self.assertIn("overlap", self.state({**ok, ("DISPLAY", "PROGRAM_PREFIX"): "ROOT/macros"})["problems"][0])
        self.assertIn("SUBROUTINE_PATH", self.state({**ok, ("RS274NGC", "SUBROUTINE_PATH"): "../nc"})["problems"][0])
        # the interpreter takes the first ten entries: an eleventh never counts
        many = ":".join(["../nc"] * 10 + ["../macros"])
        self.assertIn("SUBROUTINE_PATH", self.state({**ok, ("RS274NGC", "SUBROUTINE_PATH"): many})["problems"][0])
        self.assertIn("LinuxCNC not running", self.state(ok, cwd=None)["problems"][0])
        self.assertIn("outside the configuration folder", self.state(ok, cwd="/tmp")["problems"][0])


if __name__ == "__main__":
    unittest.main()
