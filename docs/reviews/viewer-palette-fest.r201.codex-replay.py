"""Replay retained R200 evidence through the R201 reader; offline only.
Usage: python3 this.py /path/to/docs/reviews
"""
import gzip
import importlib.util
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path


def main():
    docs = Path(sys.argv[1])
    source = docs / "viewer-palette-fest.r201.browser-pc-tracetail.py"
    spec = importlib.util.spec_from_file_location("review_tracetail", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    marks = json.loads((docs / "viewer-palette-fest.r200.marks-f.json").read_text())
    start, end = marks[0]["t_wall_ns"], marks[-1]["t_wall_ns"]
    expected = []
    total = 0
    with tempfile.TemporaryDirectory(prefix="r201-replay-") as td:
        with gzip.open(docs / "viewer-palette-fest.r200.codex-events.jsonl.gz", "rb") as src, open(Path(td) / "trace.ndjson", "wb") as dst:
            for raw in src:
                rec = json.loads(raw)
                total += 1
                # The retained evidence already preserves the reader's prefix.
                assert raw.startswith(b'{"t_wall_ns":')
                dst.write(raw)
                if start <= rec["t_wall_ns"] <= end:
                    expected.append(rec)
        expected.sort(key=lambda r: r["t_wall_ns"])
        tail = module.TraceTail(start, td)
        actual = [r for r in tail.since(start) if r["t_wall_ns"] <= end]
        assert actual == expected, "stream differs from the retained records"
        for _ in range(3):
            assert [r for r in tail.since(start) if r["t_wall_ns"] <= end] == expected
    jobs = Counter(r.get("job") for r in actual if r.get("tag") == "gcode.publish")
    resets = sum(r.get("tag") == "wd.trip_reset" for r in actual)
    assert jobs == Counter({103: 1, 104: 1, 112: 1, 113: 1, 114: 1, 115: 1}), jobs
    assert resets == 1, resets
    print(json.dumps({"result": "PASS", "retained_records": total, "phase_start_ns": start, "phase_end_ns": end, "records_between_marks": len(actual), "records_equal_to_direct_read": True, "repeat_polls_unchanged": 3, "publication_jobs": dict(jobs), "wd.trip_reset": resets}, indent=2))


if __name__ == "__main__":
    main()
