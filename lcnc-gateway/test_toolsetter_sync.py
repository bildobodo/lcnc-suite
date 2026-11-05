"""P2 (Codex R308–R309): a PROGRAM start from idle applies the server's
confirmed toolsetter section first — its own condition, whatever the skip
flag (FI308-01); one basis per start, chosen once, bound by its digest (the
section and the INI) up to the write (FI308-02); MDI, a macro, a tool change,
a paused step and a resume never sync. Live red, 2026-11-05: a section saved
while the machine was off never reached the interpreter, and a program's
M600 measured against the old #3102."""
import unittest
import unittest.mock

import test_command_dispatch as td   # the fake binding first, then gateway
import gateway  # noqa: E402
from linuxcnc import AUTO_RUN, AUTO_STEP, INTERP_IDLE, INTERP_PAUSED, MODE_AUTO  # noqa: E402

SECTION = {"touchX": 10, "touchY": 10, "touchZ": -179, "fastFeed": 2000, "slowFeed": 20, "traverseFeed": 500,
           "maxZTravel": 180, "retractDist": 3, "spindleZeroHeight": 180}


class _Cmd(td._RecordingCmd):
    """The recording spy; `fail_mdi` (1-based) answers that MDI with RCS_ERROR."""

    def __init__(self):
        super().__init__()
        self.fail_mdi, self.mdis, self._rc = None, 0, 1

    def __getattr__(self, name):
        if name == "mdi":
            def mdi(*a, **k):
                self.calls.append(("mdi", a, k))
                self.mdis += 1
                self._rc = 3 if self.fail_mdi == self.mdis else 1
                return 0
            return mdi
        if name == "wait_complete":
            def wait_complete(*a, **k):
                self.calls.append(("wait_complete", a, k))
                return self._rc
            return wait_complete
        return super().__getattr__(name)


