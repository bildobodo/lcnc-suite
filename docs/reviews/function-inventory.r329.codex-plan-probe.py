#!/usr/bin/env python3
"""R329: pure counterexamples for Paket I. No controller or live-file access.
Run with --root pointing to the a61337c3 archive.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ap = argparse.ArgumentParser()
ap.add_argument('--root', type=Path, required=True)
args = ap.parse_args()
root = args.root.resolve()
sys.path[:0] = [str(root / 'scripts'), str(root / 'lcnc-gateway')]
from gateway_util import evaluate_safety_chain
from test_support.system_host import _hash_tree, SystemHost
import lcnc_paths

out = {'root': str(root), 'head': 'a61337c3', 'checks': []}
reason = evaluate_safety_chain(grace_expired=True, watchdog_connected=True,
                              reader_fresh=False, trip_latched_present=False)
out['checks'].append({'name': 'absent_safety_banner_is_not_positive_proof',
                     'reader_fresh': False, 'trip_latched_present': False,
                     'safety_chain_reason': reason, 'counterexample': reason is None})

with tempfile.TemporaryDirectory(prefix='r329-pure-') as td:
    d = Path(td)
    links = d / 'links'
    links.mkdir()
    a, b = d / 'launcher-a', d / 'launcher-b'
    a.write_text('original launcher\n')
    b.write_text('different launcher\n')
    link = links / 'lcnc-suite'
    link.symlink_to(a)
    before = _hash_tree(links)
    link.unlink()
    link.symlink_to(b)
    after = _hash_tree(links)
    out['checks'].append({'name': 'existing_hash_ignores_changed_launcher_symlink',
                         'hash_before': before, 'hash_after': after,
                         'counterexample': before == after})
    previous = {k: os.environ.get(k) for k in ('HOME', 'LCNC_LOG_DIR')}
    try:
        os.environ['HOME'] = str(d / 'isolated-home')
        os.environ['LCNC_LOG_DIR'] = str(d / 'operator-logs-outside-home')
        requested = lcnc_paths._requested()  # no mkdir/write
        out['checks'].append({'name': 'new_home_does_not_override_inherited_log_target',
                             'requested': requested,
                             'counterexample': not Path(requested).is_relative_to(Path(os.environ['HOME']))})
    finally:
        for k, v in previous.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    r = subprocess.run([sys.executable, '-B', str(root / 'scripts/config_sync_check.py'),
                        '--repo', str(root / 'examples/sim_config'),
                        '--deployed', str(d / 'absent-config')], text=True, capture_output=True)
    out['checks'].append({'name': 'absent_deployment_is_reported_clean_by_current_checker',
                         'returncode': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr,
                         'counterexample': r.returncode == 0})
    r = subprocess.run([sys.executable, '-B', str(root / 'scripts/config_sync_check.py'),
                        '--repo', str(d / 'absent-templates'),
                        '--deployed', str(d / 'absent-config')], text=True, capture_output=True)
    out['checks'].append({'name': 'checker_error_is_not_local_upgrade_drift',
                         'returncode': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr,
                         'counterexample': r.returncode == 2})
    source, clone = d / 'git-source', d / 'git-clone'
    subprocess.run(['git', 'init', '-q', str(source)], check=True, capture_output=True)
    subprocess.run(['git', 'clone', '--no-hardlinks', str(source), str(clone)], check=True, capture_output=True)
    refused = None
    try:
        SystemHost().remove_tree(clone, source)
    except RuntimeError as e:
        refused = str(e)
    out['checks'].append({'name': 'native_cleanup_does_not_remove_an_independent_clone',
                         'error': refused, 'clone_still_exists': clone.exists(),
                         'counterexample': refused is not None and clone.exists()})
assert all(c['counterexample'] for c in out['checks']), out
print(json.dumps(out, indent=2))
