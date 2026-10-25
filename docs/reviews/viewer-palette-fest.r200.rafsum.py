"""Per phase: the page rows' rAF gaps, timer lateness and age tail — whether a
phase's late status applies come from a blocked main thread (timer lateness)
or from frames that do not come (rAF gaps with a free main thread)."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpc
marks = json.load(open(sys.argv[1])); page = sys.argv[2]
for i in range(len(marks) - 1):
    t0, t1 = marks[i]['t_wall_ns'], marks[i + 1]['t_wall_ns']
    rows = [r for r in bpc.trace_lines(t0, t1) if r.get('tag') == 'browser.viewer.perf' and r.get('page') == page]
    if not rows: continue
    def col(k): return [r.get(k, 0) for r in rows]
    over = sum(sum(n for b, n in r.get('age_h', {}).items() if int(b) >= 50) for r in rows)
    n = sum(r.get('age_n', 0) for r in rows)
    print(f"{marks[i]['name']:12s} rows {len(rows):3d} raf_ticks/row {sum(col('raf_ticks'))/len(rows):6.1f} raf_gap_p95 max {max(col('raf_gap_p95_ms')):4d} mean {sum(col('raf_gap_p95_ms'))/len(rows):5.1f}"
          f" raf_gap_max {max(col('raf_gap_max_ms')):4d} mt_late_p95 max {max(col('mt_late_p95_ms')):3d} mt_late_max max {max(col('mt_late_max_ms')):4d}"
          f" gpu_done_max {max(col('gpu_done_max_ms')):3d} age>50 {over}/{n} = {over/max(n,1):.3f}")
