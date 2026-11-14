"""Offline R366 counterprobes; fake LinuxCNC only (pytest conftest).
CMD.mdi below models v2.9.4 emcmodule.cc:922-934: UTF-8 s# length,
then strcpy into the native command. No controller or native module used.
"""
import json
from pathlib import Path
from unittest.mock import patch
import test_payload_contract as base
import gateway

ROWS = []

class TestNativeMdiBoundary(base._Dispatch):
    def exercise(self, name, msg):
        effective = []
        attempts = []
        def mdi(text):
            raw = text.encode('utf-8')
            attempts.append({'characters': len(text), 'bytes': len(raw), 'text': text})
            if len(raw) > 255:
                raise ValueError('MDI commands limited to 255 characters')
            effective.append(raw.split(b'\0', 1)[0].decode('utf-8'))
            return 1
        with patch.object(gateway, '_skip_flag_unknown', False), patch.object(self.cmd, 'mdi', mdi, create=True), \
                patch.object(gateway, '_reader_is_stale', lambda: False), \
                patch.object(gateway, '_reader_get', lambda key: {'z_eoffset_enable': 0, 'comp_enabled': 0, 'kins_type': 0, 'twp_active': 0, 'jog_active': 0}.get(key)):
            reply = self.send(msg)
        row = {'case': name, 'reply': reply, 'writes': self.cmd.calls,
               'mdi_attempts': attempts, 'native_effective_text': effective}
        ROWS.append(row)
        Path('/tmp/r366-probes.json').write_text(json.dumps(ROWS, indent=2, ensure_ascii=True))
        return row

    def test_multibyte_mdi_rejected_before_mode(self):
        row = self.exercise('multibyte_mdi', {'cmd': 'mdi', 'text': 'G4 P0 (' + '\u00e4' * 130 + ')'})
        assert row['reply']['ok'] is False
        assert row['writes'] == [], row

    def test_embedded_nul_never_executes_a_prefix(self):
        row = self.exercise('embedded_nul', {'cmd': 'mdi', 'text': 'G0 X1\0 Y2'})
        assert row['reply']['ok'] is False, row
        assert row['writes'] == [] and row['native_effective_text'] == [], row

    def test_generated_wcs_mdi_fits_before_mode(self):
        row = self.exercise('wcs_long_number', {'cmd': 'set_wcs', 'target': 'G54', 'x': 1e300})
        assert row['reply']['ok'] is False
        assert row['writes'] == [], row

    def test_small_multibyte_mdi_still_executes(self):
        text = 'G4 P0 (' + '\u00e4' * 100 + ')'
        row = self.exercise('valid_multibyte_twin', {'cmd': 'mdi', 'text': text})
        assert row['reply']['ok'] is True, row
        assert row['native_effective_text'] == [text]

    def test_huge_integer_is_refused_without_write_by_handler(self):
        row = self.exercise('huge_integer_backstop', {'cmd': 'set_wcs', 'target': 'G54', 'x': 10**400})
        assert row['reply']['ok'] is False
        assert row['writes'] == [] and row['mdi_attempts'] == []
