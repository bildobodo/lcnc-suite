#!/usr/bin/env python3
"""R336: abstract lifetime counterexample for the proposed profile cleanup.

Not a product/browser test. Reads pinned git objects only. No live services.
python3 <this file> --repo <repo> > /tmp/r336.json
"""
import argparse
import hashlib
import json
import subprocess

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='/home/cnc/lcnc-suite')
args = ap.parse_args()

def git(*args_):
    return subprocess.check_output(['git', '-C', args.repo, *args_])

rev = git('rev-parse', 'a00c51ad').decode().strip()

def source(path, needle, after=10):
    raw = git('show', f'{rev}:{path}')
    lines = raw.decode().splitlines()
    hits = [i for i, line in enumerate(lines) if needle in line]
    assert len(hits) == 1, (path, needle, hits)
    i = hits[0]
    return {'file': path, 'line': i+1, 'sha256': hashlib.sha256(raw).hexdigest(),
            'text': '\n'.join(lines[i:i+after+1])}

def short_visit(promote_on_save=False):
    defaults = {'name': '', 'simulation': False, 'display': {'theme': 'auto'}}
    profile = {'id': 'public-A', 'token_hash': 'hash-A', 'stable': False,
               'sections': defaults.copy()}
    events = [{'t': 0, 'action': 'first connection; provisional profile', 'id': profile['id']}]
    saved = {'name': 'Panel', 'simulation': True, 'display': {'theme': 'dark'}}
    profile['sections'] = saved.copy()
    if promote_on_save:
        profile['stable'] = True
    events.append({'t': 10, 'action': 'own save admitted and acknowledged',
                   'stable': profile['stable'], 'saved': saved.copy()})
    # Only one connection, bound for 20 s, therefore neither of the plan's
    # two permanence conditions (60 s bound or second connection) was met.
    events.append({'t': 20, 'action': 'only tab closes; localStorage keeps token A'})
    if not profile['stable']:
        profile = None
    events.append({'t': 81, 'action': 'offline grace passed; cleanup',
                   'profile_present': profile is not None})
    if profile is None:
        profile = {'id': 'public-B', 'token_hash': 'hash-A', 'stable': False,
                   'sections': defaults.copy()}
    events.append({'t': 120, 'action': 'reopen with unchanged token A',
                   'id': profile['id'], 'sections': profile['sections']})
    return {'events': events, 'saved_settings_retained': profile['sections'] == saved,
            'same_public_id': profile['id'] == 'public-A'}

proposed = short_visit()
alternative = short_visit(promote_on_save=True)
assert not proposed['saved_settings_retained'] and not proposed['same_public_id']
assert alternative['saved_settings_retained'] and alternative['same_public_id']

out = {
    'round': 'R336', 'revision': rev,
    'kind': 'plan review / abstract lifetime model, not implementation execution',
    'product_files_changed_since_R335': git('diff', '--name-only', 'c41091e6', rev,
                                          '--', ':!docs/reviews/**').decode().splitlines(),
    'live_services_contacted': False, 'product_or_browser_tests_run': False,
    'plan_cleanup': source('docs/reviews/settings-split.review.md',
                          '4. **Server:** Ein beim ersten Kontakt angelegtes Profil', 2),
    'plan_as_written': proposed,
    'possible_correction_model_promote_on_first_save': alternative,
    'source_checks': {
        'surface_inputs': source('subroutines/surfacemap/surface_scan.ngc',
                                 '#<x0> = #3050', 17),
        'toolsetter_inputs': source('lcnc-webui/src/toolsetterSetup.ts',
                                   'export function toolsetterVarMap(', 13),
        'sim_trip_admission_today': source('lcnc-gateway/gateway.py',
                                         'if cmd == "simulate_probe_trip":', 9),
        'sim_trip_ui_today': source('lcnc-webui/src/App.vue',
                                   'const isDev = import.meta.env.DEV;', 0),
    },
}
print(json.dumps(out, ensure_ascii=False, indent=2))
