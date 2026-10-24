"""R197 offline reproduction, no sockets or driver execution.
Usage: python3 reproduce.py DOCS_REVIEWS RAW_DIRECTORY OUTPUT_DIRECTORY
Use '-' for RAW_DIRECTORY to restore it from the retained codex evidence.
"""
from pathlib import Path
import contextlib, copy, gzip, io, json, shutil, sys

D, raw, out = [Path(v).resolve() for v in sys.argv[1:4]]
out.mkdir(exist_ok=True)
if sys.argv[2] == '-':
    raw = out / 'raw'
    raw.mkdir(exist_ok=True)
    for name, dest in [('events', 'trace.ndjson'), ('rss', 'rss.jsonl')]:
        with gzip.open(D / f'viewer-palette-fest.r197.codex-{name}.jsonl.gz', 'rb') as f:
            (raw / dest).write_bytes(f.read())
    logs = json.loads((D / 'viewer-palette-fest.r197.codex-heartbeat-logs.json').read_text())
    buf = bytearray(b' ' * logs['gateway_file_bytes'])
    for row in logs['gateway_heartbeat_lines']:
        text = (row['line'] + '\n').encode()
        assert len(text) == row['bytes']
        buf[row['offset']:row['offset'] + row['bytes']] = text
    (raw / 'gateway.log').write_bytes(buf)
    (raw / 'hal_watchdog.log').write_text(logs['watchdog_text'])
tool = out / 'tools'
tool.mkdir(exist_ok=True)
for name, src in [('bpc.py', 'r182.browser-pc-bpc.py'), ('bpc2.py', 'r197.browser-pc-report2.py')]:
    shutil.copyfile(D / ('viewer-palette-fest.' + src), tool / name)
sys.path.insert(0, str(tool))
sys.dont_write_bytecode = True
import bpc, bpc2
bpc.LOGS = str(raw)
bpc2.RSS = str(raw / 'rss.jsonl')
all_runs = {}
for variant in ['e2-run1', 'e2-run2', 'touch']:
    pre = 'viewer-palette-fest.r197.'
    sys.argv = ['bpc2.py', 'report', '--pages', 'yss6ayq3', '--marks', str(D / (pre + 'marks-' + variant + '.json')),
                '--anchors', str(D / (pre + 'anchors-' + variant + '.json')),
                '--supersede', str(D / (pre + 'supersede-' + variant + '.json'))]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        bpc2.report()
    actual = json.loads(buf.getvalue())
    expected = json.loads((D / (pre + 'report-' + variant + '.json')).read_text())
    (out / (variant + '.json')).write_text(buf.getvalue())
    assert actual == expected, 'report differs: ' + variant
    marks = bpc.load_marks()
    i = next(i for i, m in enumerate(marks) if m['name'] == 'S_supersede')
    a, z = marks[i]['t_wall_ns'], marks[i+1]['t_wall_ns']
    recs = bpc.trace_lines(a, z)
    rows = [r for r in recs if r.get('tag') == 'browser.viewer.perf' and r.get('page') == 'yss6ayq3']
    phase = next(x for x in actual['phases'] if x['phase'] == 'S_supersede')
    # Histogram keys are LOWER edges. The supplied rafsum uses > 50,
    # unlike the report's >= 50, so record both rather than conflate them.
    hist = {}
    for r in rows:
        for k, n in r.get('age_h', {}).items(): hist[int(k)] = hist.get(int(k), 0) + n
    frames = sum(hist.values())
    all_runs[variant] = {
        'full_report_identical': True,
        'all_phases_complete': all(x['coverage']['complete'] for x in actual['phases']),
        'all_press_counts_zero': all(x.get('input', {}).get('presses') == 0 for x in actual['phases']),
        'S_age': phase['status']['age_ms'], 'S_interior_age': phase['status_interior']['age_ms'],
        'S_verdict': phase['verdict'], 'S_collision': phase['collision'], 'S_main_thread': phase['main_thread'],
        'raf_ticks_mean': sum(r['raf_ticks'] for r in rows) / len(rows),
        'raf_gap_p95_mean': sum(r['raf_gap_p95_ms'] for r in rows) / len(rows),
        'raf_gap_max': max(r['raf_gap_max_ms'] for r in rows),
        'timer_lateness_p95_max': max(r['mt_late_p95_ms'] for r in rows),
        'age_histogram_lower_edge_ge50': sum(n for lo, n in hist.items() if lo >= 50) / frames,
        'age_histogram_lower_edge_gt50': sum(n for lo, n in hist.items() if lo > 50) / frames,
        'last_parse_ms': phase['parse_jobs'][-1].get('ran_ms'),
    }
    if variant == 'touch':
        jobs, overlap = bpc2.jobs(recs)
        switches = json.loads((D / (pre + 'supersede-touch.json')).read_text())
        rss = phase['process_memory']
        checks = {}
        def case(name, js, log, want):
            verdict = bpc2.s_verdict(js, overlap, rss, log)
            assert verdict['verdict'] == want, (name, verdict)
            checks[name] = verdict
        case('touch accepted', jobs, switches, 'S met')
        bad = copy.deepcopy(jobs); bad[0]['reason'] = 'wcsoff:G54:z'
        case('offset edge rejected for touch', bad, switches, 'S not met')
        bad = copy.deepcopy(switches); bad[0]['variant'] = 'offset'
        case('file edge rejected for offset', jobs, bad, 'S not met')
        bad = copy.deepcopy(switches); bad[0]['basis'] = 'wrong'
        case('wrong basis rejected', jobs, bad, 'S not met')
        bad = copy.deepcopy(jobs); bad[0]['events'].remove('parse_cancelled')
        case('uncancelled earlier job rejected', bad, switches, 'S not met')
        all_runs['touch_tool_probes'] = checks
(out / 'summary.json').write_text(json.dumps(all_runs, indent=2) + '\n')
print(json.dumps({'reports_identical': 3, 'touch_tool_probes': 5, 'summary': str(out / 'summary.json')}))
