"""The function inventory's guard (Codex R265–R269): the gateway atoms are the
committed atoms.py.json, every atom of both sides has its function, the
operator's table is current, and no source site is unresolved. Each gateway
adapter has a counter-case: what it must find, and what it must report.

    python3 -m pytest scripts/inventory/test_inventory.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import functions as fn  # noqa: E402
import py_atoms as pa  # noqa: E402


@pytest.fixture(scope="module")
def tree():
    return pa.py_atoms()


@pytest.fixture(scope="module")
def loaded():
    return fn.load()


def test_gateway_atoms_are_the_committed_file(tree):
    assert tree == json.loads(pa.OUT.read_text()), (
        "the gateway atoms changed — regenerate (python3 -I scripts/inventory/py_atoms.py --write) "
        "and give each new atom its function in scripts/inventory/functions.json")


def test_every_atom_has_its_function(loaded):
    assert fn.problems(*loaded) == []


def test_the_operator_table_is_current(loaded):
    assert fn.TABLE.read_text() == fn.render(*loaded), "re-render: python3 -I scripts/inventory/functions.py --write"


def test_no_source_site_is_unresolved(loaded):
    web, py, _ = loaded
    v = fn.completeness(web, py)
    assert v["complete"], [f"{n}: {u['file']} {u['form']} {u['expr']}" for n, u in v["unresolved"]]


def test_the_counts_codex_named(tree):
    a = tree["adapters"]
    routes = [x["id"] for x in a["http"]["atoms"] if x["id"].split(":")[1].split()[0] in ("GET", "POST", "PUT", "DELETE")]
    assert len(routes) == 31
    assert {"ini:HAL/HALCMD", "ini:RS274NGC/REMAP"} <= {x["id"] for x in a["ini"]["atoms"]}


# ── Counter-cases (Codex R267/R268) ──────────────────────────────────────

def ini(src: dict[str, str], inis: dict[str, str] | None = None) -> dict:
    return pa.ini_adapter(src, inis or {"p.ini": "[AXIS_X]\nMAX_LIMIT = 1\n[SPINDLE_0]\nMAX_FORWARD_VELOCITY = 1\n"})


def ids(a: dict) -> list[str]:
    return [x["id"] for x in a["atoms"]]


def test_ini_receivers_by_binding_not_name():
    a = ini({"gateway.py": "import linuxcnc\n_kini = linuxcnc.ini(p)\nx = _kini.findall('HAL', 'HALCMD')\ns = 'abc'.find('b', 1)\n"})
    assert ids(a) == ["ini:HAL/HALCMD"] and a["unresolved"] == []


def test_ini_direct_read_on_the_call():
    a = ini({"gateway.py": "import linuxcnc\nlu = linuxcnc.ini(p).find('TRAJ', 'LINEAR_UNITS')\n"})
    assert ids(a) == ["ini:TRAJ/LINEAR_UNITS"]


def test_ini_registered_wrappers_and_their_families():
    src = {"gateway.py": "import linuxcnc\n"
                         "def _ini_float(ini, section, key):\n    return ini.find(section, key)\n"
                         "def f(ini, i, l):\n    a = _ini_float(ini, f'SPINDLE_{i}', 'MAX_FORWARD_VELOCITY')\n"
                         "    sec_axis = f'AXIS_{l}'\n    b = _ini_float(ini, sec_axis, 'MAX_LIMIT')\n",
           "gcode_parse_worker.py": "import linuxcnc\nini = linuxcnc.ini(p)\n"
                                    "def _ini_vel(section, key):\n    return ini.find(section, key)\nv = _ini_vel('TRAJ', 'MAX_LINEAR_VELOCITY')\n"}
    a = ini(src)
    assert ids(a) == ["ini:AXIS_*/MAX_LIMIT", "ini:SPINDLE_*/MAX_FORWARD_VELOCITY", "ini:TRAJ/MAX_LINEAR_VELOCITY"]
    assert next(x for x in a["atoms"] if x["id"] == "ini:AXIS_*/MAX_LIMIT")["members"] == ["p.ini:AXIS_X"]
    assert a["unresolved"] == []


def test_ini_the_registered_consumer_and_a_new_one():
    consumer = "def read_axis_limits(ini_find, mask):\n    return ini_find(f'AXIS_{l}', 'MIN_LIMIT')\n"
    good = ini({"gateway_util.py": consumer, "gateway.py": "import linuxcnc\nini = linuxcnc.ini(p)\nread_axis_limits(ini.find, 7)\n"})
    assert ids(good) == ["ini:AXIS_*/MIN_LIMIT"] and good["unresolved"] == []
    bad = ini({"gateway_util.py": consumer, "gateway.py": "import linuxcnc\nini = linuxcnc.ini(p)\nother_reader(ini.find)\nx = ini.find('A', 'B')\n"})
    assert [u["form"] for u in bad["unresolved"]] == ["an INI read function handed on"]


def test_ini_a_new_wrapper_stays_unresolved_with_a_reason_too():
    # the wrapper reads only when the INI object is handed to it: that call is the site
    a = ini({"gateway.py": "import linuxcnc\nini = linuxcnc.ini(p)\n"
                           "def _ini_int(ini, section, key):  # not yet supported: a technical reason\n"
                           "    return int(ini.find(section, key))\nx = ini.find('A', 'B')\ny = _ini_int(ini, 'C', 'D')\n"})
    assert ids(a) == ["ini:A/B"]
    assert [(u["form"], u["expr"]) for u in a["unresolved"]] == [("an INI object used another way", "_ini_int(ini, 'C', 'D')")]
    assert not fn.completeness({"adapters": {"ini": a}})["complete"]


# Codex R270 FI-I01: each beside one kept read must add an atom or be unresolved.
R270_BASE = "import linuxcnc\nini = linuxcnc.ini(path)\na = ini.find('BASE', 'KEPT')\n"
R270_CASES = {
    "attribute_receiver": R270_BASE + "holder.cfg = linuxcnc.ini(path)\nx = holder.cfg.find('EXTRA', 'ATTRIBUTE')\n",
    "returned_receiver": R270_BASE + "def make_cfg():\n    return linuxcnc.ini(path)\nx = make_cfg().find('EXTRA', 'RETURN')\n",
    "new_wrapper_other_parameter": R270_BASE + "def _ini_int(cfg, section, key):\n    return int(cfg.find(section, key))\nx = _ini_int(ini, 'EXTRA', 'WRAPPER')\n",
    "reader_via_keyword": R270_BASE + "other_reader(read=ini.find)\n",
    "reader_assigned": R270_BASE + "read = ini.find\nx = read('EXTRA', 'ALIAS')\n",
    "registered_wrapper_added_literal": R270_BASE + "def _ini_float(ini, section, key):\n    side = ini.find('EXTRA', 'BODY')\n"
                                        "    return float(ini.find(section, key))\nx = _ini_float(ini, 'BASE', 'KEPT')\n",
}


@pytest.mark.parametrize("case", sorted(R270_CASES))
def test_ini_codex_r270_no_use_disappears(case):
    a = ini({"gateway.py": R270_CASES[case]}, {"p.ini": "[BASE]\nKEPT=1\n"})
    assert ids(a) != ["ini:BASE/KEPT"] or a["unresolved"], f"{case}: only the kept read and complete"


def test_ini_the_literal_in_a_wrapper_body_is_an_atom():
    a = ini({"gateway.py": R270_CASES["registered_wrapper_added_literal"]}, {"p.ini": "[BASE]\nKEPT=1\n"})
    assert ids(a) == ["ini:BASE/KEPT", "ini:EXTRA/BODY"] and a["unresolved"] == []


def test_ini_scopes_a_factory_function_and_truth_tests():
    src = ("import linuxcnc\ndef _g30_ini():\n    return linuxcnc.ini(p) if p else None\n"
           "def f():\n    ini = _g30_ini()\n    if ini and x:\n        return ini.find('AXIS_A', 'WRAPPED_ROTARY')\n"
           "def g(ini):\n    return ini.find('NOT', 'INI')\n"   # a parameter named ini is no INI object
           "def h():\n    y = ini or 1\n")                      # a module-level ini used as a value
    a = ini({"gateway.py": src + "ini = linuxcnc.ini(q)\n"})
    assert ids(a) == ["ini:AXIS_A/WRAPPED_ROTARY"]
    assert [u["form"] for u in a["unresolved"]] == ["an INI object used another way"]


def test_http_a_computed_path_is_unresolved():
    a = pa.http_adapter({"gateway.py": "@app.get('/a')\ndef a(): pass\n@app.post(P)\ndef b(): pass\napp.mount('/x', s)\n"})
    assert ids(a) == ["http:GET /a", "http:MOUNT /x"] and len(a["unresolved"]) == 1


def test_launcher_reads_and_a_computed_name():
    a = pa.launcher_adapter('# ini_get COMMENTED\nX="$(ini_get WEBUI_PORT)"\nY=$(ini_get "$name")\n'
                            'inivar -ini "$I" -sec HAL -var POSTGUI_HALFILE -num 1\n')
    assert ids(a) == ["ini:DISPLAY/WEBUI_PORT", "ini:HAL/POSTGUI_HALFILE"]
    assert [u["expr"] for u in a["unresolved"]] == ['ini_get "$name"']


def test_routines_literal_fstring_docstring_and_the_macro_class():
    a = pa.routines_adapter({"gateway.py": '"""o<doc> call in prose"""\nx = f"O<go_to_zero> CALL {n}"\ny = f"o<{name}> call"\n',
                             "macro_files.py": "line = f\"o<{meta['name']}> call\"\n"})
    assert ids(a) == ["routine:go_to_zero"]
    assert [u["expr"] for u in a["unresolved"]] == ["o<{name}> call"]
    assert [u["form"] for u in a["variantsOpen"]] == ["the macro class"]


def test_status_fields_marked_unread_when_no_web_source_names_them():
    src = {"status_runtime.py": "@dataclass\nclass StatusPayload:\n    estop: bool\n    secret: int\n",
           "ws_fanout.py": "def build_status_envelope(**k):\n    msg = {'type': 'status'}\n    msg['armed'] = 1\n    return msg\n"}
    a = pa.status_adapter(src, "if (s.data.estop) {}; m.type; m['armed']")
    assert {x["id"]: x.get("unread", False) for x in a["atoms"]} == {
        "status:armed": False, "status:data.estop": False, "status:data.secret": True, "status:type": False}


def test_an_adapter_that_finds_nothing_fails():
    with pytest.raises(RuntimeError, match="found nothing"):
        pa.http_adapter({"gateway.py": "x = 1\n"})


# ── The function guard's own rules ───────────────────────────────────────

def side(*atom_ids: str) -> dict:
    return {"adapters": {"a": {"atoms": [{"id": i} for i in atom_ids], "unresolved": []}}}


def guard(fns: list[dict], *atom_ids: str, excluded: dict | None = None) -> list[str]:
    return fn.problems(side(*atom_ids), {"adapters": {}}, {"areas": {"x": "X"}, "functions": fns, "excludedAtoms": excluded or {}})


def test_a_pattern_keeps_its_count_and_a_new_atom_turns_it_red():
    f = [{"id": "F", "area": "x", "name": "n", "atoms": ["c:A|*=2"]}]
    assert guard(f, "c:A|1", "c:A|2") == []
    assert guard(f, "c:A|1", "c:A|2", "c:A|3") == ["F: 'c:A|*=2' matches 3 atoms, pinned 2"]


def test_a_pattern_needs_its_count_and_brackets_are_literal():
    assert guard([{"id": "F", "area": "x", "name": "n", "atoms": ["c:A|*"]}], "c:A|1")[0].endswith("has no pinned count (=n)")
    f = [{"id": "F", "area": "x", "name": "n", "atoms": ["c:p[f.key]*=1"]}]
    assert guard(f, "c:p[f.key]#2") == []


def test_one_primary_owner_and_no_atom_left():
    two = [{"id": "F", "area": "x", "name": "n", "atoms": ["c:1"]}, {"id": "G", "area": "x", "name": "m", "atoms": ["c:1"]}]
    assert "claimed by F and G" in guard(two, "c:1")[0]
    assert guard([{"id": "F", "area": "x", "name": "n", "atoms": []}], "c:1") == ["c:1: no function claims it (found by a)"]
    assert guard([], "c:1", excluded={"c:1": "outside the boundary for a reason"}) == []


def test_a_routine_and_a_remap_are_bound_to_their_shipped_files(tmp_path):
    base = tmp_path / "examples/sim_config"
    (base / "subs").mkdir(parents=True)
    (base / "py").mkdir()
    (base / "p.ini").write_text("[RS274NGC]\nSUBROUTINE_PATH = subs:~/linuxcnc/macros\n"
                                "REMAP=M600 modalgroup=6 ngc=m600\nREMAP=M535 modalgroup=10 python=touch\n"
                                "[PYTHON]\nPATH_APPEND = py\n")
    (base / "subs" / "probe_a.ngc").write_text("o<probe_a> sub\n")
    (base / "subs" / "m600.ngc").write_text("o<m600> sub\n")
    (base / "py" / "remap.py").write_text("def touch(self):\n    pass\n")
    atoms = ["routine:probe_a", "routine:M600", "remap:M600", "remap:M535"]
    assert fn.routine_problems(atoms, tmp_path) == []
    (base / "subs" / "probe_a.ngc").unlink()
    (base / "py" / "remap.py").write_text("def other(self):\n    pass\n")
    assert fn.routine_problems(atoms, tmp_path) == [
        "routine:probe_a: no shipped file in any profile's SUBROUTINE_PATH (nor a remap of it)",
        "remap:M535: p.ini remaps it to python=touch, which it does not ship"]


def test_every_statement_names_its_scope():
    st = lambda **k: [{"id": "F", "area": "x", "name": "n", "atoms": ["c:1"], "statements": [{"id": "S1", "kind": "Daten", "text": "t", **k}]}]
    assert guard(st(applies=["alle"]), "c:1") == [] and guard(st(applies=["Plane"]), "c:1") == []
    assert guard(st(), "c:1") == ['F.S1: no applies — a mode, a profile, "alle" or "offen"']
    assert guard(st(applies=["Lathe"]), "c:1") == ['F.S1: applies to \'Lathe\' — neither a mode, a profile, "alle" nor "offen"']


def test_evidence_is_bound_to_a_file_and_its_title(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "t.py").write_text("def test_x():\n    'the named title'\n    f'${rel} a family'\n")
    assert fn.evidence_problems({"layer": "script", "file": "t.py", "title": "the named title"}, tmp_path) == []
    assert fn.evidence_problems({"layer": "script", "file": "t.py", "title": "${rel} a family", "instances": ["a"]}, tmp_path) == []
    assert fn.evidence_problems({"layer": "script", "file": "t.py", "title": "${rel} a family"}, tmp_path)
    assert fn.evidence_problems({"layer": "script", "file": "t.py", "title": "another"}, tmp_path)
    assert fn.evidence_problems({"layer": "script", "file": "gone.py", "title": "x"}, tmp_path)
