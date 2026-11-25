"""Only TestTheChord, with unchanged worker AST functions in a module.
Does not import the worker or its native bindings, nor run native fixtures.
"""
import ast
import importlib.util
import math
from pathlib import Path
import sys
import types
from typing import List
import unittest
import numpy as np

root=Path(__file__).resolve().parent/'tree/lcnc-gateway'
source=root/'gcode_parse_worker.py'
worker=types.ModuleType('gcode_parse_worker')
worker.__dict__.update(np=np,math=math,List=List)
node=ast.parse(source.read_text())
mod=ast.Module(body=[n for n in node.body if isinstance(n,ast.FunctionDef) and n.name in {'_turning_points','_rdp_keep','_course_splits'}],type_ignores=[])
exec(compile(mod,str(source),'exec'),worker.__dict__)
sys.modules['gcode_parse_worker']=worker
spec=importlib.util.spec_from_file_location('r493_authored',root/'test_path_kinds_worker.py')
tests=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
suite=unittest.defaultTestLoader.loadTestsFromTestCase(tests.TestTheChord)
out=unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not out.wasSuccessful())
