"""R371: invalid JSON field types must stay in the restored run's report."""
import json
from pathlib import Path

import pytest
import native_run as nr
from test_native_stage import _passing_run

OUT = []


@pytest.mark.parametrize("level", [[], {}])
def test_unhashable_level_is_damaged_evidence_not_a_lost_report(tmp_path, level):
    record = {"tag": "crash.thread", "level": level}
    error = None
    report = None
    try:
        report = _passing_run(tmp_path, [json.dumps(record)])
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    run = tmp_path / "run"
    restored = json.loads((run / "restore.json").read_text()) if (run / "restore.json").exists() else None
    row = {"record": record, "error": error,
           "restore_exists": (run / "restore.json").exists(),
           "restore_outcome": restored.get("outcome") if restored else None,
           "report_exists": (run / "report.json").exists(),
           "crashes": report.get("crashes") if report else None,
           "verdict": nr.verdict(report) if report else None}
    OUT.append(row)
    Path("/tmp/r371-crash-types.json").write_text(json.dumps(OUT, indent=2))
    assert error is None, row
    assert row["report_exists"] and row["crashes"], row
    assert row["verdict"] == "FAIL", row
