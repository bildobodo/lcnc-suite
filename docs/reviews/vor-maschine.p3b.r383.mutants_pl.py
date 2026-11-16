"""Offline mutants for probe live (plan R380–R381): each applied alone, the
probe-live tests of test_native_stage.py run, the tree restored. Usage:
python3 mutants_pl.py <tree>"""
import subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
T = Path(sys.argv[1]).resolve()
PY = str(T / "lcnc-gateway/.venv/bin/python3")
NC = "scripts/test_support/native_cases.py"
NR = "scripts/native_run.py"
LS = "scripts/test_support/live_session.py"
MUTANTS = {
 "P1 the reader reads only trace.ndjson": (NR, 'TRACE_FILES = ("trace.ndjson",) + tuple(f"trace.ndjson.{i}" for i in range(1, 6))', 'TRACE_FILES = ("trace.ndjson",)'),
 "P2 a mark of any pid": (NC, '(r.get("tag"), r.get("proc"), r.get("pid")) != ("client.diag", MARK_PROC, pid)', '(r.get("tag"), r.get("proc")) != ("client.diag", MARK_PROC)'),
 "P3 damaged lines skipped": (NC, '            except ValueError:\n                rec = None\n            recs.append(rec if isinstance(rec, dict) else None)', '            except ValueError:\n                continue\n            if isinstance(rec, dict):\n                recs.append(rec)'),
 "P4 marks in two files framed": (NC, '    if si != ei:\n        return out(', '    if False:\n        return out('),
 "P5 the job's line unchecked": (NC, 'if jobs[0].get("cmd") != cmd or jobs[0].get("line") != line:', 'if jobs[0].get("cmd") != cmd:'),
 "P6 #3116 not required": (NC, '    want["3116"] = 0.0\n', ''),
 "P7 a lock before the cursor counts": (NC, 'lock = next((t for t, st in frames[cursor:] if st.get("feed_override_enabled") is False\n', 'lock = next((t for t, st in frames if st.get("feed_override_enabled") is False\n'),
 "P8 no baseline needed (evaluation)": (NC, '    if base is not True:\n        return _row(case, "incomplete", f"no free override baseline', '    if False:\n        return _row(case, "incomplete", f"no free override baseline'),
 "P9 no baseline needed (the send)": (NR, '        if base is not True:\n            raise Refused(f"{case}: no free override baseline', '        if False:\n            raise Refused(f"{case}: no free override baseline'),
 "P10 no restore after a failure": (NR, '    except Exception as e:  # noqa: BLE001 — the restore first, then the step ends with its rows\n        failure = e\n    rows.append(_probe_run_restore(ctx, c, switches0, first))', '    except Exception as e:  # noqa: BLE001 — the restore first, then the step ends with its rows\n        raise StepFailed(rows, str(e)) from e\n    rows.append(_probe_run_restore(ctx, c, switches0, first))'),
 "P11 a restore after a trip": (NR, '    if c.safety_trip is not None:\n        return "a safety trip waits"', '    if False:\n        return "a safety trip waits"'),
 "P12 the switch's refusal not required": (NC, '        if len(offs) != 1 or offs[0].get("cmd") != off_cmd:', '        if False:'),
 "P13 a refusal may act": (NC, '    if acted:\n        return _row(case, "FAIL", f"the refused command acted', '    if False:\n        return _row(case, "FAIL", f"the refused command acted'),
 "P14 the state around a refusal unchecked": (NC, '    if changed:\n        return _row(case, "FAIL", "changed by a refused command', '    if False:\n        return _row(case, "FAIL", "changed by a refused command'),
 "P15 the miss plants before its baseline": (NR, '            _over_plate(c, plate, over)\n            _override_free(c)\n            for line in plant:\n                _short(c, line)\n            if plant and _read_params(c, [5070])[5070] != 0:\n                raise Refused(f"{case}: #5070 not planted 0")\n', '            for line in plant:\n                _short(c, line)\n            if plant and _read_params(c, [5070])[5070] != 0:\n                raise Refused(f"{case}: #5070 not planted 0")\n            _over_plate(c, plate, over)\n            _override_free(c)\n'),
 "P16 a value naming 3116 planted": (NR, '    named = [item for item in items if "3116" in item]', '    named = []'),
 "P17 probe_run: the baseline after the plant's read-back": (NR, '            _over_plate(c, plate, over)\n            _override_free(c)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            s = _snapshot(c, numbers)\n', '            _over_plate(c, plate, over)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            s = _snapshot(c, numbers)\n            _override_free(c)\n'),
 "P18 probe_run: the baseline between plant and read-back": (NR, '            _over_plate(c, plate, over)\n            _override_free(c)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n', '            _over_plate(c, plate, over)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            _override_free(c)\n'),
 "P19 the scan: the baseline after the plant": (NR, '            _override_free(c)\n            _plant(c, SCAN_PLANT)\n', '            _plant(c, SCAN_PLANT)\n            _override_free(c)\n'),
 "P20 the scan: the baseline after the read-back": (NR, '            _override_free(c)\n            _plant(c, SCAN_PLANT)\n            s0 = _snapshot(c, sorted(values))\n', '            _plant(c, SCAN_PLANT)\n            s0 = _snapshot(c, sorted(values))\n            _override_free(c)\n'),
 "P21 the read's tag may name 3116": (NR, '        while "3116" in f"(DEBUG,NATIVE{k} {body})":\n            k += 1\n', ''),
 "P22 the hit reads before its failure finish": (NR, '        if r["error"]:\n            # the wait failed: nothing read — the restore\'s finish (abort,', '        if False:\n            # the wait failed: nothing read — the restore\'s finish (abort,'),
 "P23 the miss reads before its failure finish": (NR, '        if r["error"]:\n            rows += [nc.combine("probe-run-miss"', '        if False:\n            rows += [nc.combine("probe-run-miss"'),
 "P24 an old start reads before its failure finish": (NR, '            if r["error"]:\n                # the wait failed: nothing read — abort and standstill first', '            if False:\n                # the wait failed: nothing read — abort and standstill first'),
 "P25 an old start's raise without a finish": (NR, '            except Exception:\n                # every exit of a start ends in the finish (Codex R382 VM-I22)\n                rows.append(_finish_row(f"{case}.finish", _finish(c, [])))\n                raise', '            except Exception:\n                raise'),
 "P26 the scan reads before its failure finish": (NR, '    if r["error"]:\n        # the wait failed: nothing read — the cleanup\'s finish (abort,', '    if False:\n        # the wait failed: nothing read — the cleanup\'s finish (abort,'),
 "P27 no admission after the standstill wait": (NR, '    why = _lost(c) or (None if standing else f"no standstill within {STAND_S} s after the abort")', '    why = None if standing else f"no standstill within {STAND_S} s after the abort"'),
 "P28 no admission after a step": (NR, '        why = _lost(c)\n        if why:\n            return stop(why, i + 1)\n', ''),
 "P29 no standstill before each step": (NR, '        if i:\n            standing = _standstill(c, STAND_S)', '        if False:\n            standing = _standstill(c, STAND_S)'),
 "P30 the finish without its abort": (NR, '        c.request("abort")\n    except Exception as e:  # noqa: BLE001 — named, nothing more is done\n        return stop(', '        pass\n    except Exception as e:  # noqa: BLE001 — named, nothing more is done\n        return stop('),
 "P31 the cursor before the send": (NR, '    reply, _ = _when_free(c, cmd, before=bounds, at_send=at_send, **payload)', '    at_send((time.monotonic(), 0))\n    reply, _ = _when_free(c, cmd, before=bounds, **payload)'),
 "P32 frames appended outside the record lock": (LS, '                if self.keep is not None:\n                    self.frames.append((now, {k: self.status.get(k) for k in self.keep}))\n            if isinstance(msg.get("toolsetter_booking"), dict):', '            if self.keep is not None:\n                self.frames.append((now, {k: self.status.get(k) for k in self.keep}))\n            if isinstance(msg.get("toolsetter_booking"), dict):'),
 "P33 a lock stamped before the send counts": (NC, '\n                 and (t_send is None or t > t_send)), None)', '), None)'),
 "P34 the time from the last frame, not the send": (NC, '    since, origin = (t_send, "the send") if t_send is not None else', '    since, origin = (frames[cursor - 1][0], "the send") if t_send is not None else'),
}
K = ("window or probe_start or refusal_changes or refused_job or trace_files or probe_run_case or probe_job_is_sent "
     "or surface_step or surface_job or planted_5070 or job_window or plant_never_names or plants_after or read_never_names "
     "or old_probe_start or probe_run_start_whose or scan_whose or admission or judged_afresh or record_lock "
     "or actual_send or timed_from or override_free_in_a_status")
out = []
for name, (rel, old, new) in MUTANTS.items():
    p = T / rel
    src = p.read_text()
    assert src.count(old) == 1, (name, src.count(old))
    p.write_text(src.replace(old, new))
    try:
        xml = T.parent / "claude-work/p3b-probe/mut.xml"
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
