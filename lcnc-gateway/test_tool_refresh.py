"""Measurement-preserving refresh, including the real REST handlers off-machine."""
import asyncio
import copy
import io
import json
import os
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fusion_import import parse_fusion_library
from tool_refresh import metadata_refresh_revision, plan_metadata_refresh
from tool_store import ToolLibraryStore


def source_tool(number=1, diameter=6, **extra):
    return {"T": number, "D": diameter, "type": "endmill", "oal": 60,
            "description": "Fusion cutter", **extra}


class TestMetadataRefreshPlan(unittest.TestCase):
    def test_preserves_table_and_local_data_and_clears_old_type_geometry(self):
        table = [dict(T=1, P=7, X=2, Y=-3, Z=-42.3, D=6), dict(T=8, P=8, Z=12, D=2)]
        library = {"1": {"profile": [{"end": [1, 2]}], "holder_segments": [1],
                         "shaft_segments": [2], "tip_offset": 10, "local_note": "keep"},
                   "8": {"description": "Unrelated"}}
        before = copy.deepcopy((table, library))
        plan = plan_metadata_refresh([source_tool()], [], table, library)
        self.assertEqual(plan["updated"], [1])
        self.assertEqual((table, library), before)
        self.assertEqual(plan["library"]["8"], library["8"])
        self.assertEqual(plan["library"]["1"]["local_note"], "keep")
        for key in ("profile", "holder_segments", "shaft_segments", "tip_offset", "D", "Z", "P"):
            self.assertNotIn(key, plan["library"]["1"])

    def test_skips_ambiguous_numbers_unknown_tools_identity_diameter_and_stl_conflicts(self):
        parsed = [source_tool(n) for n in range(1, 7)]
        table = [dict(T=n, D=6, Z=-40) for n in range(1, 6)]
        table += [dict(T=2, D=6, Z=-41)]
        table[3]["D"] = 5.99
        library = {"3": {"fusion_guid": "original"}, "5": {"stl_file": "local.stl"}}
        plan = plan_metadata_refresh(parsed, [source_tool(1)], table, library)
        self.assertEqual(plan["updated"], [])
        self.assertEqual(plan["skipped"], [1, 2, 3, 4, 5, 6])
        self.assertEqual(len({r["reason"] for r in plan["rows"]}), 6)
        self.assertEqual(plan["library"], library)

    def test_native_center_drill_metadata_and_table_rounding_in_both_units(self):
        fixture = Path(__file__).resolve().parent.parent / 'test-fixtures/fusion-tool-specials.json'
        with fixture.open() as handle:
            raw = next(c['raw'] for c in json.load(handle)['cases'] if c['id'] == 'center-base')
        for unit in ("mm", "in"):
            with self.subTest(unit=unit):
                tool = parse_fusion_library({"data": [raw]}, unit)[0][0]
                table = [dict(T=tool["T"], D=round(tool["D"], 6), Z=-42.3)]
                plan = plan_metadata_refresh([tool], [], table, {})
                meta = plan["library"][str(tool["T"])]
                self.assertEqual((meta["point_angle"], meta["taper_angle"]), (118, 30))
                self.assertAlmostEqual(meta["tip_length"], 2 if unit == "mm" else 2/25.4)
                self.assertEqual(table[0]["Z"], -42.3)

    def test_revision_changes_for_file_table_library_units_and_configuration(self):
        state = [b'file', [dict(T=1, D=6, Z=-42.3)], {"1": {"oal": 60}}, "/one.ini", "mm"]
        baseline = metadata_refresh_revision(*state)
        variants = [b'other file', [dict(T=1, D=6, Z=-44.1)], {"1": {"oal": 70}}, "/two.ini", "in"]
        for index, value in enumerate(variants):
            changed = copy.deepcopy(state)
            changed[index] = value
            self.assertNotEqual(baseline, metadata_refresh_revision(*changed))

    def test_explicit_destination_survives_configuration_switch(self):
        with TemporaryDirectory() as directory:
            active = ["/one.ini"]
            store = ToolLibraryStore(Path(directory) / "library.json", lambda: active[0])
            store.save({"1": {"description": "other machine"}}, ini_key="/two.ini")
            active[0] = "/two.ini"
            store.save({"1": {"description": "reviewed"}}, ini_key="/one.ini")
            self.assertEqual(store.load()["1"]["description"], "other machine")
            active[0] = "/one.ini"
            self.assertEqual(store.load()["1"]["description"], "reviewed")


