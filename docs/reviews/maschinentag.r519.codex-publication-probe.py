"""R519 proof-identity observation. Fake controller, actual gateway terms."""
import json
from copy import deepcopy
from pathlib import Path
import conftest
from test_codex_r519 import setup
import gateway

with setup() as fx:
    assert fx.read()[0]
    bulk=gateway._bulk
    # The caller is still showing publication A (a previous bad basis).
    bulk.published_ctx['var_patches']['5221']='7.0'
    old=gateway._coord_basis_status()
    # A different publication B has the now confirmed offset. This is the
    # assignment performed by BulkPipeline._apply, without any client ACK.
    bulk.published_ctx['var_patches']['5221']='0.0'
    newer=gateway._coord_basis_status()
    assert old['publication'] is not None
    assert newer['publication'] is None
    result={'scope':'Actual gateway comparison; publication switches are controlled, not a live browser run.',
            'shown_publication':101,'latest_gateway_publication':102,'old_frame':old,'new_frame':newer}
    Path('/tmp/codex-r519-review/publication-observation.json').write_text(json.dumps(result,indent=2)+'\n')
