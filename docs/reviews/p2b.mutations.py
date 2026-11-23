"""P2b red proofs (plan v4, Codex R439–R442): each mutation breaks ONE rule;
its named guard must fail AT that rule. Run from the tree's root; every file
is restored byte-identical. Unit guards run light; a browser guard (pw)
rebuilds the page and runs its spec — under the heavy lock.

  python3 -I docs/reviews/p2b.mutations.py [name …]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
V = WEB + "src/viewer/"


def vt(file, name, at):
    return ("vitest", [file, name, at])


def py(node, at):
    return ("pytest", [node, at])


GW = "lcnc-gateway/"
CD = "test_controller_done.py::"


MUTS = {
    # ---- P2b-1: the collision model survives a tool change
    "the_model_base_not_the_runs": (V + "collision.ts", [(
        "(opts.baseTool ?? model.baseTool)", "(model.baseTool)")],
        [vt("src/viewer/collision.test.ts", "sweeps with the run's tool", "on the resident model")]),
    "the_tool_installed_once_not_per_pose": (V + "collision.ts", [(
        "    applyTool(toolSeg);\n    liftJoints(px, py, pz, pa, pb, pc, model, oSeg, tloSeg);",
        "    liftJoints(px, py, pz, pa, pb, pc, model, oSeg, tloSeg);")],
        [vt("src/viewer/collision.test.ts", "two runs interleaved", "interleaved, order")]),
    "a_tool_change_rebuilds": (V + "collisionWorker.ts", [(
        "    } else if (_resident && _resident.key === modelKey && (_resident.model.toolBodyIdx >= 0) === !!tool) {",
        "    } else if (_resident && _resident.key === modelKey + JSON.stringify(tool)) {")],
        [vt("src/viewer/collisionWorker.test.ts", "a tool change rebuilds no model", "another tool: the resident model")]),
    "the_structure_ignored": (V + "collisionWorker.ts", [(
        "    } else if (_resident && _resident.key === modelKey && (_resident.model.toolBodyIdx >= 0) === !!tool) {",
        "    } else if (_resident && _resident.key === modelKey) {")],
        [vt("src/viewer/collisionWorker.test.ts", "a tool change rebuilds no model", "needBodies")]),
    "the_key_ignores_a_reloaded_mesh": (V + "collisionModelKey.ts", [(
        "p.rotate ?? null, p.stock ? 1 : 0, p.mesh, p.proxy]", "p.rotate ?? null, p.stock ? 1 : 0, p.proxy]")],
        [vt("src/viewer/collisionModelKey.test.ts", "changes with every input", "a reloaded mesh")]),
    "the_key_ignores_the_machine": (V + "collisionModelKey.ts", [(
        "  return JSON.stringify([machine, parts.map(", "  return JSON.stringify([null, parts.map(")],
        [vt("src/viewer/collisionModelKey.test.ts", "changes with every input", "kinematics")]),
    # ---- P2b-3 (Rest A, Codex R441): ONE completion decision
    "a_later_echo_ends_the_command": (GW + "gateway_util.py", [(
        "    if seen and done and echo >= serial:\n        return \"done\", (since, proof_now)",
        "    if seen and (done or echo > serial):\n        return \"done\", (since, proof_now)")],
        [py(CD + "TestCodexR441Table::test_a_later_echo_still_reading_is_no_end", "AssertionError")]),
    "one_poll_proves_the_own_error": (GW + "gateway_util.py", [(
        "        if polled_at - since >= proof_window_s:\n            return \"error\", (since, proof_now)",
        "        if polled_at - since >= 0:\n            return \"error\", (since, proof_now)")],
        [py(CD + "TestCodexR441Table::test_the_own_error_needs_two_polls_apart", "nor two within the window")]),
    "a_later_error_is_ours": (GW + "gateway_util.py", [(
        "    if seen and err_quiet and echo == serial:", "    if seen and idle and state == rcs_error and echo >= serial:")],
        [py(CD + "TestCodexR441Table::test_a_later_error_even_quiet_is_not_the_own", "AssertionError")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln]


def run_guard(kind, args):
    if kind == "vitest":
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr
        return r.returncode != 0, out, args[2]
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    raise SystemExit(f"unknown guard kind {kind}")


def main(names):
    out = {}
    for name in names or list(MUTS):
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards]
        finally:
            f.write_bytes(orig)
        red = all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "at_rule": at_rule,
                          "failures": [failures(o)[:3] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
