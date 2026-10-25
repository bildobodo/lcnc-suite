"""Per-row look at one phase of a run: the page's viewer.perf rows with their
age bins, timer lateness, frame and GPU figures, and the gateway events
between them (parse spawns, sweeps), so a phase's tail can be placed."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpc
marks = json.load(open(sys.argv[1]))
ph = sys.argv[2]; page = sys.argv[3]
names = [m['name'] for m in marks]
i = names.index(ph)
t0, t1 = marks[i]['t_wall_ns'], marks[i + 1]['t_wall_ns']
recs = list(bpc.trace_lines(t0 - 10**9, t1 + 10**9))
for r in recs:
    tag = r.get('tag', '')
    t = (r['t_wall_ns'] - t0) / 1e9
    if tag == 'browser.viewer.perf' and r.get('page') == page:
        keep = {k: r[k] for k in r if k.startswith(('age', 'mt_', 'raf_', 'gpu_', 'render_', 'apply_', 'span_', 'ev_', 'in_delay', 'gap_')) and not k.endswith('_h')}
        print(f"{t:7.2f} ROW", json.dumps(keep, separators=(',', ':'))[:700])
        if 'age_h' in r: print('        age_h', r['age_h'])
    elif tag.startswith(('gcode.', 'collision.', 'browser.collision', 'preview.')) or 'sweep' in tag:
        print(f"{t:7.2f} {tag} {json.dumps({k: r[k] for k in r if k in ('job','reason','id','run_gen','ms','ran_ms','phase')})}")
