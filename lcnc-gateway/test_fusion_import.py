"""Fusion tool import regressions; stdlib only, no machine or gateway import."""
import copy
import json
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory

from fusion_import import parse_fusion_library
from tool_table import (
    _TOOL_META_FIELDS, _merge_tool_data, tool_visual_metadata,
    parse_tool_table, write_tool_table,
)
from tool_store import ToolLibraryStore

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

    def test_shaft_uses_tool_units_and_holder_uses_its_own_units(self):
        raw = {'type': 'flat end mill', 'unit': 'inches',
               'post-process': {'number': 7},
               'geometry': {'DC': 0.25, 'OAL': 2, 'LCF': 0.5,
                            'shoulder-length': 0.75, 'shoulder-diameter': 0.25},
               'shaft': {'type': 'shaft', 'segments': [
                   {'height': 0.5, 'lower-diameter': 0.25, 'upper-diameter': 0.5}]},
               'holder': {'unit': 'millimeters', 'segments': [
                   {'height': 30, 'lower-diameter': 20, 'upper-diameter': 25}]}}
        before = copy.deepcopy(raw)
        for unit, scale in [('mm', 1), ('in', 1 / 25.4)]:
            with self.subTest(unit=unit):
                tool = parse_fusion_library({'data': [raw]}, unit)[0][0]
                segment = tool['shaft_segments'][0]
                self.assertAlmostEqual(segment['height'], 12.7 * scale)
                self.assertAlmostEqual(segment['lower_diameter'], 6.35 * scale)
                self.assertAlmostEqual(segment['upper_diameter'], 12.7 * scale)
                self.assertAlmostEqual(tool['shoulder_length'], 19.05 * scale)
                self.assertAlmostEqual(tool['shoulder_diameter'], 6.35 * scale)
                self.assertAlmostEqual(tool['holder_segments'][0]['height'], 30 * scale)
        self.assertEqual(raw, before)

    def test_persisted_shaft_reaches_table_and_viewer_without_changing_measurement(self):
        raw = next(c['raw'] for c in CASES if c['id'] == 'bare-dovetail-mill')
        tool = parse_fusion_library({'data': [raw]}, 'mm')[0][0]
        with TemporaryDirectory() as directory:
            path = Path(directory)
            store = ToolLibraryStore(path / 'library.json', lambda: '/test.ini')
            key = str(tool['T'])
            store.save({key: {k: tool[k] for k in _TOOL_META_FIELDS if k in tool}})
            library = store.load()
            table = path / 'tool.tbl'
            for measured in [-42.3, -44.1]:
                write_tool_table(str(table), [dict(T=tool['T'], P=1, Z=measured, D=tool['D'])])
                merged = _merge_tool_data(parse_tool_table(str(table)), library)[0]
                viewer = tool_visual_metadata(library[key])
                self.assertEqual(merged['Z'], measured)
                for meta in [merged, viewer]:
                    self.assertEqual(meta['shaft_segments'], tool['shaft_segments'])
                    self.assertEqual(meta['shoulder_length'], 4)
                    self.assertEqual(meta['fusion_type'], 'dovetail mill')
                self.assertNotIn('Z', viewer)

    def test_custom_profile_survives_the_viewer_payload(self):
        raw = next(c['raw'] for c in CASES if c['raw']['type'] == 'form mill')
        tool = parse_fusion_library({'data': [raw]}, 'mm')[0][0]
        self.assertEqual(tool_visual_metadata(tool)['profile'], tool['profile'])


if __name__ == '__main__':
    unittest.main()
