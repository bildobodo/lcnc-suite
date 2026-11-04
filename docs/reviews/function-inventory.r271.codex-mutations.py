"""R271 review probes. Mutate only an isolated /tmp checkout, restore in finally."""
import copy
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp')
sys.path.insert(0, str(root / 'scripts'))
sys.path.insert(0, str(root / 'scripts/inventory'))
import functions as fn
from test_select import graph, rules, test_selector as ts

src = root / 'lcnc-webui/src'
main = src / 'main.ts'
original = main.read_bytes()
extra = src / 'inventory/r271Runtime.ts'
assert not extra.exists()

def inspect():
    rev, _ = graph.importers(src)
    reached = graph.reached_from(list(rules.RUNTIME_ENTRIES), rev, graph.spawns(src))
    try:
        ts.test_test_only_modules_are_reached_by_no_runtime_entry()
        guard = 'PASS'
    except AssertionError:
        guard = 'FAIL'
    return {'guard': guard, 'old_graph_problems': ts.graph_problems(),
            'known_target_reached': reached.get('controlInventory.ts'),
            'new_target_reached': reached.get('inventory/r271Runtime.ts')}

result = {'root': str(root), 'baseline': inspect(), 'mutations': []}
try:
    # Positive sensitivity: Claude's ordinary import mutation must turn red.
    main.write_bytes(b'import { LIVE_GATES } from "./controlInventory";\nconsole.log(LIVE_GATES);\n' + original)
    result['mutations'].append({'case': 'ordinary_import_known_target', **inspect()})
    main.write_bytes(b'import{LIVE_GATES}from"./controlInventory";\nconsole.log(LIVE_GATES);\n' + original)
    result['mutations'].append({'case': 'compact_import_known_target', **inspect()})
    extra.write_text('export const runtimeValue = 1;\n')
    main.write_bytes(b'import { runtimeValue } from "./inventory/r271Runtime";\nconsole.log(runtimeValue);\n' + original)
    d = rules.decide('lcnc-webui/src/inventory/r271Runtime.ts')
    result['mutations'].append({'case': 'ordinary_import_new_target_in_unit_only_glob', **inspect(),
        'target_selection': {'browser': sorted(d.browser), 'browser_full': d.browser_full, 'unmatched': d.unmatched, 'rules': d.rules}})
finally:
    main.write_bytes(original)
    extra.unlink(missing_ok=True)

loaded = fn.load(root)
result['baseline_inventory_problems'] = fn.problems(*loaded, root=root)
p = root / 'subroutines/probe_basic/probe_cal_round_boss.ngc'
data = p.read_bytes()
try:
    p.unlink()
    result['routine_removed_problems'] = fn.problems(*loaded, root=root)
finally:
    p.write_bytes(data)

changed = copy.deepcopy(loaded)
f = next(f for f in changed[2]['functions'] if f['id'] == 'F-PROBE')
del f['statements'][0]['applies']
result['applies_removed_problems'] = fn.problems(*changed, root=root)
changed = copy.deepcopy(loaded)
f = next(f for f in changed[2]['functions'] if f['id'] == 'F-PROBE')
del f['statements'][1]['evidence'][0]['instances']
result['instances_removed_problems'] = fn.problems(*changed, root=root)
result['restored'] = main.read_bytes() == original and p.read_bytes() == data and not extra.exists()
print(json.dumps(result, indent=2))
assert result['baseline']['guard'] == 'PASS'
assert result['mutations'][0]['guard'] == 'FAIL'
assert result['routine_removed_problems'] and result['applies_removed_problems'] and result['instances_removed_problems']
assert result['restored']
