"""Red proofs for the jog-lease spec hardening (Codex R439/R440): each
mutation breaks ONE property the page-clock test holds; that test must fail.
Run from the tree's root under the heavy lock (each mutation rebuilds the
page and runs the one test); every file is restored byte-identical.

  python3 -I docs/reviews/jog-lease-hardening.mutations.py [name …]

The equivalent mutant named by Codex R439 (removing only clearInterval in
idleCheck — renewTick sends nothing without a live lease) is NOT here: it
changes nothing on the wire, so no red is asked of the wire test; the timer's
release is the unit test's (jogLease.test.ts).
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
SPEC = "e2e/jog-lease.spec.ts"
TITLE = "a held jog button names its lease, the page renews it, its release ends exactly that lease"

MUTS = {
    # MT439-03: the product cadence halved — the guard steps its OWN 100 ms
    "renew_every_200_ms": (WEB + "src/jogLease.ts", [(
        "export const RENEW_MS = 100;", "export const RENEW_MS = 200;")]),
    # a renewal that names no lease
    "renewal_without_ids": (WEB + "src/jogLease.ts", [(
        'send({ cmd: "jog_renew", ids: [...live.keys()].slice(0, RENEW_IDS_MAX) });',
        'send({ cmd: "jog_renew", ids: [] });')]),
    # the release does not end the lease on the wire
    "no_lease_end_at_release": (WEB + "src/jogLease.ts", [(
        '  live.delete(id);\n  l.sendEnd({ cmd: "jog_lease_end", lease: id });\n  idleCheck();',
        '  live.delete(id);\n  idleCheck();')]),
    # MT439-03 mutant 4: an ENDED lease goes on being renewed (its end is sent,
    # but it stays live — renewTick names it again)
    "ended_lease_still_renewed": (WEB + "src/jogLease.ts", [(
        '  if (!l) return;\n  live.delete(id);\n  l.sendEnd({ cmd: "jog_lease_end", lease: id });',
        '  if (!l) return;\n  l.sendEnd({ cmd: "jog_lease_end", lease: id });')]),
    # MT439-04: a renewal from the WORKER's real-time heartbeat (not the page's
    # clock): the worker remembers the last started lease and renews it right
    # before each heartbeat — its first renewal is on the socket before the
    # second heartbeat after the start
    "renewal_in_the_worker_heartbeat": (WEB + "src/wsWorker.ts", [
        ("        const seq = ++hbSeq;\n        ws.send(`{\"cmd\":\"heartbeat\",\"seq\":${seq}}`);",
         "        const seq = ++hbSeq;\n"
         "        if (mutLease != null) ws.send(JSON.stringify({ cmd: \"jog_renew\", ids: [mutLease] }));\n"
         "        ws.send(`{\"cmd\":\"heartbeat\",\"seq\":${seq}}`);"),
        ("    case \"send\":\n      if (ws && ws.readyState === WebSocket.OPEN) {\n        try {\n          ws.send(msg.payload);",
         "    case \"send\":\n      if (ws && ws.readyState === WebSocket.OPEN) {\n        try {\n"
         "          try { const m = JSON.parse(msg.payload); if (m.cmd === \"jog_cont\" && Number.isInteger(m.lease)) mutLease = m.lease; } catch { /* not JSON */ }\n"
         "          ws.send(msg.payload);"),
        ("let hbTimer: ReturnType<typeof setInterval> | null = null;",
         "let hbTimer: ReturnType<typeof setInterval> | null = null;\nlet mutLease: number | null = null;"),
    ]),
}


def run_spec():
    b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
    if b.returncode != 0:
        return None, "the build failed: " + (b.stdout + b.stderr)[-400:]
    r = subprocess.run(["npx", "playwright", "test", SPEC, "-g", TITLE, "--workers=1", "--retries=0", "--reporter=line"],
                       cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
    return r.returncode != 0, (r.stdout + r.stderr)[-600:]


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            red, tail = run_spec()
        finally:
            f.write_bytes(orig)
        out[name] = {"red": red, "tail": tail}
        print(json.dumps({"mutation": name, "red": red,
                          "why": None if red is None else tail.splitlines()[-12:] if red else tail[-300:]}), flush=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, timeout=900)
    print(json.dumps({"total": len(out), "red": sum(1 for v in out.values() if v["red"])}))
    return 0 if all(v["red"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
