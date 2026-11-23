"""The begin hook's coverage (P2b-3, plan v4 — Codex R439/R440): every
command in COMMAND_GATES has an effect class, and every place the gateway
writes a parse input carries the begin — a static scan of the source, like
controlInventory (no gateway import: it would bind the live sim)."""
import ast
import pathlib
import re
import unittest

from command_policy import COMMAND_EFFECTS, COMMAND_GATES, command_effect

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "gateway.py").read_text()
TREE = ast.parse(SRC)
CLASSES = {"input_action", "drift_only", "none"}
#: writers that need no begin of their own, each with its reason
EXEMPT = {
    "_publish_no_replace": "the helper itself — its caller (_commit) begins before it",
    "_safe_unlink": "a temp file's cleanup — never a published program or macro",
}


def functions(tree=TREE):
    """Every function (nested ones too) with its source text."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node, ast.get_source_segment(SRC, node) or ""


def innermost_holding(pattern: str):
    """The innermost functions whose source holds `pattern` (a nested
    function's text is in its parent's too: the parent is dropped)."""
    hits = [(n, s) for n, s in functions() if re.search(pattern, s)]
    return [(n, s) for n, s in hits
            if not any(o is not n and o.lineno >= n.lineno and o.end_lineno <= n.end_lineno
                       for o, _ in hits)]


class TestEveryCommandHasAnEffect(unittest.TestCase):
    def test_the_two_lists_are_one(self):
        self.assertEqual(set(COMMAND_EFFECTS), set(COMMAND_GATES), "every gated command classified, no other")

    def test_the_classes(self):
        self.assertEqual(set(COMMAND_EFFECTS.values()) - CLASSES, set())
        self.assertIsNone(command_effect("get_tool_table"), "a read-only query has none")

    def test_by_effect_not_by_name(self):
        """The routines, the frames, the table and the mode switch write a
        parse input; a start is the AUTO exception; jogs and homing move the
        machine (the drift edges see them)."""
        for cmd in ("mdi", "run_macro", "probe_run", "tool_measure", "set_params", "touchoff", "set_g30",
                    "read_g30", "save_tool", "set_mode", "load_file", "unload_file"):
            self.assertEqual(COMMAND_EFFECTS[cmd], "input_action", cmd)
        for cmd in ("auto_run", "cycle_start", "auto_step", "abort", "estop", "spindle_forward"):
            self.assertEqual(COMMAND_EFFECTS[cmd], "none", cmd)
        for cmd in ("jog_cont", "home", "confirm_tool_change"):
            self.assertEqual(COMMAND_EFFECTS[cmd], "drift_only", cmd)


class TestTheBeginIsAtEveryWriter(unittest.TestCase):
    def test_cmd_blocking_begins_right_before_the_write(self):
        """The one NML path: the observer pending first, the admission and
        the second Link check, then the generation, then the write, then the
        serial booked — in this order in _cmd_blocking's write thread."""
        (_n, src), = [(n, s) for n, s in functions() if n.name == "_cmd_blocking"]
        order = ["input_write_class(command.name", "obs = (_actions.begin(", "refused = admit()",
                 "if not _link_is_current(conn):\n                _refused_before()",
                 "_calc_gen.began(command.name)", "getattr(conn.cmd, command.name)(*args)",
                 "_actions.failed(obs)", "_actions.sent(obs, getattr(conn.cmd, \"serial\", None), conn.seq)"]
        at = [src.find(s) for s in order]
        self.assertTrue(all(i >= 0 for i in at), dict(zip(order, at)))
        self.assertEqual(at, sorted(at), "the order")

    def test_no_nml_write_bypasses_cmd_blocking(self):
        """mdi, mode, the synch and the table reload reach the controller only
        through _cmd_blocking (its classification decides the begin — a
        switch to MANUAL invalidates nothing by its target, never by a
        caller's exemption)."""
        bypass = re.findall(r"\.cmd\.(?:mdi|mode|task_plan_synch|load_tool_table)\(|command\.(?:mdi|mode|task_plan_synch|load_tool_table)\([^)]",
                            SRC)
        self.assertEqual(bypass, [])

    def test_every_file_writer_begins(self):
        """The tool table, the parameter file, a program's and a macro's
        publish or delete: each writer's function begins right before."""
        for pattern, hook in ((r"\bwrite_tool_table\(", "_file_input_began("),
                              (r"_publish_no_replace\(tmp, dest_path\)", "_file_publish_began("),
                              (r"os\.replace\(tmp, dest_path\)", "_file_publish_began("),
                              (r"os\.unlink\(path\)\n", "_file_publish_began(")):
            hits = innermost_holding(pattern)
            self.assertTrue(hits, pattern)
            for n, s in hits:
                if n.name in EXEMPT:
                    continue

                self.assertIn(hook, s, f"{n.name} writes ({pattern}) without its begin")

    def test_the_parameter_file_writer_is_wrapped(self):
        """Every write of the parameter file goes through the wrapper that
        begins (_var_file_write_began); the alias' own line excepted."""
        refs = [m.start() for m in re.finditer(r"_write_var_file_updates", SRC)]
        (_n, wrap), = [(n, s) for n, s in functions() if n.name == "_var_file_write_began"]
        w0 = SRC.find(wrap)
        alias = SRC.find("_write_var_file_updates = _status_runtime_mod.write_var_file_updates")
        for r in refs:
            self.assertTrue(r == alias or w0 <= r < w0 + len(wrap) or SRC[r - 30:r].count("#"),
                            f"a parameter-file write outside the wrapper at offset {r}: {SRC[r - 60:r + 40]!r}")

    def test_every_queue_hold_ends(self):
        """A leaked hold stops every idle parse for good (Fable): the hold
        is taken only after the queue-full refusal, and released on the
        supersede by a stop, on the disconnect drop and when its handler task
        ends — however it ends."""
        i_full, i_hold = SRC.find('"error": f"Command queue full'), SRC.find("_actions.hold(str(_rcmd)")
        self.assertTrue(0 < i_full < i_hold, "the hold after the queue-full refusal")
        self.assertEqual(SRC.count("_actions.hold("), 1, "one place takes a queue hold")
        for site in ('_release_action(_qa, "superseded")', '_release_action(_da, "dropped")',
                     "inflight.add_done_callback(lambda _t, _a=_wact: _release_action(_a, _handler_end(_t)))"):
            self.assertEqual(SRC.count(site), 1, site)

    def test_load_and_unload_begin_a_program_generation(self):
        self.assertIn('began=lambda: _calc_gen.new_program("load")', SRC)
        self.assertIn('began=lambda: _calc_gen.new_program("unload")', SRC)
        self.assertIn('_bulk.cancel_inflight("unload")', SRC)


if __name__ == "__main__":
    unittest.main()
