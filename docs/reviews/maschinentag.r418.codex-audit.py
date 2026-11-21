"""R418 local evidence audit. Output only aggregate, non-identifying fields."""
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path('/home/cnc/claude-work/machine-day-logs/2026-11-21')
ZONE = ZoneInfo('Europe/Zurich')
def wall(h, m):
    return int(dt.datetime(2026, 11, 21, h, m, tzinfo=ZONE).timestamp() * 1e9)
def local(t):
    return dt.datetime.fromtimestamp(t / 1e9, ZONE).strftime('%H:%M:%S.%f')[:12]

lo, hi = wall(10, 18), wall(14, 27)
rows, inputs, bad = [], {}, collections.Counter()
for path in sorted((ROOT / 'x').glob('trace.ndjson*')):
    inputs[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    for line in path.open():
        try:
            r = json.loads(line)
        except ValueError:
            bad[path.name] += 1
            continue
        if lo <= r.get('t_wall_ns', 0) < hi:
            rows.append((path.name, r))
spawns = [r for _, r in rows if r['tag'] == 'gcode.spawn_start']
publishes = [r for _, r in rows if r['tag'] == 'gcode.publish']
lags = [r for _, r in rows if r['tag'] == 'lag.window']
out = {'window_machine_wall_time': '2026-11-21 10:18:00 <= t < 14:27:00 Europe/Zurich',
       'inputs_sha256': inputs, 'malformed_trace_lines_all_dates': bad,
       'parse_starts': len(spawns), 'unique_started_jobs': len({(r['pid'], r['job']) for r in spawns}),
       'parse_publishes': len(publishes),
       'start_reasons': dict(collections.Counter(r.get('reason') for r in spawns)),
       'lag_windows': len(lags), 'lag_max_ms': max(r['drift_ms'] for r in lags),
       'crash_prefix_records_found': sum(r['tag'].startswith('crash.') for _, r in rows),
       'trip_snapshot_results': [{'tag': r['tag'], 'rc': r.get('rc')} for _, r in rows if r['tag'].startswith('safety.trip_snapshot')],
       'run_starts': [{'verified': r['verified'], 'why': r.get('why')} for _, r in rows if r['tag'] == 'run_basis.start'],
       'job_25_events': [{'tag': r['tag'], 'machine_time': local(r['t_wall_ns'])} for _, r in rows
                         if r['tag'] in ('gcode.spawn_start', 'gcode.publish') and r.get('job') == 25]}
late = [(name, r) for name, r in rows if wall(13, 15) <= r['t_wall_ns']]
out['trace_writers_after_13_15'] = {name: dict(collections.Counter(r['proc'] for n, r in late if n == name))
                                    for name in sorted({n for n, _ in late})}
path = ROOT / 'inputs.ndjson'
out['inputs_sha256']['inputs.ndjson'] = hashlib.sha256(path.read_bytes()).hexdigest()
events = [json.loads(s) for s in path.read_text().splitlines()]
menus = [r for r in events if r['type'] == 'contextmenu']
def stop(r):
    target = r.get('on', '').lower()
    return any(word in target for word in ('e-stop', 'abort', 'pause', 'jog stop', 'spindle stop'))
out['input_recording'] = {'events': len(events), 'contextmenus': len(menus),
                          'contextmenus_named_for_stop': sum(map(stop, menus)),
                          'first_machine_time': local(min(r['t'] for r in events) * 1000000),
                          'last_machine_time': local(max(r['t'] for r in events) * 1000000)}
example = next(r for r in menus if r.get('on') == 'button[submit]:Front-left corner')
group = [r for r in events if r.get('id') == example.get('id')]
out['long_press_example'] = {'control': 'Front-left corner (hold control, not a stop)',
    'events': [{'event': r['type'], 'delta_ms': r['p'] - group[0]['p']} for r in group]}
assert (out['parse_starts'], out['parse_publishes'], out['lag_windows'], out['lag_max_ms']) == (28, 27, 26, 250)
assert out['input_recording']['contextmenus_named_for_stop'] == 0
Path('/tmp/r418/audit.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))
