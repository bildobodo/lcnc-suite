"""Bundled mixed-source tools through import, persistence and the real REST routes."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

from tool_import import decode_tool_blob, initial_z_offset
from tool_refresh import plan_metadata_refresh
from tool_table import _TOOL_META_FIELDS, _merge_tool_data, tool_visual_metadata

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / 'examples/sim_config/tool-libraries/fusion-freecad.json'
with SAMPLE.open('rb') as f:
    RAW = f.read()
DATA = json.loads(RAW)


class TestExampleLibrary(unittest.TestCase):
    def test_curated_sources_have_unique_numbers_identities_and_no_presets_or_holders(self):
        tools, skipped = decode_tool_blob(RAW, 'mm')
        self.assertEqual(len(tools), 36)
        self.assertFalse(skipped)
        self.assertEqual([t['T'] for t in tools], list(range(1001, 1022)) + list(range(2001, 2016)))
        self.assertEqual(len({t.get('source_id') or t['fusion_guid'] for t in tools}), 36)
        self.assertEqual(len({t['type'] for t in tools}), 20)
        for tool in tools:
            self.assertTrue(tool['is_example'])
            self.assertTrue(tool['description'].startswith('Example / '))
            self.assertFalse(tool.get('presets'))
            self.assertFalse(tool.get('holder_segments'))
            self.assertGreater(tool['D'], 0)
            self.assertGreater(tool['oal'], 0)
        self.assertEqual(sum(bool(t.get('native_profile')) for t in tools), 14)
        self.assertEqual(sum(bool(t.get('native_mesh')) for t in tools), 1)
        self.assertTrue(any(t.get('profile') for t in tools))

    def test_generator_reproduces_committed_asset(self):
        spec = importlib.util.spec_from_file_location('example_generator', ROOT / 'scripts/build_example_tool_library.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.build(), DATA)

    def test_geometry_and_identities_survive_machine_unit_conversion_and_sidecar(self):
        mm = decode_tool_blob(RAW, 'mm')[0]
        inch = decode_tool_blob(RAW, 'in')[0]
        for entry, a, b in zip(DATA['tools'], mm, inch):
            with self.subTest(tool=a['T']):
                self.assertAlmostEqual(a['D'], b['D'] * 25.4)
                self.assertAlmostEqual(a['oal'], b['oal'] * 25.4)
                self.assertGreater(a['example_z_offset'], 0)
                self.assertLess(a['example_z_offset'], a['oal'])
                self.assertAlmostEqual(a['example_z_offset'], b['example_z_offset'] * 25.4)
                expected = entry['example_z_mm']
                self.assertEqual(a['example_z_offset'], expected)
                self.assertEqual(a.get('fusion_guid'), b.get('fusion_guid'))
                self.assertEqual(a.get('source_id'), b.get('source_id'))
                meta = {k: b[k] for k in _TOOL_META_FIELDS if k in b}
                row = _merge_tool_data([dict(T=b['T'], P=7, Z=-1.234, D=b['D'])], {str(b['T']): meta})[0]
                self.assertEqual(row['Z'], -1.234)
                self.assertTrue(row['is_example'])
                for key in ('profile', 'native_profile', 'native_mesh'):
                    if b.get(key): self.assertEqual(tool_visual_metadata(meta)[key], b[key])

    def test_number_collision_across_sources_is_reported_and_never_refreshed(self):
        data = copy.deepcopy(DATA)
        data['tools'][21]['data']['nr'] = 1001
        parsed, skipped = decode_tool_blob(json.dumps(data).encode(), 'mm')
        self.assertEqual([t['T'] for t in skipped], [1001])
        plan = plan_metadata_refresh(parsed, skipped, [dict(T=1001, D=12, Z=-50)], {})
        self.assertFalse(plan['updated'])
        self.assertIn('Duplicate', plan['rows'][0]['reason'])

    def test_nominal_exposed_length_is_separate_from_cutter_geometry(self):
        data = copy.deepcopy(DATA)
        baseline = decode_tool_blob(RAW, 'mm')[0][0]
        data['tools'][0]['example_z_mm'] = 48
        tool = decode_tool_blob(json.dumps(data).encode(), 'mm')[0][0]
        self.assertEqual(initial_z_offset(tool), 48)
        self.assertEqual({k: v for k, v in tool.items() if k != 'example_z_offset'},
                         {k: v for k, v in baseline.items() if k != 'example_z_offset'})
        # Existing version-1 examples without explicit lengths still load.
        data['version'] = 1
        del data['tools'][0]['example_z_mm']
        tool = decode_tool_blob(json.dumps(data).encode(), 'mm')[0][0]
        self.assertEqual(initial_z_offset(tool), 76)

    def test_rejects_invalid_or_non_example_setup_lengths(self):
        for value in (None, True, 0, -10, '120', float('nan'), float('inf')):
            data = copy.deepcopy(DATA)
            data['tools'][0]['example_z_mm'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                decode_tool_blob(json.dumps(data).encode(), 'mm')
        data = copy.deepcopy(DATA)
        data['is_example'] = False
        with self.assertRaisesRegex(ValueError, 'example_z_mm'):
            decode_tool_blob(json.dumps(data).encode(), 'mm')

    def test_rejects_bad_versions_sources_numbering_and_shapes(self):
        mutations = [lambda d: d.update(version=3), lambda d: d.update(version=True),
                     lambda d: d.update(is_example='yes'),
                     lambda d: d.update(tools=[]), lambda d: d.update(tools=d['tools'] * 60),
                     lambda d: d['tools'][0].update(source='lcnc-tool-library'),
                     lambda d: d['tools'][0].update(data=[]),
                     lambda d: d['tools'][0]['data']['post-process'].update(number=True),
                     lambda d: d['tools'][0]['data'].update(geometry=[]),
                     lambda d: d['tools'][0]['data']['geometry'].update(DC=0),
                     lambda d: d['tools'][21]['data'].update(bit=None)]
        for mutate in mutations:
            data = copy.deepcopy(DATA)
            mutate(data)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                decode_tool_blob(json.dumps(data).encode(), 'mm')
        with self.assertRaises(ValueError): decode_tool_blob(RAW, 'unknown')


import test_tool_refresh as refresh_fixture

class TestExampleRoutes(unittest.IsolatedAsyncioTestCase):
    setUp = refresh_fixture.TestMetadataRefreshRoutes.setUp
    upload = refresh_fixture.TestMetadataRefreshRoutes.upload

    async def test_preview_is_read_only_and_apply_uses_reviewed_nominal_lengths(self):
        import gateway
        data = json.loads((await gateway.import_tool_library(self.upload(RAW))).body)
        self.assertEqual(data['total'], 36)
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        with patch.object(gateway, '_persist_imported_tools', new_callable=AsyncMock) as persist:
            result = await gateway.apply_tool_library_import(self.upload(RAW))
            self.assertEqual(result['added'], 36)
            _, table, library = persist.call_args.args
            self.assertEqual([t['Z'] for t in table], [initial_z_offset(t) for t in data['tools']])
            self.assertTrue(all(t['Z'] > 0 for t in table))
            self.assertEqual(library['1001']['oal'], 76)
            self.assertTrue(all(t['is_example'] for t in library.values()))
        self.assertEqual(self.table.read_bytes(), self.table_bytes)

    async def test_refresh_retains_measured_offsets_and_does_not_touch_machine(self):
        import gateway
        self.table_bytes = b'; measured examples\nT1001 P7 X2 Z-42.300000 D12\nT2001 P8 Z+19.250000 D5\n'
        self.table.write_bytes(self.table_bytes)
        tools = decode_tool_blob(RAW, 'mm')[0]
        self.store.save({str(t['T']): t for t in tools if t['T'] in (1001, 2001)})
        preview = json.loads((await gateway.import_tool_library(self.upload(RAW))).body)['metadata_refresh']
        self.assertEqual(preview['updated'], [1001, 2001])
        result = await gateway.refresh_tool_library_metadata(self.upload(RAW), preview['revision'])
        self.assertEqual(result['updated'], 2)
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        self.assertTrue(self.store.load()['1001']['is_example'])
