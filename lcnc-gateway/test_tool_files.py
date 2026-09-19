"""Server import files use the same parser as client uploads, inside one root."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import httpx
import fake_linuxcnc
fake_linuxcnc.install()
import gateway


class ToolFilesTest(unittest.IsolatedAsyncioTestCase):
    async def test_browse_download_auth_and_path_confinement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'libraries'
            root.mkdir()
            (root / 'subfolder').mkdir()
            raw = (Path(__file__).resolve().parents[1] / 'examples/sim_config/tool-libraries/fusion-freecad.json').read_bytes()
            (root / 'subfolder/tools.json').write_bytes(raw)
            (root / 'not-a-library.txt').write_text('no')
            (root / '.hidden.json').write_text('hidden')
            outside = Path(directory) / 'private.json'
            outside.write_text('secret')
            (root / 'escape.json').symlink_to(outside)
            (root / 'escape-dir').symlink_to(root.parent, target_is_directory=True)
            transport = httpx.ASGITransport(app=gateway.app)
            with patch.object(gateway, 'get_tool_library_dir', lambda: root), patch.object(gateway, 'WEBUI_TOKEN', 'test-token'):
                async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
                    for url in ['/tool-library-files', '/tool-library-file?path=subfolder/tools.json']:
                        self.assertEqual((await client.get(url)).status_code, 401)
                    client.headers['X-Auth-Token'] = 'test-token'
                    listing = (await client.get('/tool-library-files')).json()
                    self.assertEqual([e['name'] for e in listing['entries']], ['subfolder'])
                    self.assertEqual(listing['subdir'], '')
                    listing = (await client.get('/tool-library-files', params={'subdir': 'subfolder'})).json()
                    self.assertEqual(listing['entries'][0]['path'], 'subfolder/tools.json')
                    response = await client.get('/tool-library-file', params={'path': listing['entries'][0]['path']})
                    self.assertEqual(response.content, raw)
                    for url, param, value in [('/tool-library-files', 'subdir', '../'),
                                              ('/tool-library-files', 'subdir', 'escape-dir'),
                                              ('/tool-library-file', 'path', '../private.json'),
                                              ('/tool-library-file', 'path', str(outside)),
                                              ('/tool-library-file', 'path', 'escape.json'),
                                              ('/tool-library-file', 'path', 'not-a-library.txt')]:
                        self.assertEqual((await client.get(url, params={param: value})).status_code, 400)
                    self.assertEqual((await client.get('/tool-library-files?subdir=missing')).status_code, 404)
                    self.assertEqual((await client.get('/tool-library-file?path=missing.json')).status_code, 404)
                    with patch.object(gateway, 'MAX_TOOL_LIBRARY_SIZE', 1):
                        self.assertEqual((await client.get('/tool-library-file?path=subfolder/tools.json')).status_code, 413)

    def test_ini_folder_resolves_relative_and_home_paths(self):
        from types import SimpleNamespace
        with patch.dict('os.environ', {'LCNC_INI_FILE': '/configs/machine.ini'}), \
                patch.object(gateway, 'get_nc_files_dir', return_value='/programs'):
            for configured, expected in [('libraries', Path('/configs/libraries')),
                                         ('~/tools', Path.home() / 'tools'),
                                         ('/shared/tools', Path('/shared/tools')),
                                         (None, Path('/programs')),
                                         ('', Path('/programs'))]:
                with patch.object(gateway.linuxcnc, 'ini', return_value=SimpleNamespace(find=lambda *_: configured)):
                    self.assertEqual(gateway.get_tool_library_dir(), expected)

    def test_shared_program_folder_filters_tools_and_programs_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'demo.ngc').write_text('M2\n')
            (root / 'fusion-freecad.json').write_text('{}')
            with patch.dict('os.environ', {}, clear=True), \
                    patch.object(gateway, 'get_nc_files_dir', return_value=directory):
                tools = gateway.list_tool_library_files()
                programs = gateway.list_files()
                self.assertEqual(tools['directory'], programs['nc_dir'])
                self.assertEqual([entry['name'] for entry in tools['entries']], ['fusion-freecad.json'])
                self.assertEqual([entry['name'] for entry in programs['entries']], ['demo.ngc'])
