#!/usr/bin/env python3
"""R389: read-only contract evidence; run against an archive of cd23f813.

No browser, server, machine or live-script import. The optional executable
part calls the existing pure offline replay checker with synthetic logs.
"""
import argparse
import ast
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, required=True)
    ap.add_argument('--review-root', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    source = a.root / 'scripts/inventory/functions.json'
    inventory = json.loads(source.read_text())
    evidence = [dict(function=f['id'], statement=s['id'], **e)
                for f in inventory['functions'] for s in f.get('statements', [])
                for e in s.get('evidence', [])]
    scripts = [e for e in evidence if e['layer'] == 'script']
    files = {}
    for name in sorted({e['file'] for e in scripts}):
        path = a.root / 'scripts' / name
        text = path.read_text()
        tree = ast.parse(text)
        direct_calls = [n.value for n in tree.body
                        if isinstance(n, (ast.Assign, ast.AnnAssign, ast.Expr))
                        and isinstance(n.value, ast.Call)]
        files[name] = {
            'sha256': digest(path),
            'test_functions': [n.name for n in ast.walk(tree)
                               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                               and n.name.startswith('test_')],
            'test_classes': [n.name for n in ast.walk(tree)
                            if isinstance(n, ast.ClassDef) and n.name.startswith('Test')],
            'module_level_controller_calls': [dict(line=n.lineno, call=ast.unparse(n))
                for n in direct_calls if ast.unparse(n.func).startswith('linuxcnc.')],
            'module_level_require_ready': [n.lineno for n in direct_calls
                                           if ast.unparse(n.func) == 'require_ready'],
        }
        for e in scripts:
            if e['file'] == name:
                e['source_lines'] = [i for i, line in enumerate(text.splitlines(), 1)
                                     if e['title'] in line]
    prior = a.review_root / 'docs/reviews/function-inventory.r268.codex-probe.json'
    redirect = next(c for c in json.loads(prior.read_text())['cases'] if c['mode'] == 'synthetic')
    # Import only the pure checker and its synthetic-log helper, never the
    # live scripts inspected above. Their top-level code is not collection-safe.
    test_file = a.root / 'scripts/test_select/test_replay.py'
    spec = importlib.util.spec_from_file_location('r389_replay_helpers', test_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    replay_cases = {}
    for name, payloads in {
        'valid_only': [{'axes': {'X': 1.0}}],
        'expected_invalid_only': [{'axes': {'Q': 1.0}}],
        'valid_and_expected_invalid': [{'axes': {'X': 1.0}}, {'axes': {'Q': 1.0}}],
    }.items():
        with tempfile.TemporaryDirectory(prefix='r389-offline-') as tmp:
            mock = module.Mock()
            conn = mock.page(module.A)
            for payload in payloads:
                mock.frame(conn, {'cmd': 'touchoff', **payload})
            result = module.run(Path(tmp), [mock], [module.attempt(module.A)],
                                refusals=[module.EXPECT] if 'invalid' in name else [])
            replay_cases[name] = {k: result[k] for k in ('verdict', 'per_attempt', 'expected', 'findings')}
            replay_cases[name]['input_log_kinds'] = dict(Counter(x['kind'] for x in mock.lines))
            replay_cases[name]['gateway_reply_recorded'] = False
            assert result['verdict'] == 'PASS', result['findings']
    report = {
        'review': 'R389', 'product_commit': 'cd23f813',
        'document_commit': '1ce58d2a',
        'scope': 'Plan review; static source inspection plus synthetic offline replay cases',
        'not_run': ['live scripts', 'browser suite', 'product builds', 'machine commands'],
        'inventory_sha256': digest(source),
        'evidence_counts': dict(Counter(e['layer'] for e in evidence)),
        'script_evidence_count': len(scripts),
        'all_script_evidence_live': all(e.get('live') is True for e in scripts),
        'script_evidence': scripts, 'script_files': files,
        'redirect_source': {'file': str(prior.relative_to(a.review_root)), 'sha256': digest(prior),
                            'rerun_here': False, 'case': redirect},
        'offline_replay_source_sha256': digest(a.root / 'scripts/test_select/replay.py'),
        'offline_replay_cases': replay_cases,
    }
    verified = []
    for relative in ['scripts/inventory/functions.json', 'scripts/test_select/replay.py',
                     'scripts/test_select/test_replay.py',
                     *['scripts/' + name for name in files]]:
        committed = subprocess.check_output(['git', '-C', str(a.review_root), 'show',
                                             'cd23f813:' + relative])
        assert committed == (a.root / relative).read_bytes(), relative
        verified.append(relative)
    report['archive_sources_verified_against_cd23f813'] = verified
    a.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'script_evidence': len(scripts), 'files': len(files),
                      'all_live': report['all_script_evidence_live'],
                      'synthetic_redirect_server_ids': [x['id'] for x in redirect['server']],
                      'offline_cases': {k: v['verdict'] for k, v in replay_cases.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
