"""R427 independent regressions. Fake controller and TestClient only."""
import asyncio
import time
from unittest import mock

from fastapi.testclient import TestClient
import gateway
import link_fixture
from test_button_gates import _RecordingCmd
from test_jog_lease_gateway import _Lease, _Ws, JS


class TestR427Link(_Lease):
    def test_old_lease_expiry_never_writes_to_a_new_link(self):
        self.assertTrue(self.jog(1)['ok'])
        old = gateway._link
        newer_cmd = _RecordingCmd()
        new = gateway._publish_link(old.stat, newer_cmd, old.err, old.pid)
        self.assertIsNot(new, old)
        self.expire(1)
        writes = [args for name, args, _ in newer_cmd.calls if name == 'jog']
        self.assertEqual(writes, [], 'an old lease must not send a stop through a replacement Link')


class TestR427EndQueue(_Ws):
    def test_rejected_end_keeps_an_independent_stop_obligation(self):
        real = self.real_handle
        async def handle(msg, armed, conn_key=None):
            if msg.get('cmd') == 'zz_slow':
                # Occupy the client FIFO without owning the machine write lock.
                await asyncio.sleep(1.8)
                return {'ok': True}
            return await real(msg, armed, conn_key)
        gateway.handle_command = handle
        with mock.patch.object(gateway, '_WS_CMD_QUEUE_MAX', 1):
            with TestClient(gateway.app) as client, client.websocket_connect('/ws') as ws:
                self.arm(ws)
                ws.send_json({'cmd':'jog_cont','axis':0,'vel':5.0,'lease':1,'req_id':'start'})
                self.pump(ws, 2, until=lambda f:f.get('req_id')=='start')
                self.assertTrue(self.reply('start')['ok'])
                ws.send_json({'cmd':'zz_slow','req_id':'slow'})
                self.pump(ws, .1)
                for n in range(4):
                    ws.send_json({'cmd':'jog_lease_end','lease':100+n,'req_id':f'fill-{n}'})
                ws.send_json({'cmd':'jog_lease_end','lease':1,'req_id':'end'})
                self.pump(ws, 1, until=lambda f:f.get('req_id')=='end')
                self.assertIn('queue full', self.reply('end')['error'].lower())
                self.pump(ws, 2.1)
                self.assertIsNotNone(self.reply('slow'), 'FIFO has finished; this is not a busy write lock')
                self.assertTrue(any(w[0] == JS for w in self.writes()),
                                f'end was dropped, timer forgot it, no JOG_STOP: {self.writes()}')

