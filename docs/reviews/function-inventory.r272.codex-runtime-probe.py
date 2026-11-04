"""Review only: temporarily add a used .tsx source in an isolated /tmp tree."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
assert root.is_relative_to('/tmp')
sys.path.insert(0, str(root / 'scripts'))
from test_select import graph, rules, test_selector as ts

src = root / 'lcnc-webui/src'
main = src / 'main.ts'
original = main.read_bytes()
out = []
for extension in ['ts', 'tsx']:
    name = f'inventory/r272Runtime.{extension}'
    target = src / name
    assert not target.exists()
    try:
        target.write_text('export const runtimeValue = 1;\n')
        main.write_bytes(f'import {{ runtimeValue }} from "./{name}";\nconsole.log(runtimeValue);\n'.encode() + original)
        rev, _ = graph.importers(src)
        reached = graph.reached_from(list(rules.RUNTIME_ENTRIES), rev, graph.spawns(src))
        try:
            ts.test_test_only_modules_are_reached_by_no_runtime_entry()
            verdict = 'PASS'
        except AssertionError:
            verdict = 'FAIL'
        decision = rules.decide('lcnc-webui/src/' + name)
        out.append({'source': name, 'reached': reached.get(name), 'source_scanned': name in graph.sources(src),
                    'runtime_guard': verdict, 'parser_disagreements': graph.pattern_disagreements(src),
                    'ordinary_graph_problems': ts.graph_problems(),
                    'selection': {'browser': sorted(decision.browser), 'browser_full': decision.browser_full,
                                  'unmatched': decision.unmatched}})
    finally:
        main.write_bytes(original)
        target.unlink(missing_ok=True)
print(json.dumps({'cases': out, 'restored': main.read_bytes() == original}, indent=2))
assert out[0]['runtime_guard'] == 'FAIL', 'sensitivity: ordinary .ts must be refused'
assert all(c['runtime_guard'] == 'FAIL' or c['parser_disagreements'] for c in out), 'a runtime source escaped both guards'
