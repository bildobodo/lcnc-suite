"""The payload contract's completeness scan (package 3a, Codex R363–R365).

Reads gateway.py (and the helpers it hands `msg` to in features.py and
command_policy.py) as SOURCE: every field a command branch reads from `msg`
— `msg.get("k")`, `msg["k"]`, `"k" in msg`, in the branch, in a closure, in
a helper it passes `msg` to (resolved, its own reads scanned) — must be a
field of that command's COMMAND_SCHEMA entry; a REQUIRED field is never read
with a default (`msg.get("k", d)`): the default would come back. The reader's
frames and the worker's `arm` are held against their own tables (they never
pass validate_payload). Every use of `msg` the scan cannot read — another
name for it, `**msg`, iteration, an unresolved callee — is a problem, never
silently skipped. Pure source reading: no gateway import.

    .venv/bin/python3 -m pytest -q test_payload_scan.py
"""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

import fake_linuxcnc
fake_linuxcnc.install()
import command_policy as cp  # noqa: E402

HERE = Path(__file__).resolve().parent
SOURCES = {name: (HERE / name).read_text() for name in ("gateway.py", "features.py", "command_policy.py")}

#: fields every command may carry: its name, the reply correlation, the
#: gamepad marker (_command_feature_refusal reads it for any command; the
#: schema bounds it on the gamepad's commands, the stops drop a bad one)
META = {"cmd", "req_id", "via"}

#: the reader's frames (Teil 5 of the contract): each frame's fields
READER_FIELDS = {
    "heartbeat": {"seq"},
    "hello": {"session", "resume_armed", "device_token", "device_storage"},
    "safety_trip_ack": {"id"},
    "get_settings": set(),
    "save_settings": {"section", "data", "base_rev", "device"},
    "device_rename": {"name", "device"}, "device_reset": {"device"}, "device_delete": {"device"},
    "client_diag": {"data"},
    "timing_log": {"enable"}, "halshow_live": {"on"}, "halshow_refresh": set(), "tab_visibility": {"hidden"},
}
#: the worker's own frame: `arm` — anything but the literal true disarms (N5)
WORKER_FIELDS = {"arm": {"armed"}}


def _defs(trees: dict) -> dict:
    out = {}
    for mod, tree in trees.items():
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out[node.name] = (mod, node)
    return out


#: module aliases the gateway uses for features / command_policy
ALIASES = {"_features": "features", "features": "features", "command_policy": "command_policy"}


