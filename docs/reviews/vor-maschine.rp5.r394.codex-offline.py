#!/usr/bin/env python3
"""R394: synthetic corruptions through the real integrated replay checker."""
import argparse
import json
import sys
import tempfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--root', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
sys.path.insert(0, str(a.root / 'scripts/test_select'))
import test_replay as w
import replay

results = {}
for case in ('control', 'foreign_worker_request', 'foreign_worker_action', 'foreign_worker_end',
             'foreign_worker_closing', 'dangling_redirect', 'foreign_context_redirect',
             'unopened_fetch_completion', 'duplicate_end'):
    with tempfile.TemporaryDirectory(prefix='r394-record-') as tmp:
        d = Path(tmp)
        m = w.Mock()
        m.page(w.A)
        for line in m.lines:
            if line['kind'] == 'http':
                line.update(req_id='req:0.1', served='handler', qkeys=[])
        other = w.Mock('m2')
        rd, ev = w.write(d, [m, other], [w.attempt(w.A)])
        es = [json.loads(x) for x in ev.read_text().splitlines()]
        for e in es:
            if e['event'] == 'bound':
                e.update(workerIndex=0 if e['instance'] == 'm1' else 1,
                         port=4500 if e['instance'] == 'm1' else 4501)
        ev.write_text(''.join(json.dumps(e) + '\n' for e in es))
        req = {'k': 'req', 'id': '0.1', 'ctx': '0.c1', 'at': 'request', 'method': 'GET',
               'host': 'localhost:4500', 'path': '/', 'qkeys': [], 'type': 'document',
               'sw': False, 'from': None, 'route': None, 'variant': None}
        lines = [{'k': 'ctx', 'ctx': '0.c1', 'how': 'fixture', **w.origin(w.A)}, req,
                 {'k': 'act', 'id': '0.1', 'act': 'catch-all'},
                 {'k': 'end', 'id': '0.1', 'transport': 'finished', 'status': 200},
                 {'k': 'closing', 'ctx': '0.c1', 'sw': 0}]
        other_lines = []
        if case.startswith('foreign_worker_'):
            k = {'request': 'req', 'action': 'act', 'end': 'end', 'closing': 'closing'}[case.removeprefix('foreign_worker_')]
            moved = next(x for x in lines if x['k'] == k)
            lines.remove(moved)
            other_lines.append(moved)
        if case == 'dangling_redirect':
            req['from'] = '0.999'
        if case == 'foreign_context_redirect':
            req['from'] = '0.2'
            lines += [{'k': 'ctx', 'ctx': '0.c2', 'how': 'new', **w.origin(w.A)},
                      {**req, 'id': '0.2', 'ctx': '0.c2', 'from': None},
                      {'k': 'act', 'id': '0.2', 'act': 'fulfill', 'status': 302},
                      {'k': 'end', 'id': '0.2', 'transport': 'finished', 'status': 302},
                      {'k': 'closing', 'ctx': '0.c2', 'sw': 0}]
        if case == 'unopened_fetch_completion':
            lines.append({'k': 'fetched', 'id': '0.1', 'op': '0.f999', 'status': 200})
        if case == 'duplicate_end':
            lines.append({'k': 'end', 'id': '0.1', 'transport': 'failed', 'error': 'invented'})
        hd = d / 'http'
        hd.mkdir()
        for worker, rows in [(0, lines), (1, other_lines)]:
            (hd / f'{w.RUN}-w{worker}.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in rows))
        r = replay.check(rd, ev, w.RUN, [], http_dir=hd, http_expect=[])
        results[case] = {'verdict': r['verdict'], 'findings': r['findings'], 'http_paths': r['http_paths']}
        print(case, r['verdict'], r['http_paths']['classes'], r['findings'])
a.out.write_text(json.dumps({'head': '964a6396', 'cases': results}, indent=2) + '\n')
