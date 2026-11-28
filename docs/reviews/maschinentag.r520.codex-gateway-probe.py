"""R520: a fresh file still belongs to the Link that asked for it.

Fake NML only; actual set_wcs/clear_wcs handler, readback, cache and stamp.
Run in an isolated tree with pytest -p conftest. No live controller.
"""
import json
import tempfile
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import conftest  # host isolation before gateway
import pytest
import gateway
import coord_fixture
import coord_basis as cb
import test_coord_gateway as fixtures
from test_codex_r519 import setup
from test_command_dispatch import _payload
from link_fixture import swap_connection, FakeConnection


@pytest.mark.parametrize('command', ['set_wcs', 'clear_wcs'])
@pytest.mark.parametrize('change', ['none', 'revoke', 'replace'])
def test_file_readback_requires_its_own_link_at_adoption(command, change):
    with setup(fixtures.TestTouchoff) as fx, tempfile.TemporaryDirectory() as d:
        coord_fixture.path(fx, cb.PATH_DETECTOR)
        old_cache = deepcopy(gateway._wcs_cache)
        fx.addCleanup(lambda: gateway._wcs_cache.__setitem__(slice(None), old_cache))
        gateway._wcs_cache[0]['x'] = 3.0
        value = 7.0 if command == 'set_wcs' else 0.0
        path = Path(d) / 'sim.var'
        def body(x):
            return ''.join(f'{5221+i} {x if i == 0 else 0.0}\n' for i in range(10))
        path.write_text(body(3.0))
        old_synch = fx.ctl.conn.cmd.task_plan_synch
        def synch():
            old_synch()
            replacement = path.with_suffix('.new')
            replacement.write_text(body(value))
            replacement.replace(path)
        fx.ctl.conn.cmd.task_plan_synch = synch
        real_read = gateway.read_var_snapshot
        reads = []
        def read_and_switch(*args):
            result = real_read(*args)
            reads.append(result)
            # The asynchronous file read returns after the connection changed.
            # No manufactured values: read_var_snapshot just read the new file.
            if change == 'revoke':
                swap_connection(None)
            elif change == 'replace':
                swap_connection(FakeConnection())
            return result
        gateway._shared_status = _payload(g5x_index=1, task_mode=gateway.linuxcnc.MODE_MDI)
        msg = {'cmd': command, 'target': 'G54'}
        if command == 'set_wcs':
            msg['x'] = 7
        async def send():
            try:
                return await gateway.handle_command(msg, True)
            except gateway.NotConnected as exc:
                return {'ok': False, 'error': str(exc)}
        with patch.object(gateway._status_runtime, 'resolve_var_file_path', lambda: str(path)), \
             patch.object(gateway, 'read_var_snapshot', read_and_switch):
            reply = fixtures._run(coord_fixture.with_poller(fx.ctl, send()))
        print('R520 ' + json.dumps({'command': command, 'change': change,
              'reply': reply, 'cache_x': gateway._wcs_cache[0]['x'],
              'read_count': len(reads), 'own_link': gateway._link is fx.link}, default=str))
        assert len(reads) == 1
        if change == 'none':
            assert reply['ok'] is True
            assert gateway._wcs_cache[0]['x'] == value
        else:
            assert reply['ok'] is False, 'the completed old-Link file read is no current success'
            assert gateway._wcs_cache[0]['x'] == 3.0, 'a replaced read must not adopt into the global table'
