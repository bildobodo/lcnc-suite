"""Client mutation (P1b red proof): the WORKER renews the leases itself — the
browser guard 'a blocked main thread renews nothing while the worker's
heartbeat goes on' must turn red. Applies to / restores lcnc-webui/src/wsWorker.ts."""
import pathlib, sys
p = pathlib.Path(sys.argv[2]) / "lcnc-webui/src/wsWorker.ts"
orig = p.with_suffix(".ts.orig-mut")
if sys.argv[1] == "apply":
    s = p.read_text()
    orig.write_text(s)
    old = '''    case "send":
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg.payload);'''
    assert s.count(old) == 1
    s = s.replace(old, '''    case "send":
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          // MUTATION: the worker keeps the lease alive itself
          const m = /"lease":(\\d+)/.exec(msg.payload);
          if (m && /"cmd":"jog_cont/.test(msg.payload)) {
            const id = Number(m[1]);
            setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(`{"cmd":"jog_renew","ids":[${id}]}`); }, 100);
          }
          ws.send(msg.payload);''')
    p.write_text(s)
    print("applied")
else:
    p.write_text(orig.read_text())
    orig.unlink()
    print("restored")