# Same off-machine bootstrap as test_command_dispatch. No server lifecycle is
# started; every persistence path and machine/configuration input is substituted.
import fake_linuxcnc  # noqa: E402
fake_linuxcnc.install()
import gateway  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402


class TestMetadataRefreshRoutes(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ini = str(self.root / "test.ini")
        self.table = self.root / "tool.tbl"
        self.table_bytes = b'; untouched comment\nT1 P7 X+2 Y-3 Z-42.300000 A17 D6 ; measured tool\nT8 P8 Z+12 D2\n'
        self.table.write_bytes(self.table_bytes)
        self.store = ToolLibraryStore(self.root / "library.json", lambda: self.ini)
        self.store.save({"1": {"profile": [{"end": [1, 2]}], "local_note": "keep"},
                         "8": {"description": "unrelated"}})
        self.raw = json.dumps({"data": [{"type": "flat end mill", "guid": "native-1",
            "post-process": {"number": 1}, "geometry": {"DC": 6, "OAL": 60, "LB": 45}}]}).encode()
        self.saved_under_lock = []

        def save(library, *, ini_key=None):
            self.saved_under_lock.append(gateway._cmd_lock.locked())
            self.store.save(library, ini_key=ini_key)

        for p in [patch.dict(os.environ, {"LCNC_INI_FILE": self.ini}),
                  patch.object(gateway, "_current_ini_path", lambda: self.ini),
                  patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)),
                  patch.object(gateway, "get_ini_config", lambda: {"linear_units": "mm"}),
                  patch.object(gateway, "load_tool_library", self.store.load),
                  patch.object(gateway, "save_tool_library", save),
                  patch.object(gateway, "_cmd_lock", asyncio.Lock()),
                  patch.object(gateway, "_tool_table_version", 10),
                  patch.object(gateway, "_tool_meta_dirty", False),
                  patch.object(gateway, "write_tool_table", side_effect=AssertionError("table write")),
                  patch.object(gateway, "_reload_tool_table_and_bump", side_effect=AssertionError("NML reload"))]:
            p.start()
            self.addCleanup(p.stop)

    def upload(self, raw=None):
        return UploadFile(file=io.BytesIO(self.raw if raw is None else raw), filename="tools.json")

    async def preview(self):
        response = await gateway.import_tool_library(self.upload())
        data = json.loads(response.body)
        self.assertIsNone(data["metadata_refresh_error"])
        return data["metadata_refresh"]

    async def test_real_preview_and_refresh_preserve_exact_table_bytes(self):
        preview = await self.preview()
        self.assertEqual(preview["updated"], [1])
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        result = await gateway.refresh_tool_library_metadata(self.upload(), preview["revision"])
        self.assertEqual(result, {"ok": True, "updated": 1, "skipped": 0})
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        meta = self.store.load()
        self.assertEqual(meta["1"]["oal"], 60)
        self.assertEqual(meta["1"]["fusion_guid"], "native-1")
        self.assertNotIn("profile", meta["1"])
        self.assertEqual(meta["1"]["local_note"], "keep")
        self.assertEqual(meta["8"]["description"], "unrelated")
        self.assertEqual(self.saved_under_lock, [True])
        self.assertEqual(gateway._tool_table_version, 11)
        self.assertTrue(gateway._tool_meta_dirty)

    async def test_new_measurement_after_preview_rejects_stale_refresh(self):
        preview = await self.preview()
        changed = self.table_bytes.replace(b'-42.300000', b'-44.100000')
        self.table.write_bytes(changed)
        with self.assertRaises(HTTPException) as caught:
            await gateway.refresh_tool_library_metadata(self.upload(), preview["revision"])
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.table.read_bytes(), changed)
        self.assertFalse(self.saved_under_lock)

    async def test_source_change_and_metadata_edit_invalidate_review(self):
        preview = await self.preview()
        for raw in [self.raw.replace(b'60', b'70'), self.raw]:
            if raw == self.raw:
                self.store.save({"1": {"description": "edited elsewhere"}})
            with self.assertRaises(HTTPException) as caught:
                await gateway.refresh_tool_library_metadata(self.upload(raw), preview["revision"])
            self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(self.saved_under_lock)

    async def test_unidentified_configuration_cannot_refresh_default_metadata(self):
        with patch.object(gateway, "_current_ini_path", lambda: "default"):
            with self.assertRaises(HTTPException) as caught:
                await gateway.refresh_tool_library_metadata(self.upload(), "invalid")
            self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse(self.saved_under_lock)

    async def test_save_failure_does_not_publish_a_successful_version(self):
        preview = await self.preview()
        with patch.object(gateway, "save_tool_library", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                await gateway.refresh_tool_library_metadata(self.upload(), preview["revision"])
        self.assertEqual(self.table.read_bytes(), self.table_bytes)
        self.assertEqual(gateway._tool_table_version, 10)

    async def test_http_upload_requires_authentication_and_review_revision(self):
        import httpx
        transport = httpx.ASGITransport(app=gateway.app)
        with patch.object(gateway, "WEBUI_TOKEN", "unit-test-token"):
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                denied = await client.post("/import-tool-library/refresh", files={"file": ("tools.json", self.raw)})
                self.assertEqual(denied.status_code, 401)
                headers = {"X-Auth-Token": "unit-test-token"}
                missing = await client.post("/import-tool-library/refresh", headers=headers,
                                            files={"file": ("tools.json", self.raw)})
                self.assertEqual(missing.status_code, 422)
                preview = await client.post("/import-tool-library", headers=headers,
                                            files={"file": ("tools.json", self.raw)})
                revision = preview.json()["metadata_refresh"]["revision"]
                applied = await client.post("/import-tool-library/refresh", headers=headers,
                    files={"file": ("tools.json", self.raw)}, data={"revision": revision})
                self.assertEqual(applied.status_code, 200)
                self.assertEqual(applied.json()["updated"], 1)
        self.assertEqual(self.table.read_bytes(), self.table_bytes)

    async def test_cancelled_request_holds_lock_until_metadata_write_completes(self):
        preview = await self.preview()
        started, release = threading.Event(), threading.Event()

        def delayed_save(library, *, ini_key=None):
            started.set()
            if not release.wait(3):
                raise TimeoutError("Test did not release writer")
            self.store.save(library, ini_key=ini_key)

        with patch.object(gateway, "save_tool_library", delayed_save):
            task = asyncio.create_task(gateway.refresh_tool_library_metadata(self.upload(), preview["revision"]))
            try:
                self.assertTrue(await asyncio.to_thread(started.wait, 2))
                task.cancel()
                await asyncio.sleep(0)
                self.assertTrue(gateway._cmd_lock.locked())
            finally:
                release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertFalse(gateway._cmd_lock.locked())
        self.assertEqual(gateway._tool_table_version, 11)
        self.assertEqual(self.table.read_bytes(), self.table_bytes)

    async def test_corrupt_sidecar_is_not_replaced_with_cached_metadata(self):
        preview = await self.preview()
        path = self.root / "library.json"
        path.write_bytes(b'{broken JSON')
        with self.assertRaises(HTTPException) as caught:
            await gateway.refresh_tool_library_metadata(self.upload(), preview["revision"])
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(path.read_bytes(), b'{broken JSON')
        self.assertEqual(gateway._tool_table_version, 10)
        self.assertEqual(self.table.read_bytes(), self.table_bytes)


if __name__ == "__main__":
    unittest.main()
