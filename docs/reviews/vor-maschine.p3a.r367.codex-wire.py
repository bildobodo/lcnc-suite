"""R367 offline counterprobes, real dispatch and fake LinuxCNC only.

Run under this archive's conftest.py, which replaces linuxcnc and NML discovery.
Expected safety contracts, not assertions of the current wrong behaviour.
"""
import json
from pathlib import Path
from unittest.mock import patch

import gateway
import test_payload_contract as base

ROWS = []


class TestR367Wire(base._Dispatch):
    def exercise(self, name, msg, eoffset=0):
        pins = {"z_eoffset_enable": 0, "comp_enabled": 0, "kins_type": 0,
                "twp_active": 0, "jog_active": 0, "z_eoffset": eoffset}
        books = []
        with patch.object(gateway, "_skip_flag_unknown", False), \
                patch.object(gateway, "_reader_is_stale", lambda: False), \
                patch.object(gateway, "_reader_get", lambda key: pins.get(key)), \
                patch.object(gateway, "_ts_book", lambda *a, **k: books.append([a, k])), \
                patch.object(gateway, "_resolve_var_file_path", lambda: None):
            reply = self.send(msg)
        row = {"case": name, "payload": msg, "z_eoffset": eoffset,
               "reply": reply, "writes": self.cmd.calls, "bookings": books}
        ROWS.append(row)
        Path("/tmp/r367-wire.json").write_text(json.dumps(ROWS, indent=2))
        return row

    def test_long_parameter_key_refused_before_first_write(self):
        row = self.exercise("raw_parameter_key", {"cmd": "mdi", "text": "G4 P0",
                            "vars": {"3014": 1, "0" * 260 + "3054": 2}})
        assert row["reply"]["ok"] is False, row
        assert row["writes"] == [] and row["bookings"] == [], row

    def test_corrected_z_is_checked_before_first_write(self):
        # Stable, known residual eoffset, compensation disabled. Choose X so
        # the uncorrected line is exactly 254 bytes and the actual one 255.
        x = next(10.0 ** n for n in range(1, 300)
                 if len(f"G10 L20 P9 X{10.0 ** n:.6f} Z0.000000".encode()) == 254)
        row = self.exercise("corrected_z_boundary", {"cmd": "touchoff", "axes": {"X": x, "Z": 0}}, -1)
        assert row["reply"]["ok"] is False, row
        assert row["writes"] == [], row

    def test_canonical_parameter_key_positive_twin(self):
        row = self.exercise("canonical_parameter_key", {"cmd": "mdi", "text": "G4 P0",
                            "vars": {"3014": 1, "3054": 2}})
        assert row["reply"]["ok"] is True, row
        assert any(n == "mdi" and a[0] == "G4 P0" for n, a, _k in row["writes"]), row

    def test_without_z_correction_positive_twin(self):
        x = next(10.0 ** n for n in range(1, 300)
                 if len(f"G10 L20 P9 X{10.0 ** n:.6f} Z0.000000".encode()) == 254)
        row = self.exercise("uncorrected_z_boundary", {"cmd": "touchoff", "axes": {"X": x, "Z": 0}}, 0)
        assert row["reply"]["ok"] is True, row
        lines = [a[0] for n, a, _k in row["writes"] if n == "mdi"]
        assert len(lines[0].encode()) == 254, row
