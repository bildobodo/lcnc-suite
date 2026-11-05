#!/usr/bin/env python3
"""R310: read-only source/recording audit and explicit plan countermodels.
No production evaluator exists for this plan yet. No machine access.
Usage: python3 -B SCRIPT ARCHIVE LIVE_TIER_PARENT [PREVIOUS_REVIEW_DIR]
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import sys

root, parent = map(Path, sys.argv[1:3])
routine = root / 'subroutines/tool_length_probe/tool_touch_off.ngc'
wrapper = root / 'subroutines/tool_length_probe/m600.ngc'
digest = hashlib.sha256(routine.read_bytes()).hexdigest()
assert digest == '4990c7b303cb43bf0aa8cb11948277072874558f5902d3c48a59133ec555097d'


def motion_rows(path):
    # Only this hash-bound literal source is being audited: no claim to be
    # a general G-code parser or to resolve arbitrary modal motion.
    out = []
    for i, raw in enumerate(path.read_text().splitlines(), 1):
        code = re.sub(r'\([^)]*\)', '', raw.split(';')[0]).strip()
        if re.search(r'\bG(?:0?[0123]|38\.[2345])\b', code, re.I):
            out.append({'line': i, 'code': code})
    return out


r_rows = motion_rows(routine)
R = {r['line'] for r in r_rows}
assert len(R) == 28 and min(R) == 211 and max(R) == 601
assert not motion_rows(wrapper)
tree = ast.parse((root/'scripts/native_run.py').read_text())
node = next(n for n in tree.body if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == 'RFL_PROGRAM' for t in n.targets))
ns = {}
exec(compile(ast.Module(body=[node], type_ignores=[]), '<program literal>', 'exec'), ns)
old_program = ns['RFL_PROGRAM']
lines = old_program.splitlines()
assert len(lines) == 11 and lines[6] == 'G1 X200 F3000'
lines[6] = 'G61.1 G1 X200 F3000'
new_program = '\n'.join(lines) + '\n'
assert not R.intersection(range(1, len(lines)+1))

# Countermodel: R -> main line 6 in motion -> R again -> correct entry -> L.
# Both R and program numbers are disjoint. The late R cannot revoke the
# origin of the earlier program sample. The written global-last-R filter
# nevertheless omits it; literal first-program selection also leaves an
# empty entry interval and changes a known FAIL into incomplete.
stream = [
    {'n':0, 'line':308, 'pos':[10,10,0], 'vel':[1,1,0], 'inpos':False},
    {'n':1, 'line':6, 'pos':[10,10,-1], 'vel':[0,0,-1], 'inpos':False},
    {'n':2, 'line':587, 'pos':[10,10,-.5], 'vel':[0,0,1], 'inpos':False},
    {'n':3, 'line':601, 'pos':[0,0,0], 'vel':[-1,-1,0], 'inpos':False},
    *[{'n':n, 'line':0, 'pos':[100,100,0], 'vel':[0,0,0], 'inpos':True} for n in range(4,14)],
    {'n':14, 'line':7, 'pos':[100,100,0], 'vel':[1,0,0], 'inpos':False},
]
last_r = max(s['n'] for s in stream if s['line'] in R)
first_program = min(s['n'] for s in stream if 1 <= s['line'] <= 11)
known_early = [s for s in stream if 1 <= s['line'] < 7 and any(v != 0 for v in s['vel'])]
filtered_early = [s for s in known_early if s['n'] > last_r]
entry_window = [s for s in stream if last_r < s['n'] < first_program]
assert len(known_early) == 1 and filtered_early == [] and entry_window == []

# Apply the new first-block anchor to the unchanged R309 countermodel.
review_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent
previous = json.loads((review_dir/'function-inventory.r309.codex-audit.json').read_text())
trajectory = previous['rest_countermodel']['samples']
first_rest = next(i for i in range(len(trajectory)-9)
                  if all(s['v']==0 and abs(s['x']-trajectory[i]['x']) <= .001 and abs(s['x']-100) <= .010
                         for s in trajectory[i:i+10]))
violations = [s for s in trajectory[first_rest:] if s['v'] != 0 or abs(s['x']-trajectory[first_rest]['x']) > .001]
assert first_rest == 10 and len(violations) == 20

record = parent/'20261105T212704/servo-rfl.jsonl'
samples = [json.loads(s) for s in record.read_text().splitlines()]
last_i = max(i for i,s in enumerate(samples) if s[2][6] in R)
first_p = next(i for i,s in enumerate(samples) if 1 <= s[2][6] <= 11)
assert last_i < first_p
assert all(s[2][6] == 0 for s in samples[last_i+1:first_p])
out = {
    'kind':'Plan-only audit; countermodels are not executions of an unbuilt product evaluator',
    'routine_sha256':digest, 'wrapper_sha256':hashlib.sha256(wrapper.read_bytes()).hexdigest(),
    'motion_rows':r_rows, 'program_lines':len(lines), 'source_sets_disjoint':True,
    'old_program_sha256':hashlib.sha256(old_program.encode()).hexdigest(),
    'proposed_program_sha256':hashlib.sha256(new_program.encode()).hexdigest(),
    'proposed_program':new_program,
    'phase_countermodel':{'stream':stream, 'last_r_n':last_r, 'first_program_n':first_program,
        'known_early_program_samples':known_early, 'after_last_r_filter':filtered_early,
        'literal_entry_window':entry_window, 'required_verdict':'FAIL; a later R may not erase an earlier main-file motion'},
    'r309_rest_countermodel_under_new_anchor':{'anchor_n':trajectory[first_rest]['n'],
        'known_violations':len(violations),'model_verdict':'FAIL'},
    'recorded_g64_run':{'sha256':hashlib.sha256(record.read_bytes()).hexdigest(),
        'last_r':samples[last_i], 'first_zero_after_r':samples[last_i+1], 'first_program':samples[first_p],
        'all_between_zero':True,'remaining_xy_velocity_after_r':samples[last_i+1][2][3:5],
        'scope':'Positive structural check only; not a G61.1 acceptance run'},
    'result':'PASS: source checks and countermodel assertions hold'}
print(json.dumps(out,indent=2,ensure_ascii=False))
