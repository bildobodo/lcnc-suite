"""The ONE decision what a fresh status proves about a written command
(gateway_util.controller_done — P2b-3, Codex R441): the start claims and the
action observers share it. Codex R441's table (a command with serial 7), its
positive controls, unread fields, the two-poll error window and the Link."""
import unittest

from gateway_util import controller_done

DONE, EXEC, ERROR = 1, 2, 3
IDLE, READING = 1, 2
EXEC_DONE, EXEC_WAITING = 2, 3
W = 0.02   # the start claims' error window (gateway._CLAIM_ERROR_PROOF_S)


def obs(**over):
    o = {"state": "sent", "serial": 7, "sent_t": 10.0, "link_seq": 1, "err_since": None, "err_proof": None}
    o.update(over)
    return o


def st(**over):
    f = {"echo": 7, "state": DONE, "interp_state": IDLE, "queued": 0, "exec_state": EXEC_DONE}
    f.update(over)
    return f


def two_polls(fields, o=None, seq=1):
    """The outcomes of two polls of the same status, the window elapsed
    between them (the mark carried) — a "no end" must hold over both."""
    o = o or obs()
    how1, mark = controller_done(fields, o, 11.0, seq, W)
    how2, _ = controller_done(fields, {**o, "err_since": mark[0], "err_proof": mark[1]}, 11.03, seq, W)
    return [how1, how2]


class TestCodexR441Table(unittest.TestCase):
    def test_a_later_echo_still_reading_is_no_end(self):
        self.assertEqual(two_polls(st(echo=8, state=EXEC, interp_state=READING)), [None, None])

    def test_a_later_error_with_an_mdi_queued_is_no_end(self):
        self.assertEqual(two_polls(st(echo=8, state=ERROR, queued=1)), [None, None])

    def test_a_later_error_even_quiet_is_not_the_own(self):
        self.assertEqual(two_polls(st(echo=8, state=ERROR)), [None, None])

    def test_the_own_echo_error_with_an_mdi_queued_is_no_end(self):
        self.assertEqual(two_polls(st(echo=7, state=ERROR, queued=1)), [None, None])

    def test_the_own_error_before_execution_is_done_is_no_end(self):
        self.assertEqual(two_polls(st(echo=7, state=ERROR, exec_state=EXEC_WAITING)), [None, None])

    def test_the_own_error_needs_two_polls_apart(self):
        err = st(echo=7, state=ERROR)
        how, mark = controller_done(err, obs(), 11.0, 1, W)
        self.assertEqual(how, None, "one poll is no proof")
        self.assertEqual(mark, (11.0, ("error", 1)))
        how, mark2 = controller_done(err, obs(err_since=mark[0], err_proof=mark[1]), 11.005, 1, W)
        self.assertEqual(how, None, "nor two within the window")
        self.assertEqual(mark2, mark, "the window keeps its start")
        how, _ = controller_done(err, obs(err_since=mark[0], err_proof=mark[1]), 11.03, 1, W)
        self.assertEqual(how, "error")
        # a poll without the proof in between starts it again
        how, reset = controller_done(st(echo=7, state=ERROR, queued=1), obs(err_since=mark[0], err_proof=mark[1]), 11.02, 1, W)
        self.assertEqual((how, reset), (None, (None, None)))

    def test_positive_controls_done_and_idle_at_the_own_or_a_later_echo(self):
        self.assertEqual(controller_done(st(echo=7), obs(), 11.0, 1, W)[0], "done")
        self.assertEqual(controller_done(st(echo=8), obs(), 11.0, 1, W)[0], "done")


class TestNoProof(unittest.TestCase):
    def test_unread_fields_prove_nothing(self):
        for f in ("echo", "state", "interp_state"):
            self.assertEqual(controller_done(st(**{f: None}), obs(), 11.0, 1, W)[0], None, f)
        for f in ("queued", "exec_state"):
            self.assertEqual(controller_done(st(echo=7, state=ERROR, **{f: None}), obs(), 11.0, 1, W)[0], None, f)

    def test_a_poll_begun_before_the_write_proves_nothing(self):
        self.assertEqual(controller_done(st(), obs(sent_t=12.0), 11.0, 1, W)[0], None)

    def test_a_command_not_yet_written_has_no_end(self):
        self.assertEqual(controller_done(st(), obs(state="pending", serial=None, sent_t=None), 11.0, 1, W)[0], None)

    def test_an_echo_below_the_serial_is_no_end(self):
        self.assertEqual(controller_done(st(echo=6), obs(), 11.0, 1, W)[0], None)


class TestAnotherLink(unittest.TestCase):
    def test_written_on_an_earlier_link_ends_only_relinked_over_the_window(self):
        o = obs(link_seq=1)
        how, mark = controller_done(st(echo=1), o, 11.0, 2, W)
        self.assertEqual((how, mark), (None, (11.0, ("relinked", 2))), "no serial comparison across Links")
        how, _ = controller_done(st(echo=1), obs(link_seq=1, err_since=11.0, err_proof=("relinked", 2)), 11.03, 2, W)
        self.assertEqual(how, "relinked")
        # an error-proof mark of the old Link never shortens the new one's window
        how, mark = controller_done(st(echo=1), obs(link_seq=1, err_since=10.0, err_proof=("error", 1)), 11.0, 2, W)
        self.assertEqual((how, mark), (None, (11.0, ("relinked", 2))))


if __name__ == "__main__":
    unittest.main()
