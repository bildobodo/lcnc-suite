"""R428: actual lease handlers, fake controller only."""
import asyncio
from unittest import mock
import gateway
from test_jog_lease_gateway import _Lease, JS, linuxcnc
from test_button_gates import _run


class TestR428Completion(_Lease):
    def test_queued_expiry_does_not_retry_a_reported_end_failure(self):
        self.assertTrue(self.jog(1)['ok'])
        attempts = []
        def jog(*args):
            if args[0] == JS:
                attempts.append(args)
                raise linuxcnc.error('stop refused')
            self.cmd.calls.append(('jog', args, {}))
        self.cmd.jog = jog
        tasks = []
        async def scenario():
            gateway._cmd_lock = asyncio.Lock()
            await gateway._cmd_lock.acquire()
            msg = self.receive({'cmd':'jog_lease_end','lease':1})
            end = asyncio.create_task(gateway.handle_command(msg, True, self.ck))
            await asyncio.sleep(0)  # the end waits for the write lock first
            self.run_out(1)
            with mock.patch.object(gateway, 'register_bg_task', tasks.append):
                gateway._on_lease_timer((self.ck, 1))
            await asyncio.sleep(0)  # the expiry now waits behind it
            gateway._cmd_lock.release()
            reply = await end
            await asyncio.gather(*tasks)
            return reply
        reply = _run(scenario())
        self.assertEqual(reply.get('stop_failed'), [0])
        self.assertEqual(len(attempts), 1, 'the settled failure was retried by the already queued expiry')

    def test_partial_start_cleanup_reports_its_failed_stop(self):
        msg = self.receive({'cmd':'jog_cont_multi','lease':1,
                            'axes':[{'axis':0,'vel':5.0},{'axis':1,'vel':5.0}]})
        def jog(*args):
            if args[0] == JS:
                raise linuxcnc.error('stop refused')
            self.cmd.calls.append(('jog',args,{}))
        self.cmd.jog = jog
        reply = self.at_the_write(msg, lambda: self.run_out(1), at=3)
        self.assertEqual(reply.get('stop_failed'), [0], reply)
        self.assertEqual(reply.get('error'), gateway.JOG_LEASE_STOP_FAILED)
