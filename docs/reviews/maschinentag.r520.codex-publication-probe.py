"""R520 controlled publication order, actual gateway basis comparison.
Fake controller only. Adapted from the R519 probe: sets actual publication
identity as well as its ctx, because the product now carries that identity.
"""
import json
from pathlib import Path
import conftest
from test_codex_r519 import setup
import gateway

with setup() as fx:
    assert fx.read()[0]
    bulk = gateway._bulk
    bulk.preview_version = 101
    bulk.published_program = 'codex-program.1'
    bulk.published_ctx['var_patches']['5221'] = '7.0'
    old = gateway._coord_basis_status()
    bulk.preview_version = 102
    bulk.published_ctx['var_patches']['5221'] = '0.0'
    newer = gateway._coord_basis_status()
    bulk.preview_version = 103
    bulk.published_ctx['var_patches']['5221'] = '7.0'
    last = gateway._coord_basis_status()
    assert old['publication'] is not None
    assert newer['publication'] is None
    assert last['publication'] is not None
    Path('/tmp/codex-r520-review/publication-observation.json').write_text(json.dumps({
        'scope': 'Actual gateway comparison and controlled publication changes; no live browser run.',
        'old_frame': old, 'new_frame': newer, 'last_frame': last,
    }, indent=2) + '\n')
