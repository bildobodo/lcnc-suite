"""GET /ready — the browsers' WS reconnect gate (wsWorker.ts, 2026-09-23).

After a WebSocket close the client asks here over plain HTTP before it opens a
socket again, because every FAILED WebSocket attempt feeds the browser's own
reconnect backoff (Firefox: up to 60 s, per IP:port, surviving reloads). The
probe must therefore answer whatever the auth and origin configuration is: a
probe the token or CORS rejects would read as "gateway down" forever and the
tab would never reconnect.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


class TestReadyProbe(unittest.TestCase):
    def test_empty_204_with_open_cors(self):
        with TestClient(gateway.app) as client:
            r = client.get("/ready", headers={"Origin": "http://192.168.64.4:5173"})
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r.content, b"")
        self.assertEqual(r.headers.get("access-control-allow-origin"), "*")

    def test_no_token_needed(self):
        with mock.patch.object(gateway, "WEBUI_TOKEN", "secret-token"):
            with TestClient(gateway.app) as client:
                r = client.get("/ready")
        self.assertEqual(r.status_code, 204)

    def test_not_traced_per_request(self):
        # 1 Hz per tab while a socket is down: the routine http.start/end pair
        # stays off the trace bus, like /telemetry.
        with mock.patch.object(gateway._trace, "emit") as emit:
            with TestClient(gateway.app) as client:
                client.get("/ready")
        traced = [c for c in emit.call_args_list
                  if c.args and c.args[0] in ("http.start", "http.end")
                  and c.kwargs.get("path") == "/ready"]
        self.assertEqual(traced, [])

    def test_readable_under_an_origin_allow_list(self):
        # CORS is configured at import time, so a fresh interpreter with an
        # allow-list that does NOT contain the dev page's LAN origin.
        code = (
            "import fake_linuxcnc; fake_linuxcnc.install()\n"
            "import gateway\n"
            "from fastapi.testclient import TestClient\n"
            "with TestClient(gateway.app) as c:\n"
            "    r = c.get('/ready', headers={'Origin': 'http://192.168.64.4:5173'})\n"
            "print('READY-RESULT', r.status_code, r.headers.get('access-control-allow-origin'))\n"
        )
        with tempfile.TemporaryDirectory() as logdir:
            env = dict(os.environ,
                       LCNC_WEBUI_ALLOWED_ORIGINS="http://other.example:9000",
                       LCNC_LOG_DIR=logdir)
            out = subprocess.run([sys.executable, "-c", code], cwd=HERE, env=env,
                                 capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        # The gateway's own diagnostics ([GC] …) share stdout — find the marker.
        result = [ln for ln in out.stdout.splitlines() if ln.startswith("READY-RESULT ")]
        self.assertEqual(result, ["READY-RESULT 204 *"], out.stdout[-2000:])


if __name__ == "__main__":
    unittest.main()