class Scan:
    def __init__(self, sources: dict):
        self.trees = {name: ast.parse(src) for name, src in sources.items()}
        self.defs = _defs(self.trees)
        self.problems: list[str] = []

    # -- which commands an `if` test names ---------------------------------
    @staticmethod
    def _cmds(test, var: str, reader: bool) -> set:
        def name_is(n):
            if reader:   # msg.get("cmd")
                return (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "get"
                        and isinstance(n.func.value, ast.Name) and n.func.value.id == var and n.args
                        and isinstance(n.args[0], ast.Constant) and n.args[0].value == "cmd")
            return isinstance(n, ast.Name) and n.id == "cmd"
        if isinstance(test, ast.Compare) and name_is(test.left) and len(test.ops) == 1:
            op, right = test.ops[0], test.comparators[0]
            if isinstance(op, ast.Eq) and isinstance(right, ast.Constant) and isinstance(right.value, str):
                return {right.value}
            if isinstance(op, ast.In) and isinstance(right, (ast.Tuple, ast.Set, ast.List)):
                vals = {e.value for e in right.elts if isinstance(e, ast.Constant)}
                if len(vals) == len(right.elts):
                    return vals
        if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.Or):
            parts = [Scan._cmds(v, var, reader) for v in test.values]
            if all(parts):
                return set().union(*parts)
        if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.And):
            return Scan._cmds(test.values[0], var, reader)
        return set()

    # -- the reads of one variable in a subtree ------------------------------
    def reads(self, node, var: str, where: str, depth: int = 0, seen=None) -> list[tuple[str, bool]]:
        """[(field, read_with_default)] of `var` in `node`; an unreadable use
        is recorded as a problem."""
        seen = set() if seen is None else seen
        parents = {}
        for p in ast.walk(node):
            for c in ast.iter_child_nodes(p):
                parents[c] = p
        out: list[tuple[str, bool]] = []
        for n in ast.walk(node):
            if not (isinstance(n, ast.Name) and n.id == var and isinstance(n.ctx, ast.Load)):
                continue
            p = parents.get(n)
            if isinstance(p, ast.Subscript) and p.value is n:
                if isinstance(p.slice, ast.Constant) and isinstance(p.slice.value, str):
                    out.append((p.slice.value, False))
                    continue
            if isinstance(p, ast.Attribute) and p.value is n and p.attr == "get":
                call = parents.get(p)
                if isinstance(call, ast.Call) and call.func is p and call.args and \
                        isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
                    out.append((call.args[0].value, len(call.args) > 1))
                    continue
            if isinstance(p, ast.Compare) and n in p.comparators and isinstance(p.left, ast.Constant) \
                    and all(isinstance(o, (ast.In, ast.NotIn)) for o in p.ops):
                out.append((p.left.value, False))
                continue
            if isinstance(p, ast.Call) and n in p.args and isinstance(p.func, ast.Name) and p.func.id == "isinstance":
                continue      # a type test reads no field
            if isinstance(p, ast.Call) and (n in p.args or any(k.value is n for k in p.keywords)):
                out += self._helper(p, n, where, depth, seen)
                continue
            if isinstance(p, ast.arguments):       # a default `m=msg`: the nested def's own reads
                fn = parents.get(p)
                idx = (p.defaults.index(n) + len(p.args) - len(p.defaults)) if n in p.defaults else None
                if idx is not None and fn is not None:
                    out += self.reads(fn, p.args[idx].arg, f"{where} › {getattr(fn, 'name', 'lambda')}",
                                      depth + 1, seen)
                    continue
            self.problems.append(f"{where}: `{var}` used as {type(p).__name__} at line {n.lineno} — the scan "
                                 "cannot read that form")
        return out

    def _helper(self, call, arg, where, depth, seen):
        f = call.func
        name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) and
                                                     isinstance(f.value, ast.Name) and f.value.id in ALIASES
                                                     else None)
        if name in ("_req_echo", "_req_id_of"):
            return [("req_id", False)]
        if name in ("validate_payload", "widen_stop"):
            return []       # the check itself
        if name is None or name not in self.defs:
            self.problems.append(f"{where}: `msg` handed to an unresolved callee "
                                 f"{ast.unparse(f)} at line {call.lineno}")
            return []
        if (name, id(arg)) in seen or depth > 6:
            return []
        seen.add((name, id(arg)))
        mod, fn = self.defs[name]
        params = [a.arg for a in fn.args.args]
        if arg in call.args:
            pos = call.args.index(arg)
            if pos >= len(params):
                self.problems.append(f"{where}: `msg` passed past {name}'s parameters")
                return []
            pname = params[pos]
        else:
            pname = next(k.arg for k in call.keywords if k.value is arg)
        return self.reads(fn, pname, f"{where} › {mod}:{name}", depth + 1, seen)

    # -- the branches --------------------------------------------------------
    def branches(self, fn, var: str, reader: bool, where: str) -> dict:
        """{command: [(field, with_default)]} of every `if <cmd test>:` in
        `fn`, elif chains and nesting included; reads outside any command
        branch are recorded under '*'."""
        found: dict = {}

        def visit(stmts, cmds):
            for st in stmts:
                if isinstance(st, ast.If):
                    named = self._cmds(st.test, var, reader)
                    if named:
                        for c in named:
                            found.setdefault(c, []).extend(self.reads(st.test, var, f"{where}[{c}]"))
                        visit(st.body, named)
                        visit(st.orelse, cmds)
                        continue
                    self._collect(st.test, var, cmds, found, where)
                    visit(st.body, cmds)
                    visit(st.orelse, cmds)
                    continue
                if isinstance(st, (ast.With, ast.AsyncWith, ast.For, ast.AsyncFor, ast.While, ast.Try)):
                    for f in ("items", "iter", "test"):
                        sub = getattr(st, f, None)
                        if sub is not None and not isinstance(sub, list):
                            self._collect(sub, var, cmds, found, where)
                        elif isinstance(sub, list):
                            for it in sub:
                                self._collect(it, var, cmds, found, where)
                    for f in ("body", "orelse", "finalbody"):
                        visit(getattr(st, f, []) or [], cmds)
                    for h in getattr(st, "handlers", []) or []:
                        visit(h.body, cmds)
                    continue
                self._collect(st, var, cmds, found, where)
        visit(fn.body, None)
        return found

    def _collect(self, node, var, cmds, found, where):
        for c in (cmds or {"*"}):
            found.setdefault(c, []).extend(self.reads(node, var, f"{where}[{c}]"))

    def fn(self, name):
        return self.defs[name][1]


