#!/usr/bin/env python3
"""R393 counterexamples against the real HTTP judge and integrated replay.
Synthetic logs only; never imports or contacts a live gateway.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    sys.path.insert(0, str(a.root / 'scripts/test_select'))
    import test_http_paths as h
    import test_replay as w
    import replay

    results = {}

    def judge(name, rec, required, **kw):
        with tempfile.TemporaryDirectory(prefix='r393-http-') as tmp:
            r = rec.judge(Path(tmp), **kw)
        results[name] = {'required': required, 'actual': r}

    def route(rec, rid, value):
        next(x for x in rec.lines if x['k'] == 'req' and x['id'] == rid)['route'] = value
        return rec

    judge('direct_handler_control', h.served(h.Rec(), '1', '/devices', served='handler'), 'served, no findings')
    judge('direct_fallback_control', h.served(h.Rec(), '1', '/g30', served='fallback'), 'fallback, no findings')
    rec = h.Rec().req('1', '/g30').act('1', 'handler').act('1', 'fetch', op='f1')
    rec.contact('/g30', 'fetch:f1', served='fallback').act('1', 'fulfill', status=200).end('1')
    judge('fetched_fallback', route(rec, '1', 'GET /g30'), 'server fallback stays visible, never EVIDENCE fetched')
    rec = h.Rec().req('1', '/devices').act('1', 'handler').act('1', 'fetch', op='f1')
    rec.contact('/devices', 'fetch:f1').act('1', 'fulfill', status=200).end('1')
    rec.mock[0][1].update(closed=True, served=None, status=None)
    judge('fetched_closed_contact', route(rec, '1', 'GET /devices'), 'no served response; replacement alone is proven')
    rec = h.served(h.Rec(), '1', '/devices', served='handler')
    rec.mock[0][1].update(closed=True, served=None, status=None)
    judge('forwarded_closed_contact', rec, 'contact occurred but no server response completed; not before-contact abort')
    rec = h.Rec().req('1', '/r').act('1', 'catch-all').contact('/r', 'req:1', status=302)
    rec.end('1', status=302).req('2', '/target', frm='1').end('2', 'failed')
    judge('redirect_only_first_contact', rec, 'both hops unknown under the accepted multi-hop contract')
    rec = h.Rec().req('1', '/g30').act('1', 'handler').act('1', 'continue')
    rec.contact('/devices', 'req:1', served='handler').end('1')
    judge('rewritten_url', route(rec, '1', 'GET /g30'), 'GET /devices was served, not GET /g30')
    rec = h.served(h.Rec(), '1', '/devices', served='handler')
    rec.lines[0]['project'] = 'foreign-project'
    judge('foreign_context_project', rec, 'finding: context origin differs from attempt project')
    rec = h.Rec().act('lost', 'handler').act('lost', 'fulfill', status=200).end('lost')
    judge('orphan_actions_and_end', rec, 'finding: actions/end have no request')
    rec = h.served(h.Rec(), '1', '/devices', served='handler')
    rec.req('1', '/upload', method='POST').act('1', 'catch-all').end('1')
    rec.lines[-3]['route'] = 'POST /upload'
    judge('duplicate_request_id', rec, 'finding: repeated request ID must not overwrite first ownership/projection')
    rec = h.served(h.Rec(), '1', '/devices', served='handler')
    # R394 adaptation: the test builder now closes every context by default — this case must not be closed
    judge('no_context_close_mark', rec, 'completed run must account for the close/service-worker check of each context', close=False)

    # Integration: the existing WS/HTTP-origin check is valid throughout;
    # only the NEW browser record is damaged. These are not isolated-judge
    # failures already rejected by replay.check().
    for case in ('control', 'foreign_context_project', 'orphan_actions_and_end', 'foreign_worker_file'):
        with tempfile.TemporaryDirectory(prefix='r393-replay-') as tmp:
            p = Path(tmp)
            mock = w.Mock()
            mock.page(w.A)
            for line in mock.lines:
                if line['kind'] == 'http':
                    line.update(req_id='req:p', served='handler', qkeys=[])
            directory, events = w.write(p, [mock], [w.attempt(w.A)])
            # R394 adaptation: the real fixture writes each mock's workerIndex on its bound event
            ev = [json.loads(x) for x in Path(events).read_text().splitlines() if x.strip()]
            for x in ev:
                if x.get('event') == 'bound':
                    x['workerIndex'] = 0
            Path(events).write_text(''.join(json.dumps(x) + '\n' for x in ev))
            ctx = {'k': 'ctx', 'ctx': 'c1', 'how': 'fixture', **w.origin(w.A)}
            req = {'k': 'req', 'id': 'p', 'ctx': 'c1', 'at': 'request', 'method': 'GET',
                   'host': h.HOST, 'path': '/', 'qkeys': [], 'type': 'document', 'sw': False,
                   'from': None, 'route': None, 'variant': None}
            lines = [ctx, req, {'k': 'act', 'id': 'p', 'act': 'catch-all'},
                     {'k': 'end', 'id': 'p', 'transport': 'finished', 'status': 200},
                     {'k': 'closing', 'ctx': 'c1', 'sw': 0}]
            if case == 'foreign_context_project':
                ctx['project'] = 'foreign-project'
            if case == 'orphan_actions_and_end':
                lines += [{'k': 'act', 'id': 'lost', 'act': 'fulfill', 'status': 200},
                          {'k': 'end', 'id': 'lost', 'transport': 'finished', 'status': 200}]
            http = p / 'http'
            http.mkdir()
            (http / f'{w.RUN}-w0.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in lines))
            if case == 'foreign_worker_file':
                extra = [{'k': 'ctx', 'ctx': 'stray', 'how': 'new', 'run': 'foreign-run',
                          'test': 'stray', 'project': 'e2e', 'retry': 0},
                         {'k': 'req', **{k: v for k, v in req.items() if k != 'k'}, 'id': 'stray', 'ctx': 'stray'},
                         {'k': 'act', 'id': 'stray', 'act': 'fulfill', 'status': 200}]
                (http / f'{w.RUN}-w999.jsonl').write_text(''.join(json.dumps(x) + '\n' for x in extra))
            r = replay.check(directory, events, w.RUN, [], http_dir=http, http_expect=[])
            results['integrated_' + case] = {'verdict': r['verdict'], 'findings': r['findings'],
                                            'http_paths': r['http_paths']}
    a.out.write_text(json.dumps({'review': 'R393', 'head': '964a6396 (R394 run; the probe adapted at two places)', 'cases': results}, indent=2) + '\n')
    for name, r in results.items():
        data = r.get('actual', r)
        print(name, json.dumps({'verdict': data.get('verdict'), 'classes': data.get('classes'),
                                'findings': data['findings']}))


if __name__ == '__main__':
    main()
