"""R429: failed stop lifetime and later writes, real handlers / fake controller."""
import gateway
from test_jog_lease_gateway import _Lease, JS, linuxcnc


class TestR429FailureLifetime(_Lease):
    def stops_fail_once(self):
        attempts = []
        def jog(*args):
            if args[0] == JS:
                attempts.append(args)
                if len(attempts) == 1:
                    raise linuxcnc.error('first stop refused')
            self.cmd.calls.append(('jog', args, {}))
        self.cmd.jog = jog
        return attempts

    def test_expiry_failure_is_not_retried_by_the_late_gesture_end(self):
        self.assertTrue(self.jog(1)['ok'])
        attempts = self.stops_fail_once()
        self.expire(1)
        self.assertEqual(self.notes[-1][1]['stop_failed'], [0])
        self.assertIsNone(self.lease(1))
        self.end(1)
        self.assertEqual(len(attempts), 1, 'settling erased the reported stop failure')

    def test_failed_change_does_not_admit_a_new_start_of_the_same_gesture(self):
        self.assertTrue(self.jog(1)['ok'])
        self.stops_fail_once()
        # Both frames can be received before the first failure reaches the page.
        first = self.receive({'cmd':'jog_change','lease':1,'stop':[0],'axes':[]})
        second = self.receive({'cmd':'jog_change','lease':1,'stop':[],
                               'axes':[{'axis':0,'vel':-5.0}]})
        self.assertEqual(self.send_as(first).get('stop_failed'), [0])
        result = self.send_as(second)
        self.assertFalse(result['ok'], result)
        self.assertEqual(len(self.starts()), 1)

    def test_newly_written_generation_is_not_exempted_from_its_expiry_stop(self):
        self.assertTrue(self.jog(1)['ok'])
        attempts = self.stops_fail_once()
        self.assertEqual(self.change(1, [0], []).get('stop_failed'), [0])
        old_generation = gateway._active_jogs[0][3]
        result = self.change(1, [], [{'axis':0,'vel':-5.0}])
        if not result['ok']:
            return  # refusing a new write under this failed gesture is correct too
        self.assertNotEqual(old_generation, gateway._active_jogs[0][3])
        self.expire(1)
        self.assertEqual(len(attempts), 2, {'notes':self.notes, 'booking':str(gateway._active_jogs)})
        self.assertNotIn(0, gateway._active_jogs)

    def test_explicit_operator_stop_still_reaches_the_failed_booking(self):
        self.assertTrue(self.jog(1)['ok'])
        attempts = self.stops_fail_once()
        self.expire(1)
        result = self.send_as({'cmd':'jog_stop','axis':0})
        self.assertTrue(result['ok'], result)
        self.assertEqual(len(attempts), 2)
        self.assertNotIn(0, gateway._active_jogs)
