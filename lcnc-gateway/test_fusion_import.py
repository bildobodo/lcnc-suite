"""Fusion tool import regressions; stdlib only, no machine or gateway import."""
import copy
import json
from pathlib import Path
import unittest

from fusion_import import parse_fusion_library
from tool_table import _merge_tool_data

FIXTURES = Path(__file__).resolve().parent.parent / 'test-fixtures/fusion-tool-contours.json'
with FIXTURES.open() as fixture_file:
    CASES = json.load(fixture_file)['cases']


class TestFusionGeometryImport(unittest.TestCase):
    def test_countersink_keeps_native_included_angle_in_both_units(self):
        for case in CASES:
            if case['raw']['type'] != 'counter sink':
                continue
            for unit in ('mm', 'in'):
                with self.subTest(case=case['id'], unit=unit):
                    tools, skipped = parse_fusion_library({'data': [case['raw']]}, unit)
                    self.assertFalse(skipped)
                    tool = tools[0]
                    self.assertEqual(tool['point_angle'], case['raw']['geometry']['SIG'])
                    self.assertAlmostEqual(tool['D'], 10 if unit == 'mm' else 10 / 25.4)

    def test_inch_source_converts_lengths_but_not_angles(self):
        raw = {'type': 'counter sink', 'unit': 'inches',
               'post-process': {'number': 7},
               'geometry': {'DC': 0.25, 'OAL': 2, 'LCF': 0.5, 'SIG': 120}}
        tool = parse_fusion_library({'data': [raw]}, 'mm')[0][0]
        self.assertAlmostEqual(tool['D'], 6.35)
        self.assertAlmostEqual(tool['oal'], 50.8)
        self.assertEqual(tool['point_angle'], 120)

    def test_import_and_metadata_merge_preserve_measured_offset(self):
        raw = next(c['raw'] for c in CASES if c['id'] == 'bare-counter-sink')
        before = copy.deepcopy(raw)
        meta = parse_fusion_library({'data': [raw]}, 'mm')[0][0]
        self.assertNotIn('Z', meta)
        for measured_z in (-42.3, -44.1, 43.0):
            with self.subTest(measured_z=measured_z):
                table = [{'T': meta['T'], 'P': meta['T'], 'Z': measured_z, 'D': meta['D']}]
                merged = _merge_tool_data(table, {str(meta['T']): meta})[0]
                self.assertEqual(merged['Z'], measured_z)
                self.assertEqual(merged['oal'], 70)
        self.assertEqual(raw, before)

    def test_center_drill_retains_legacy_mapping_pending_native_reference(self):
        raw = {'type': 'center drill', 'post-process': {'number': 1},
               'geometry': {'DC': 6, 'TA': 30, 'SIG': 60}}
        tool = parse_fusion_library({'data': [raw]}, 'mm')[0][0]
        self.assertEqual((tool['taper_angle'], tool['point_angle']), (60, 120))


if __name__ == '__main__':
    unittest.main()
