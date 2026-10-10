#!/usr/bin/env python3
"""R130: reproduce the three proposed binding checks, without LinuxCNC/HAL.

Usage: VENV/bin/python audit.py ARCHIVE_ROOT
Needs numpy, as does the shipped remap. Native modules are replaced BEFORE
import by inert modules. No remap function is run; the proof concerns the
identity of the callable selected by the plan, not a native machine run.
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
sys.dont_write_bytecode = True
folder = root / 'examples/sim_config/twp/python'
names = ('remap', 'twp_params', 'twp_prov', 'twp_transform', 'util')
expected = {name: hashlib.sha256((folder / (name + '.py')).read_bytes()).hexdigest()
            for name in names}
for name in ('interpreter', 'emccanon', 'hal'):
    assert name not in sys.modules
    sys.modules[name] = types.ModuleType(name)
os.environ['INI_FILE_NAME'] = str(root / 'examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini')
sys.path.insert(0, str(folder))
rm = importlib.import_module('remap')

def hashed(name):
    mod = sys.modules.get(name)
    path = getattr(mod, '__file__', None)
    return bool(path) and hashlib.sha256(Path(path).read_bytes()).hexdigest() == expected[name]

def plan_binding(name):
    # EXACT scope of the proposed E4a conditions 1-3, not product code.
    module = sys.modules['remap']
    obj = getattr(module, name, None)
    code = getattr(obj, '__code__', None)
    same_file = bool(code) and Path(code.co_filename).resolve() == Path(module.__file__).resolve()
    return {'exists_and_same_file': same_file,
            'remap_file_hash_matches': hashed('remap'),
            'helper_file_hashes_match': all(hashed(n) for n in names if n != 'remap')}

read_masks = {'g682': '', 'g684': '', 'g69_core': '', 'g683': 'ABC',
              'g53x_core': 'ABC', 'twp_touchoff': 'XYZABC'}
before = {n: plan_binding(n) for n in read_masks}
assert all(all(r.values()) for r in before.values())

# A TOPLEVEL loader can do this immediately after `import remap`. No code
# object is forged; no source file, helper module or file hash is changed.
rm.g682 = rm.g683
alias_checks = plan_binding('g682')
assert all(alias_checks.values())
assert rm.g682 is rm.g683
alias = {'binding_under_test': 'remap.g682',
         'loader_statement': 'remap.g682 = remap.g683',
         'actual_code_name': rm.g682.__code__.co_name,
         'actual_code_firstlineno': rm.g682.__code__.co_firstlineno,
         'expected_mask_for_g682': read_masks['g682'],
         'mask_for_the_actual_g683_body': read_masks[rm.g682.__code__.co_name],
         'plan_conditions': alias_checks}

# A second ordinary assignment changes a same-module helper behind a
# correctly named entry point. co_name checks alone would not catch this.
original = rm.get_current_work_offset
rm.get_current_work_offset = rm.get_current_rotary_positions
helper_checks = plan_binding('g684')
assert all(helper_checks.values())
assert rm.g684.__globals__['get_current_work_offset'] is rm.get_current_rotary_positions
tree = ast.parse((folder / 'remap.py').read_text())
fns = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
           and n.func.id == 'get_current_work_offset' for n in ast.walk(fns['g684']))
helper = {'loader_statement': 'remap.get_current_work_offset = remap.get_current_rotary_positions',
          'entry_point_code_name_unchanged': rm.g684.__code__.co_name == 'g684',
          'called_helper_code_name': rm.g684.__globals__['get_current_work_offset'].__code__.co_name,
          'original_helper_code_name': original.__code__.co_name,
          'plan_conditions': helper_checks,
          'scope': 'identity/call-graph mismatch only; changed helper return type not executed'}

# A small contract table for VP129-01. This is a model of the written
# foreign/inline rule, not the unmerged implementation.
def foreign_rotary_read_global_unknown(tcp):
    n = len(tcp.split())
    return bool(n) and (n not in (3, 6, 9) or n >= 6)
rotary = {label: foreign_rotary_read_global_unknown(tcp) for label, tcp in
          [('absent', ''), ('XYZ', '0 20 30'), ('XYZABC', '0 20 30 0 0 0'),
           ('XYZABCUVW', '0 20 30 0 0 0 0 0 0'), ('malformed_count', '0 20')]}
assert rotary == {'absent': False, 'XYZ': False, 'XYZABC': True,
                  'XYZABCUVW': True, 'malformed_count': True}

print(json.dumps({'scope': 'plan checks reproduced in Python, not native or product tests',
                  'source_hashes': expected, 'unmodified_positive_controls': before,
                  'same_module_function_alias': alias,
                  'same_module_helper_alias': helper,
                  'VP129_01_contract_model': rotary,
                  'assertions': 'PASS'}, indent=2))
