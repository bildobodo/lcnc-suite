"""R411: evaluate recorded geometry; a failed claim is a plan finding.
Usage: python3 analyse.py <samples.jsonl> <focus.jsonl>
No servers and no machine access.
"""
import json
import sys
from pathlib import Path
rows = [json.loads(s) for s in Path(sys.argv[1]).read_text().splitlines()]
focus = [json.loads(s) for s in Path(sys.argv[2]).read_text().splitlines()]
findings = []
for row in rows:
    for s in row['samples']:
        if s['visible'] and not s['stop']['whole']:
            findings.append({'claim': 'visible jog has whole Stop', 'case': row['name'],
                'browser': row['project'], 'at': s['at'], 'scroll': s['scroll'],
                'leftEdge': s['left'], 'stop': s['stop'], 'visibleJog': s['visible']})
    if row['name'].endswith('F3'):
        start, end = row['samples'][0], row['samples'][-1]
        if abs(start['right'] - end['right']) > 1:
            findings.append({'claim': 'F3 fixed right group', 'case': row['name'],
                'browser': row['project'], 'boundaryStart': start['right'], 'boundaryEnd': end['right'],
                'middleStart': start['middle'], 'middleEnd': end['middle'], 'jogWidth': start['jogWidth']})
        if not end['spindleFwd']['whole']:
            findings.append({'claim': 'focused Spindle Fwd wholly reachable', 'case': row['name'],
                'browser': row['project'], 'scroll':end['scroll'],'max':end['max'],**end['spindleFwd']})
for r in focus:
    if r['before']['tag']=='BUTTON' and r['after']['tag']=='BODY':
        findings.append({'claim':'focus survives F0 -> F1', **r})
print(json.dumps({'recordedCases':len(rows),'focusCases':len(focus),'violations':findings},indent=2,ensure_ascii=False))
assert any(x['claim']=='visible jog has whole Stop' and x['browser']=='firefox-core' for x in findings)
assert any(x['claim']=='visible jog has whole Stop' and x['browser']=='e2e' for x in findings)
assert any(x['claim']=='focused Spindle Fwd wholly reachable' for x in findings)
assert sum(x['claim']=='focus survives F0 -> F1' for x in findings)==2
