"""Native FreeCAD oracles, portable import formats and metadata-only persistence."""
import copy
import io
import json
import math
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
import zipfile

from freecad_import import decode_freecad_blob, parse_bit, quantity
from tool_import import decode_tool_blob
from tool_refresh import plan_metadata_refresh
from tool_table import tool_visual_metadata, _merge_tool_data

FIXTURES = Path(__file__).resolve().parent.parent / 'test-fixtures/freecad'


def bit(shape='endmill', **params):
    return {'version': 2, 'name': 'Test cutter', 'shape': shape + '.fcstd',
            'id': 'cutter-id', 'parameter': params}


def archive(bits=None, refs=None, extras=None):
    bits = bits or {'Bit/cutter.fctb': bit(Diameter='6 mm')}
    refs = refs or [{'nr': 1, 'path': 'cutter.fctb'}]
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('Library/tools.fctl', json.dumps({'version': 1, 'tools': refs}))
        for path, data in bits.items(): z.writestr(path, json.dumps(data))
        for path, data in (extras or {}).items(): z.writestr(path, data)
    return stream.getvalue()


def distance(point, chain):
    x, y = point
    result = math.inf
    for (ax, ay), (bx, by) in zip(chain, chain[1:]):
        dx, dy = bx - ax, by - ay
        t = min(1, max(0, ((x-ax)*dx + (y-ay)*dy) / (dx*dx+dy*dy))) if dx*dx+dy*dy else 0
        result = min(result, math.hypot(x-ax-t*dx, y-ay-t*dy))
    return result


class TestFreeCADImport(unittest.TestCase):
    def test_native_meridians_and_volumes_in_both_units(self):
        with (FIXTURES / 'native-profiles.json').open() as f: cases = json.load(f)['cases']
        self.assertEqual(len(cases), 42)
        for case in cases:
            for unit, scale in [('mm', 1), ('in', 1/25.4)]:
                with self.subTest(case=case['bit']['name'], unit=unit):
                    tool = parse_bit(case['bit'], 1, 'native', unit)
                    profile = [[x / scale, z / scale] for x, z in tool['native_profile']]
                    zmin = min(p[1] for edge in case['edges'] for p in edge)
                    closed = profile + [profile[0]]
                    native = [[[p[0], p[1]-zmin] for p in edge] for edge in case['edges']]
                    self.assertTrue(case['valid'])
                    self.assertLess(max(distance(p, closed) for edge in native for p in edge), .00101)
                    self.assertLess(max(min(distance(p, edge) for edge in native) for p in profile), .00051)
                    volume = abs(sum(math.pi*(b[1]-a[1])*(a[0]**2+a[0]*b[0]+b[0]**2)/3 for a,b in zip(closed,closed[1:])))
                    self.assertAlmostEqual(volume / case['volume'], 1, delta=.0006)

    def test_zip_numbers_metadata_identity_and_inch_conversion(self):
        data = archive(refs=[{'nr': 27, 'path': r'C:\old\Bit\cutter.fctb'}])
        parsed, skipped = decode_tool_blob(data, 'in')
        self.assertFalse(skipped)
        t = parsed[0]
        self.assertEqual(t['T'], 27)
        self.assertEqual(t['source_id'], 'cutter-id')
        self.assertEqual(t['source_metadata']['parameter']['Diameter'], '6 mm')
        self.assertAlmostEqual(t['D'], 6/25.4)
        self.assertNotIn('Z', t)
        self.assertNotIn('body_length', t)

    def test_duplicates_remain_visible_and_block_refresh(self):
        tools, skipped = decode_tool_blob(archive(refs=[{'nr': 1, 'path': 'cutter.fctb'}]*2), 'mm')
        self.assertEqual(len(skipped), 1)
        self.assertEqual(plan_metadata_refresh(tools, skipped, [{'T': 1,'D': 6,'Z': -44}], {})['updated'], [])

    def test_legacy_bullnose_parameters_and_literal_units(self):
        t = parse_bit(bit('bullnose', Diameter='0.25 in', FlatRadius='0.075 in'), 1, 'a', 'mm')
        self.assertAlmostEqual(t['D'], 6.35)
        self.assertAlmostEqual(t['native_profile'][1][0], 1.905)
        self.assertEqual(quantity('2.54 cm'), 25.4)
        self.assertEqual(quantity('1.5707963267948966 rad', True), 90)
        for q in ('1/4 in', 'nan', '1 mm + 2 mm', '6 kg', True):
            with self.subTest(q=q), self.assertRaises(ValueError): quantity(q)

    def test_rejects_incomplete_ambiguous_custom_and_invalid_uploads(self):
        bad = [b'{', b'[]', b'PKbroken', json.dumps({'version': 1,'tools': []}).encode(),
               archive(refs=[{'nr': 1,'path': 'missing.fctb'}]),
               archive(bits={'a/cutter.fctb': bit(), 'b/cutter.fctb': bit()}),
               archive(extras={'Shape/endmill.fcstd': 'custom'}),
               json.dumps(bit('my-custom-shape')).encode(),
               json.dumps({**bit(), 'shape-type': 'Custom'}).encode(),
               json.dumps(bit(Diameter='NaN mm')).encode(),
               json.dumps(bit(Length='2mm', CuttingEdgeHeight='20 mm')).encode()]
        for raw in bad:
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError): decode_tool_blob(raw,'mm')

    def test_linked_sources_cannot_overwrite_each_other_or_reused_ids(self):
        freecad = parse_bit(bit(Diameter=6), 1, 'a', 'mm')
        fusion = {'T': 1, 'D': 6, 'fusion_guid': 'fusion-id'}
        table = [{'T': 1,'D': 6,'Z': -40}]
        for old, new in [(fusion, freecad), (freecad, fusion),
                         (freecad, {**freecad, 'source_id': 'another'})]:
            self.assertEqual(plan_metadata_refresh([new], [], table, {'1': old})['updated'], [])
        plan = plan_metadata_refresh([freecad], [], table, {'1': freecad})
        self.assertEqual(plan['updated'], [1])
        visual = tool_visual_metadata(plan['library']['1'])
        self.assertEqual(visual['native_profile'], freecad['native_profile'])
        self.assertNotIn('source_metadata', visual)
        merged = _merge_tool_data([{**table[0],'P': 7}], plan['library'])[0]
        self.assertEqual(merged['Z'], -40)
        self.assertEqual(merged['P'], 7)

    def test_native_custom_mesh_retains_hole_and_asymmetry(self):
        with (FIXTURES/'custom-native.json').open() as f: bundle = json.load(f)
        tool = decode_tool_blob(json.dumps(bundle).encode(), 'in')[0][0]
        mesh = tool['native_mesh']
        self.assertEqual(len(mesh['triangles']), len(bundle['tools'][0]['geometry']['mesh']['triangles']))
        self.assertAlmostEqual(max(v[2] for v in mesh['vertices']), 30/25.4)
        self.assertEqual(tool['source_z_min'], -4/25.4)
        for mutate in [lambda g: g['mesh']['triangles'][0].__setitem__(0,999999),
                       lambda g: g['mesh']['vertices'][0].__setitem__(0,float('nan')),
                       lambda g: g.__setitem__('tolerance',0)]:
            invalid = copy.deepcopy(bundle)
            mutate(invalid['tools'][0]['geometry'])
            with self.assertRaises(ValueError): decode_tool_blob(json.dumps(invalid).encode(),'mm')


