"""Driver-side mutants for the latch-sticky contract: each applied alone,
the latch tests of test_native_stage.py run, the tree restored."""
import subprocess, xml.etree.ElementTree as ET
from pathlib import Path
T = Path.home() / "lcnc-suite-latch"
PY = str(T / "lcnc-gateway/.venv/bin/python3")
SC = "scripts/test_support/servo_cases.py"
NR = "scripts/native_run.py"
LS = "scripts/test_support/live_session.py"
MUTANTS = {
 "D1 old by the read's START": (SC, 'elif tb["read"][1] < s0:', 'elif tb["read"][0] < s0:'),
 "D2 new by the read's END": (SC, 'elif tb["read"][0] > s1:', 'elif tb["read"][1] > s1:'),
 "D3 baseline age by read1": (SC, 'and receipt - tb["read"][0] <= LATCH_BASELINE_MAX_S:', 'and receipt - tb["read"][1] <= LATCH_BASELINE_MAX_S:'),
 "D4 latched need not be boolean": (SC, 'elif not isinstance(tb.get("latched"), bool):', 'elif "latched" not in tb:'),
 "D5 the invariant only for new frames": (SC, 'elif cls[i] != "gap" and tb["latched"] is True and not trip:', 'elif cls[i] == "new" and tb["latched"] is True and not trip:'),
 "D6 lower bound from the receipt": (SC, 'lower, upper = tb["t_pub"] - s1, receipt - s0', 'lower, upper = receipt - s1, receipt - s0'),
 "D7 a gap before never matters": (SC, 'if lower > LATCH_DEADLINE_S and not gap_before(first_new):', 'if lower > LATCH_DEADLINE_S:'),
 "D8 any refusal of the reset will do": (SC, 'if TRIP_GATE_REASON not in str(reset_reply.get("error") or ""):', 'if False:'),
 "D9 gaps never incomplete": (SC, '    if gaps:\n        incomplete.append(f"{len(gaps)} measurement gap(s)")\n', ''),
 "D10 stale frames valid": (SC, '            elif tb.get("stale") is not False:\n                why = "the reader\'s snapshot was stale"\n', ''),
 "D11 the row judged before the acknowledgement": (NR, '                try:\n                    # the section ends in the acknowledgement\'s send path\n                    c.request("safety_trip_ack", id=c.safety_trip["id"], mark=end_at)\n                finally:\n                    form_sticky()\n',
                                                 '                form_sticky()\n                c.request("safety_trip_ack", id=c.safety_trip["id"], mark=end_at)\n'),
 "D12 no row when the step ends early": (NR, '        finally:\n            # every other way out', '        except BaseException:\n            raise\n        else:\n            # every other way out'),
 "D13 seq may fall": (SC, '            elif last_seq is not None and seq < last_seq:', '            elif False:'),
 "D14 the stamp outside the record lock": (LS, '            with self.record_lock:\n                now = time.monotonic()\n', '            now = time.monotonic()\n            with self.record_lock:\n'),
 "D15 the mark after the send": (LS, '                mark((time.monotonic(), len(self.basis_history)))\n                self.send({"cmd": cmd, **kwargs})\n', '                self.send({"cmd": cmd, **kwargs})\n                mark((time.monotonic(), len(self.basis_history)))\n'),
 "D16 the mark without the lock": (LS, '        with self.record_lock:\n            return time.monotonic(), len(self.basis_history)\n', '        return time.monotonic(), len(self.basis_history)\n'),
 "D17 the trigger after cont() returns": (NR, '                    s1 = sigcont[1]\n', '                    s1 = time.monotonic()\n'),
 "D18 the trigger at the bracket's start": (NR, '                    s1 = sigcont[1]\n', '                    s1 = sigcont[0]\n'),
 "D19 no bracket check": (NR, '                    if not (isinstance(sigcont, (list, tuple)) and len(sigcont) == 2\n                            and sc._finite(*sigcont)):\n', '                    if False:\n'),
 "D20 the row formed twice": (NR, '            if "row" in sticky:\n                return\n            end_at(c.mark())\n', '            end_at(c.mark())\n'),
 "D21 a later mark wins": (NR, '            end_mark.setdefault("mark", mark)\n', '            end_mark["mark"] = mark\n'),
 "D22 the send outside the mark's region": (LS, '            with self.record_lock:\n                mark((time.monotonic(), len(self.basis_history)))\n                self.send({"cmd": cmd, **kwargs})\n', '            with self.record_lock:\n                mark((time.monotonic(), len(self.basis_history)))\n            self.send({"cmd": cmd, **kwargs})\n'),
 "D23 the same-cycle row only after a clean outage": (NR, '                same = sc.eval_latch_same_cycle("latch-same-cycle.delayed-order" if delayed else "latch-same-cycle",\n                                                sec_out, delayed=delayed)\n                rows.append(tag(same))\n            _servo_failed(box, rows, "the latch outage")\n', '            same = sc.eval_latch_same_cycle("latch-same-cycle.delayed-order" if delayed else "latch-same-cycle",\n                                            sec_out, delayed=delayed)\n            rows.append(tag(same))\n            _servo_failed(box, rows, "the latch outage")\n'),
}
K = ("latch or sticky or c1_ or c2_ or c3_ or c4_ or c5_ or codex_s or measurement_gap or baseline or classification "
     "or sigcont or backlog or provenance or boolean or deadline or proven_failure or known_failure or survives "
     "or shown_by_no_frame or acknowledgement or mark or bracket or judgement or live_session or once "
     "or cont_writes or recovery_entry or end_failure or bad_frame or outage_start or continue")
out = []
for name, (rel, old, new) in MUTANTS.items():
    p = T / rel
    src = p.read_text()
    assert src.count(old) == 1, (name, src.count(old))
    p.write_text(src.replace(old, new))
    try:
        xml = Path("/tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad/mutd.xml")
        subprocess.run([PY, "-m", "pytest", "-p", "no:cacheprovider", f"--junitxml={xml}", "scripts/test_native_stage.py",
                        "-k", K], cwd=T, capture_output=True, timeout=900)
        red = []
        for c in ET.parse(xml).getroot().iter("testcase"):
            f = c.find("failure") if c.find("failure") is not None else c.find("error")
            if f is not None:
                red.append(f"{c.get('name')}: {((f.get('message') or '').splitlines() or [''])[0][:140]}")
        out.append(f"{name}: {len(red)} red" + "".join(f"\n    {r}" for r in red[:6]) + (f"\n    … {len(red)-6} more" if len(red) > 6 else ""))
    finally:
        p.write_text(src)
print("\n".join(out))
