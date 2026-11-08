"""R339: a stored browser token can acquire a new INI profile without deletion.
Run with PYTHONPATH=<archive>/lcnc-gateway. Only temporary local files.
"""
import json
import tempfile
from pathlib import Path
from settings_store import SettingsStore

with tempfile.TemporaryDirectory() as folder:
    ini = ['first.ini']
    store = SettingsStore(Path(folder) / 'settings.json', lambda: ini[0])
    first, created_first = store.bind('a' * 32, 'review')
    ini[0] = 'second.ini'
    second, created_second = store.bind('a' * 32, 'review')
    ini[0] = 'first.ini'
    still_first, created_again = store.bind('a' * 32, 'review')
    assert first == still_first and first != second
    assert created_first and created_second and not created_again
    print(json.dumps({'same_browser_token':True, 'deletions':0,
      'first_ini_created':created_first, 'second_ini_created':created_second,
      'first_ini_still_present':first == still_first,
      'return_to_first_created':created_again}, indent=2))
