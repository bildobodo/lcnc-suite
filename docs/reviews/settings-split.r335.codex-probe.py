#!/usr/bin/env python3
"""R335 plan evidence: pinned sources and a storage interleaving model.

No product imports, services, or browser execution. The model enumerates
the proposed check-empty / write / read sequence, not an implementation.
Run from any directory: python3 <this file> --repo <repo> > /tmp/r335.json
"""
import argparse
import hashlib
import itertools
import json
import subprocess

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='/home/cnc/lcnc-suite')
args = ap.parse_args()

def git(*argv):
    return subprocess.check_output(['git', '-C', args.repo, *argv])

rev = git('rev-parse', 'c41091e6').decode().strip()

def source(path, needle, before=0, after=12):
    raw = git('show', f'{rev}:{path}')
    lines = raw.decode().splitlines()
    hits = [i for i, line in enumerate(lines) if needle in line]
    assert len(hits) == 1, (path, needle, hits)
    i = hits[0]
    start, end = max(0, i-before), min(len(lines), i+after+1)
    return {'path': path, 'line': i+1, 'start': start+1,
            'sha256': hashlib.sha256(raw).hexdigest(),
            'text': '\n'.join(lines[start:end])}

sources = {
    'toolsetter_uses_shared_write': source('lcnc-webui/src/ToolsetterSettings.vue',
        'async function pushWhenConfirmed()', after=14),
    'surface_uses_probe_values': source('lcnc-webui/src/ProbePanel.vue',
        'function runSurfaceScan()', after=6),
    'shared_write_handler': source('lcnc-gateway/gateway.py',
        'if cmd == "set_probe_vars":', after=7),
    'unload_both_modes': source('lcnc-webui/src/App.vue',
        'function unloadTool()', after=13),
    'load_both_modes': source('lcnc-webui/src/ToolTablePanel.vue',
        'function requestToolChange(toolNum: number)', after=14),
    'sim_trip_outside_probe_tab': source('lcnc-webui/src/App.vue',
        '<MachineBtn v-if="isDev" type="simTrip"', before=5, after=2),
    'generic_mdi_shape': source('lcnc-webui/src/App.vue',
        'const reply = await request({ cmd: "mdi", text: line, vars }, 15000);', before=3, after=6),
}

inventory = json.loads(git('show', f'{rev}:scripts/inventory/functions.json'))
functions = [{'id': f['id'], 'atoms': f['atoms']} for f in inventory['functions']
             if f['id'] in {'F-SIMTRIP', 'F-PROBE', 'F-TOOLMEASURE', 'F-TOOLSETTER'}]

def model(order):
    stored = None
    steps = {'A': 0, 'B': 0}
    may_write, adopted, events = {}, {}, []
    for who in order:
        step = steps[who]
        if step == 0:
            may_write[who] = stored is None
            action = 'check empty'
        elif step == 1:
            if may_write[who]:
                stored = f'token-{who}'
            action = 'write if previously empty'
        else:
            adopted[who] = stored
            action = 'read and bind'
        events.append({'tab': who, 'action': action, 'stored': stored,
                       'adopted': dict(adopted)})
        steps[who] += 1
    return {'order': ''.join(order), 'events': events,
            'adopted': adopted, 'different_profiles': adopted['A'] != adopted['B']}

cases = []
for positions in itertools.combinations(range(6), 3):
    cases.append(model(['A' if i in positions else 'B' for i in range(6)]))
bad = [c for c in cases if c['different_profiles']]
assert bad, 'The stated algorithm should expose a counterexample'
chosen = next(c for c in bad if c['order'] == 'ABAABB')

out = {
    'round': 'R335', 'revision': rev,
    'scope': 'plan review, source inspection plus deterministic abstract model',
    'product_files_changed_since_R334': git('diff', '--name-only', '0dba29f6', rev,
                                          '--', ':!docs/reviews/**').decode().splitlines(),
    'live_services_contacted': False, 'product_or_browser_tests_run': False,
    'source_facts': sources, 'current_inventory_ownership': functions,
    'registration_model': {'schedules': len(cases), 'divergent': len(bad),
                           'counterexample': chosen,
                           'all_outcomes': [{k: c[k] for k in ('order', 'adopted', 'different_profiles')}
                                            for c in cases]},
    'reference': {'url': 'https://html.spec.whatwg.org/multipage/webstorage.html#introduction',
                  'checked': '2026-11-07',
                  'supports': 'Do not assume a locking mechanism across browser agent clusters.'},
}
print(json.dumps(out, ensure_ascii=False, indent=2))