# Reuse the existing isolated REST fixture: NML calls and table writes are traps.
import test_tool_refresh as refresh_fixture

class TestFreeCADRoutes(unittest.IsolatedAsyncioTestCase):
    setUp = refresh_fixture.TestMetadataRefreshRoutes.setUp
    upload = refresh_fixture.TestMetadataRefreshRoutes.upload
    preview = refresh_fixture.TestMetadataRefreshRoutes.preview

    async def test_freecad_zip_refresh_preserves_exact_measurements(self):
        self.raw = archive()
        preview = await self.preview()
        import gateway
        await gateway.refresh_tool_library_metadata(self.upload(), preview['revision'])
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        self.assertEqual(self.store.load()['1']['source_id'], 'cutter-id')
        self.assertIn('native_profile', self.store.load()['1'])

    async def test_freecad_replace_initializes_unmeasured_zero(self):
        import gateway
        with patch.object(gateway, '_persist_imported_tools', new_callable=AsyncMock) as persist:
            await gateway.apply_tool_library_import(self.upload(archive()))
            _, table, metadata = persist.call_args.args
            self.assertEqual(table[0]['Z'], 0)
            self.assertEqual(metadata['1']['oal'], 50)


class TestFreeCADWorker(unittest.IsolatedAsyncioTestCase):
    async def test_zip_is_isolated_even_when_compressed_upload_is_small(self):
        from bulk_pipeline import BulkPipeline
        pipeline = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: 'mm',
                                build_wcs_rotation_patches=lambda: {})
        with patch('bulk_pipeline.decode_tool_blob', side_effect=AssertionError('inline ZIP decode')):
            parsed, skipped = await pipeline.decode_tool_offloaded(archive(), 'mm')
        self.assertEqual(parsed[0]['D'], 6)
        self.assertFalse(skipped)
        self.assertIsNone(pipeline.tool_import_proc)
        with self.assertRaises(ValueError):
            await pipeline.decode_tool_offloaded(b'PKinvalid', 'mm')
        self.assertIsNone(pipeline.tool_import_proc)
