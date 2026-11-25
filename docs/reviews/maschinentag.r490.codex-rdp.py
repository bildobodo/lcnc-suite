"""Pure arithmetic from fd1878e0, compiled without importing its worker."""
import ast
import json
import math
import sys
from pathlib import Path
from typing import List
import numpy as np
root = Path(sys.argv[1])
source = root/'lcnc-gateway/gcode_parse_worker.py'
tree = ast.parse(source.read_text())
names = {'_rdp_keep', '_turning_points', '_course_splits'}
module = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
ns = {'np': np, 'math': math, 'List': List}
exec(compile(module, str(source), 'exec'), ns)
points = np.array([[0.,0.,2.],[2**-9,0.,-2.],[0.,0.,-6.]])
assert np.array_equal(points, points.astype(np.float32).astype(float))
print('Signature:', __import__('inspect').signature(ns['_rdp_keep']))
kept = ns['_rdp_keep'](points, [], .005**2)
assert kept == [0, 2]
timed = ns['_rdp_keep'](points, [], .005**2, np.array([0., 1., 2.]))
assert timed == [0, 2]
print(json.dumps({'points':points.tolist(),'kept':kept,'kept_with_times_0_1_2':timed,'max_lateral':2**-9,'f32_error':0,'note':'no reversal; course and half-time position both within 0.005 mm'},indent=2))