def _reader_body(scan: Scan):
    ws = scan.fn("ws_endpoint")
    return ws


def contract_problems(sources=SOURCES, schema=None) -> list[str]:
    """Everything the scan finds wrong — empty when the contract holds."""
    schema = cp.COMMAND_SCHEMA if schema is None else schema
    scan = Scan(sources)
    out: list[str] = []
    groups = [n for n in ("_cmds_machine_state", "_cmds_mdi_and_frames", "_cmds_tool_table", "_cmds_program_run",
                          "_cmds_motion_and_overrides", "_cmds_files_and_probing", "_cmds_work_offsets",
                          "_command_feature_refusal") if n in scan.defs]
    for g in groups:
        for cmd, reads in scan.branches(scan.fn(g), "msg", False, g).items():
            for field, with_default in reads:
                if field in META:
                    continue
                if cmd == "*":
                    out.append(f"{g}: `{field}` read outside any command branch")
                    continue
                spec = schema.get(cmd, {}).get(field)
                if spec is None:
                    out.append(f"{g}[{cmd}]: `{field}` is read but not in COMMAND_SCHEMA[{cmd!r}]")
                elif with_default and getattr(spec, "required", False):
                    out.append(f"{g}[{cmd}]: required `{field}` read with a default — the default comes back")
    for fname, table in (("ws_endpoint", READER_FIELDS), ("_execute_client_command", WORKER_FIELDS)):
        if fname not in scan.defs:
            out.append(f"{fname} not found")
            continue
        for cmd, reads in scan.branches(scan.fn(fname), "msg", True, fname).items():
            if cmd == "*" or cmd not in table:
                continue    # the generic part (cmd, req_id, the queue) and the non-reader commands
            for field, _d in reads:
                if field not in META and field not in table[cmd]:
                    out.append(f"{fname}[{cmd}]: `{field}` is read but not in the contract's table")
    return sorted(set(out + scan.problems))


class TestTheScan(unittest.TestCase):
    def test_the_gateway_holds_the_contract(self):
        self.assertEqual(contract_problems(), [])

    def test_the_scan_reads(self):
        """A vacuous-pass guard: the scan finds the fields it should."""
        scan = Scan(SOURCES)
        b = scan.branches(scan.fn("_cmds_motion_and_overrides"), "msg", False, "m")
        self.assertIn(("scale", False), b["set_feed_override"])
        self.assertIn(("axes", False), b["jog_incr_multi"])
        r = scan.branches(scan.fn("ws_endpoint"), "msg", True, "ws")
        self.assertIn(("session", False), r["hello"])
        self.assertIn(("section", False), r["save_settings"])     # through _ws_save_settings

    # -- counter-cases: the scan turns red on each form it must see ---------
    SRC = '''
async def _cmds_x(cmd, msg, armed):
    if cmd == "home":
        joint = msg.get("joint", -1)
    if cmd == "set_feed_override" or cmd == "set_rapid_override":
        helper(msg)
    if cmd == "clear_wcs":
        m = msg
    if cmd == "jog_cont":
        return [k for k in msg]
def helper(p):
    return p.get("bogus")
async def ws_endpoint():
    if msg.get("cmd") == "hello":
        x = msg.get("nickname")
async def _execute_client_command(msg):
    if msg.get("cmd") == "arm":
        y = msg.get("armed")
'''

    def test_each_missed_form_turns_the_scan_red(self):
        src = {"gateway.py": self.SRC.replace("_cmds_x", "_cmds_machine_state"), "features.py": "",
               "command_policy.py": ""}
        problems = "\n".join(contract_problems(src))
        self.assertIn("required `joint` read with a default", problems)
        self.assertIn("`bogus` is read but not in COMMAND_SCHEMA['set_feed_override']", problems)
        self.assertIn("`bogus` is read but not in COMMAND_SCHEMA['set_rapid_override']", problems)  # shared branch
        self.assertIn("used as Assign", problems)                     # another name for msg
        self.assertIn("used as comprehension", problems)              # iteration
        self.assertIn("ws_endpoint[hello]: `nickname`", problems)
        self.assertNotIn("armed", problems)

    def test_an_unresolved_callee_is_named(self):
        src = {"gateway.py": 'async def _cmds_machine_state(cmd, msg, armed):\n    if cmd == "mdi":\n'
               '        somewhere.else_(msg)\n', "features.py": "", "command_policy.py": ""}
        self.assertTrue(any("unresolved callee" in p for p in contract_problems(src)))


if __name__ == "__main__":
    unittest.main()