class TestProgramStartSync(unittest.TestCase):
    setUp_handler = td.TestHandlerExecution.setUp
    _send = td.TestHandlerExecution._send
    _auto_run = td.TestHandlerExecution._auto_run
    _with_program = td.TestHandlerExecution._with_program

    def setUp(self):
        self.setUp_handler()
        self.cmd = _Cmd()
        gateway.CMD = self.cmd
        gateway.STAT.enabled = True
        saved = (dict(gateway._ts_basis), gateway._ts_basis_version)
        self.addCleanup(lambda: (setattr(gateway, "_ts_basis", saved[0]), setattr(gateway, "_ts_basis_version", saved[1])))
        gateway._ts_basis, gateway._ts_basis_version = {}, 0
        self.section = {"toolsetter": dict(SECTION)}
        self.reads = 0

        def load_section(name):
            self.reads += 1
            return self.section.get(name)
        p = unittest.mock.patch.object(gateway._settings_store, "load_section", load_section, create=True)
        p.start()
        self.addCleanup(p.stop)

    def mdi_texts(self):
        return [a[0] for n, a, _k in self.cmd.calls if n == "mdi"]

    def toolsetter_mdis(self):
        return [t for t in self.mdi_texts() if "#3102=" in t or "#3004=" in t]

    def before_auto(self):
        """The calls before the first switch to AUTO / AUTO run."""
        out = []
        for n, a, _k in self.cmd.calls:
            if (n == "mode" and a and a[0] == MODE_AUTO) or n == "auto":
                break
            out.append((n, a))
        return out

    # ── which starts sync (FI308-01) ──
    def test_cycle_start_applies_the_saved_section_first(self):
        r = self._send({"cmd": "cycle_start"})
        self.assertTrue(r["ok"], r)
        self.assertTrue(any("#3102=-179.000000" in t for t in self.toolsetter_mdis()), self.mdi_texts())
        self.assertTrue(any(n == "mdi" and "#3102=" in a[0] for n, a in self.before_auto()), "before AUTO")
        self.assertEqual(self.cmd.args_of("auto"), (AUTO_RUN, 0))
        self.assertEqual(r["toolsetter"]["synced"], True)
        self.assertTrue(r["toolsetter"]["digest"])

    def test_the_first_step_from_idle_syncs(self):
        gateway.STAT.interp_state = INTERP_IDLE
        r = self._send({"cmd": "auto_step"})
        self.assertTrue(r["ok"], r)
        self.assertTrue(self.toolsetter_mdis())
        self.assertEqual(self.cmd.args_of("auto"), (AUTO_STEP,))

    def test_a_direct_run_from_line_syncs(self):
        self._with_program()
        r, spawned = self._auto_run()
        self.assertTrue(r["ok"], r)
        self.assertTrue(self.toolsetter_mdis())

    def test_a_paused_step_and_a_resume_never_sync(self):
        gateway.STAT.interp_state = INTERP_PAUSED
        gateway.STAT.task_mode = MODE_AUTO
        payload = td._payload(interp_state=INTERP_PAUSED, is_paused=True, is_running=True, task_mode=MODE_AUTO)
        for cmd in ("auto_step", "cycle_resume"):
            gateway._shared_status = payload
            td._run(gateway.handle_command({"cmd": cmd}, True, self.key))
        self.assertEqual(self.toolsetter_mdis(), [])

    def test_mdi_and_a_tool_change_never_sync(self):
        self._send({"cmd": "mdi", "text": "G0 X1"})
        self._send({"cmd": "tool_change", "tool_number": 5})
        self.assertEqual(self.toolsetter_mdis(), [])

    # ── the booking and the change between starts ──
    def test_a_booked_basis_writes_nothing_and_a_change_between_starts_writes_again(self):
        gateway._skip_flag_unknown = False                    # the flag known clear: no clear to ride on
        # a program known to write no toolsetter key (Codex R105: a start
        # books what the program may write as assumed — unknown, every key,
        # and the next start would sync again, rightly)
        saved = (gateway._bulk.last_file, gateway._bulk.published_toolsetter, gateway._remap_env)
        self.addCleanup(lambda: (setattr(gateway._bulk, "last_file", saved[0]),
                                 setattr(gateway._bulk, "published_toolsetter", saved[1]),
                                 setattr(gateway, "_remap_env", saved[2])))
        self._with_program()
        gateway._bulk.last_file = self.prog
        gateway._bulk.published_toolsetter = {"routine": False, "writes": []}
        gateway._remap_env = lambda: gateway.RemapEnv([], [])
        self.assertTrue(self._send({"cmd": "cycle_start"})["ok"])
        first = len(self.toolsetter_mdis())
        self.assertTrue(first)
        r = self._send({"cmd": "cycle_start"})
        self.assertEqual(len(self.toolsetter_mdis()), first, "booked applied with the same numbers: no write")
        self.assertEqual(r["toolsetter"]["synced"], False)
        self.section["toolsetter"]["touchZ"] = -178
        self.assertTrue(self._send({"cmd": "cycle_start"})["ok"])
        self.assertTrue(any("#3102=-178.000000" in t for t in self.toolsetter_mdis()[first:]))

    # ── what refuses (FI308-02) ──
    def test_not_set_up_writes_nothing_and_starts(self):
        self.section = {}
        r = self._send({"cmd": "cycle_start"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.toolsetter_mdis(), [])
        self.assertEqual(r["toolsetter"]["set_up"], False)

    def test_a_chunk_not_taken_refuses_the_start(self):
        self.cmd.fail_mdi = 2                                 # the second chunk of 23 keys
        r = self._send({"cmd": "cycle_start"})
        self.assertFalse(r["ok"], r)
        self.assertIn("not taken", r["error"])
        self.assertIsNone(self.cmd.args_of("auto"))

    def test_a_section_changed_between_choice_and_write_refuses(self):
        def load_section(name):
            self.reads += 1
            sec = dict(SECTION)
            if self.reads > 1:
                sec["touchZ"] = -150                          # saved by another client meanwhile
            return sec
        with unittest.mock.patch.object(gateway._settings_store, "load_section", load_section, create=True):
            r = self._send({"cmd": "cycle_start"})
        self.assertFalse(r["ok"], r)
        self.assertIn("changed meanwhile", r["error"])
        self.assertIsNone(self.cmd.args_of("auto"))

    def test_run_from_line_with_other_client_values_is_refused_before_any_effect(self):
        self._with_program()
        client = {"3102": -180.0}
        r, spawned = self._auto_run(pre_tool=5, probe_vars=client)
        self.assertFalse(r["ok"], r)
        self.assertIn("confirm Run from line again", r["error"])
        self.assertEqual(self.cmd.calls, [], "nothing written — not even the skip flag")
        self.assertEqual(spawned, [])

    def test_run_from_line_measures_with_the_chosen_basis_and_binds_it(self):
        self._with_program()
        import toolsetter_rules as tr
        client = {str(k): v for k, v in tr.setup(SECTION)["values"].items()}
        r, spawned = self._auto_run(pre_tool=5, probe_vars=client)
        self.assertTrue(r["ok"], r)
        self.assertTrue(any("#3102=-179.000000" in t and "#3116=0.000000" in t or "#3102=-179.000000" in t
                            for t in self.mdi_texts()))
        self.assertTrue(spawned and spawned[0][1].get("basis", {}).get("digest"), spawned)


if __name__ == "__main__":
    unittest.main()


class TestGetProbeVarsRemoved(unittest.TestCase):
    """P2 (Codex R309 D): get_probe_vars read the parameter file unconfirmed —
    a file an interp synch rewrites — and no WebUI caller used it. Removed as
    a protocol change: an old caller gets the plain refusal, never values."""

    def test_an_old_call_is_refused_and_answers_no_values(self):
        import os
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        ini = os.path.join(tmp.name, "m.ini")
        with open(ini, "w") as f:
            f.write("[RS274NGC]\nPARAMETER_FILE = m.var\n")
        with open(os.path.join(tmp.name, "m.var"), "w") as f:
            f.write("3102\t-180.000000\n")

        class _Ini:     # the binding's ini reader: the file above (the old handler read it)
            def __init__(self, path):
                pass

            def find(self, section, var):
                return "m.var" if (section, var) == ("RS274NGC", "PARAMETER_FILE") else None
        saved = getattr(gateway.STAT, "ini_filename", None)
        self.addCleanup(lambda: setattr(gateway.STAT, "ini_filename", saved))
        gateway.STAT.ini_filename = ini
        gateway._shared_status = td._payload()
        with unittest.mock.patch.object(gateway.linuxcnc, "ini", _Ini, create=True):
            r = td._run(gateway.handle_command({"cmd": "get_probe_vars", "vars": [3102]}, True))
        self.assertFalse(r["ok"], r)
        self.assertNotIn("vars", r)
        import command_policy
        self.assertNotIn("get_probe_vars", command_policy.READ_ONLY_COMMANDS)
