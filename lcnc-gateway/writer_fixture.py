"""Test support (button gates BG-14): the writer of a protected HTTP write.

Program, macro and tool-table writes and the protected settings name their
WebSocket connection (`conn_key`) and are admitted at the commit — an armed,
connected writer and, for the tool table, a FRESH reader with no tool change
asking for a tool. A test of such a route registers one here; its conn_key
is what the route receives (`x_conn_key=` or the X-Conn-Key header).
"""
from unittest import mock

import gateway
from ws_fanout import ClientState


def armed_writer(testcase, *, tool_change=False) -> str:
    """Register an armed connection for the test's duration and return its
    conn_key. `tool_change`: the fresh reader's tool-change pin (None = do
    not touch the reader). No start claim is open meanwhile: the status
    poller that releases them never runs in a test, so earlier tests leave
    theirs behind (restored afterwards)."""
    claims = list(gateway._source_claims)
    gateway._source_claims.clear()
    testcase.addCleanup(lambda: gateway._source_claims.__setitem__(slice(None), claims))
    client = ClientState(ip="test-writer", ws=None, armed=True)
    slot = -(id(client) % 1_000_000) - 1   # negative: never a real client id
    gateway._clients[slot] = client
    testcase.addCleanup(gateway._clients.pop, slot, None)
    # an idle interpreter, read now (the admission polls STAT)
    stat = gateway.STAT
    if stat is not None:
        p = mock.patch.object(stat, "interp_state", gateway.linuxcnc.INTERP_IDLE, create=True)
        p.start()
        testcase.addCleanup(p.stop)
    if tool_change is not None:
        inner = gateway._reader_get
        for name, value in (("_reader_is_stale", lambda: False),
                            ("_reader_get", lambda f: tool_change if f == "tool_change" else inner(f))):
            p = mock.patch.object(gateway, name, value)
            p.start()
            testcase.addCleanup(p.stop)
    return client.conn_key
