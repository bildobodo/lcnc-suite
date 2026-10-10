#!/usr/bin/env python3
"""R131 plan probe: code-object/namespace binding of the Suite call graph.

Usage: VENV/bin/python audit.py ARCHIVED_REPOSITORY
Uses numpy for importing the unchanged Suite sources; machine bindings are
replaced with inert modules before import. No remap body is executed.
This models the new contract; it is not the unmerged E implementation.
"""
import ast
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import types

root = Path(sys.argv[1]).resolve()
folder = root / 'examples/sim_config/twp/python'
names = ('remap', 'twp_params', 'twp_prov', 'twp_transform', 'util')
sys.dont_write_bytecode = True
for name in ('interpreter', 'emccanon', 'hal'):
    assert name not in sys.modules
    sys.modules[name] = types.ModuleType(name)
os.environ['INI_FILE_NAME'] = str(root / 'examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini')
sys.path.insert(0, str(folder))

# Hash, parse and compile the SAME bytes. No exec of the reference code.
sources = {name: (folder / (name + '.py')).read_bytes() for name in names}
hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in sources.items()}
trees = {name: ast.parse(raw) for name, raw in sources.items()}
definitions = {name: {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
               for name, tree in trees.items()}
reference = {}
origins = {}
for name in names:
    code = compile(sources[name], str(folder / (name + '.py')), 'exec',
                   dont_inherit=True, optimize=sys.flags.optimize)
    reference[name] = {c.co_name: c for c in code.co_consts if isinstance(c, types.CodeType)}
    origins[name] = {n: (name, n) for n in definitions[name]}
    for node in trees[name].body:
        if isinstance(node, ast.ImportFrom) and node.module in names:
            for alias in node.names:
                if alias.name in definitions[node.module]:
                    origins[name][alias.asname or alias.name] = (node.module, alias.name)

calls = {}
for module, functions in definitions.items():
    for name, node in functions.items():
        calls[module, name] = sorted({n.func.id for n in ast.walk(node)
                                     if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                                     and n.func.id in origins[module]})

rm = importlib.import_module('remap')
loaded = {name: sys.modules[name] for name in names}

def check(entry):
    errors, checked = [], set()
    for name in names:
        actual_path = Path(loaded[name].__file__)
        if hashlib.sha256(actual_path.read_bytes()).hexdigest() != hashes[name]:
            errors.append('file hash: ' + name)

    def visit(function, module, name, edge):
        expected = reference[module][name]
        if not isinstance(function, types.FunctionType):
            errors.append(edge + ': not a function')
            return
        if function.__code__ != expected:
            errors.append(edge + ': wrong code object (' + function.__code__.co_name + ')')
            return
        if Path(function.__code__.co_filename).resolve() != Path(loaded[module].__file__).resolve():
            errors.append(edge + ': wrong source file')
            return
        # At EACH graph node, follow the namespace actually used by that
        # function. The module owns it; a similarly named module attribute
        # in some other dict does not bind the callee's own helper calls.
        if function.__globals__ is not vars(loaded[module]):
            errors.append(edge + ': wrong globals')
            return
        if (module, name) in checked:
            return
        checked.add((module, name))
        for called in calls[module, name]:
            target_module, target_name = origins[module][called]
            visit(function.__globals__.get(called), target_module, target_name,
                  module + '.' + name + ' -> ' + called)

    visit(getattr(rm, entry), 'remap', entry, 'remap.' + entry)
    return {'accepted': not errors, 'errors': errors,
            'checked_definitions': sorted(m + '.' + n for m, n in checked)}

entries = ('g682', 'g684', 'g69_core', 'g683', 'g53x_core', 'twp_touchoff')
positive = {name: check(name) for name in entries}
assert all(r['accepted'] for r in positive.values())

def mutation(module, name, replacement, entry):
    old = getattr(module, name)
    setattr(module, name, replacement)
    try:
        result = check(entry)
        assert not result['accepted'], (name, result)
        return result
    finally:
        setattr(module, name, old)

negative = {
    'R130_entry_alias': mutation(rm, 'g682', rm.g683, 'g682'),
    'R130_same_module_helper_alias': mutation(
        rm, 'get_current_work_offset', rm.get_current_rotary_positions, 'g684'),
    'imported_helper_alias': mutation(
        rm, '_active_fixture_index', loaded['twp_params'].fixture_base, 'g683'),
    'binding_inside_helper_module': mutation(
        loaded['twp_transform'], '_rot_x', loaded['twp_transform'].to_table_frame_vector, 'g683'),
}
restored = {name: check(name)['accepted'] for name in entries}
assert all(restored.values())
print(json.dumps({'scope': 'Plan Fassung 7; not a product acceptance test',
                  'hashes': hashes, 'positive': positive, 'negative': negative,
                  'restored': restored, 'assertions': 'PASS'}, indent=2))
