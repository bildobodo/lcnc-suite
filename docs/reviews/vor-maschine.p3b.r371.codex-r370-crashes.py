"""R370: malformed JSON objects must not certify a crash-free run."""
import json
from pathlib import Path
import pytest
import native_run as nr

OUT = []


@pytest.mark.parametrize("record", [{}, {"tag":"crash.thread", "level":None},
                                   {"tag":"crash.thread", "level":"erorr"}])
def test_invalid_record_cannot_make_a_clean_run(tmp_path, record):
    (tmp_path / "crash.log").write_text(json.dumps(record)+"\n")
    found = nr.run_crashes(tmp_path)
    report = {"rows":[{"status":"PASS"}], "restore":{"outcome":"complete", "isolation":[]},
              "crashes":found}
    row = {"record":record, "found":found, "verdict":nr.verdict(report)}
    OUT.append(row)
    Path("/tmp/r371-crashes.json").write_text(json.dumps(OUT, indent=2))
    assert row["verdict"] == "FAIL", row


@pytest.mark.parametrize("record, expected", [
    ({"proc": "gateway", "tag": "crash.signal", "level": "info"}, "PASS"),
    ({"proc": "gateway", "tag": "crash.thread", "level": "error"}, "FAIL"),
])
def test_comparison_valid_records(tmp_path, record, expected):
    (tmp_path / "crash.log").write_text(json.dumps(record)+"\n")
    found = nr.run_crashes(tmp_path)
    report = {"rows":[{"status":"PASS"}], "restore":{"outcome":"complete", "isolation":[]},
              "crashes":found}
    row = {"comparison": True, "record":record, "found":found, "verdict":nr.verdict(report)}
    OUT.append(row)
    Path("/tmp/r371-crashes.json").write_text(json.dumps(OUT, indent=2))
    assert row["verdict"] == expected, row
