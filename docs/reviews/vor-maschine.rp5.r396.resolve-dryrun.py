#!/usr/bin/env python3
"""5c dry run: resolve every evidence entry of functions.json to LISTED test ids of one run —
never to text. Rules under test (Fable, before 5c's build):
  exact     the evidence title equals a listed test's own title or its full title path
  fragment  the title is a part of exactly the listed tests' titles that contain it (each named)
  template  a parametric title (${..}, $name, %s, {name}) as a regex with capture groups,
            matched against the WHOLE title; every declared instance must equal a capture
browser: the gate's Chromium listing (list-run.json) and the Firefox core's (firefox-list.json)
unit: unit-light.list.json (+ unit-heavy.list.json of a merge gate)
gateway: pytest --collect-only node ids (the backend step's own collection)
native: the case name as a string constant in native_run.py / native_cases.py (ast)
script: live_drivers (separate dry run, R390)
    resolve-dryrun.py REPO GATE_LOGS MERGE_LOGS GATEWAY_COLLECT"""
import ast, json, re, sys
from collections import Counter
from pathlib import Path

repo, logs, mlogs, coll = map(Path, sys.argv[1:5])
fns = json.loads((repo / "scripts/inventory/functions.json").read_text())["functions"]
ev = [(f["id"], s["id"], e) for f in fns for s in f.get("statements", []) for e in s["evidence"]]


def pw_tests(listing: Path, project_default=None):
    out = []
    def walk(suite, path):
        for sp in suite.get("specs", []):
            for t in sp.get("tests", []):
                out.append({"file": sp["file"], "title": sp["title"], "path": " › ".join(path + [sp["title"]]),
                            "project": t.get("projectName") or project_default})
        for sub in suite.get("suites", []):
            walk(sub, path + [sub["title"]])
    for s in json.loads(listing.read_text())["suites"]:
        walk(s, [])
    return out


PARAM = re.compile(r"\$\{[^}]+\}|\$[A-Za-z_][\w.]*|%[sdifjoO]|\{[A-Za-z_]\w*\}")


def as_regex(title):
    parts, pos = [], 0
    for m in PARAM.finditer(title):
        parts.append(re.escape(title[pos:m.start()])); parts.append("(.+?)"); pos = m.end()
    parts.append(re.escape(title[pos:]))
    return re.compile("^" + "".join(parts) + "$")


def resolve(e, cands):
    """cands: [{'name': display, 'titles': [own title, full path]}] in the evidence's file."""
    t, inst = e["title"], e.get("instances")
    if inst or PARAM.search(t):
        rx = as_regex(t)
        bound, caps = [], set()
        for c in cands:
            for x in c["titles"]:
                m = rx.match(x)
                if m:
                    bound.append(c["name"]); caps.update(m.groups()); break
        if not bound:
            return "template", [], "no listed test matches the template"
        # a capture equals the instance — or the instance as vitest renders a
        # string ('start'); never a substring (A=3 is no capture of A=35)
        caps = caps | {c[1:-1] for c in caps if len(c) > 1 and c[0] == c[-1] == "'"}
        missing = [i for i in (inst or []) if i not in caps and not any(i in g for g in caps)]
        exact_missing = [i for i in (inst or []) if i not in caps]
        why = (f"instances not captured exactly: {exact_missing}" + (f" (not even inside a capture: {missing})" if missing else "")) if exact_missing else ""
        return "template", bound, why
    ex = [c["name"] for c in cands if t in c["titles"]]
    if ex:
        return "exact", ex, ""
    fr = [c["name"] for c in cands if any(t in x for x in c["titles"])]
    return ("fragment", fr, "" if fr else "not listed")


res = []
# browser
for listing, proj in ((logs / "list-run.json", "e2e"), (logs / "firefox-list.json", "firefox-core")):
    tests = pw_tests(listing, proj)
    for fid, sid, e in ev:
        if e["layer"] != "browser":
            continue
        cands = [{"name": f"{x['file']} › {x['path']} [{x['project']}]", "titles": [x["title"], x["path"]]}
                 for x in tests if x["file"] == e["file"]]
        if not cands and proj == "firefox-core":
            continue
        mode, bound, why = resolve(e, cands)
        res.append({"layer": "browser", "project": proj, "fn": fid, "st": sid, "file": e["file"], "title": e["title"],
                    "mode": mode, "bound": len(bound), "why": why, "names": bound[:6]})
# unit
ul = json.loads((logs / "unit-light.list.json").read_text())
uh = json.loads((mlogs / "unit-heavy.list.json").read_text()) if (mlogs / "unit-heavy.list.json").is_file() else []
for fid, sid, e in ev:
    if e["layer"] != "unit":
        continue
    cands = [{"name": x["name"], "titles": [x["name"].split(" > ")[-1], x["name"]]}
             for x in ul + uh if x["file"].endswith("/lcnc-webui/src/" + e["file"])]
    mode, bound, why = resolve(e, cands)
    res.append({"layer": "unit", "fn": fid, "st": sid, "file": e["file"], "title": e["title"], "mode": mode,
                "bound": len(bound), "why": why, "names": bound[:6], "in_heavy": any(x["file"].endswith(e["file"]) for x in uh)})
# gateway
ids = [l.strip() for l in coll.read_text().splitlines() if "::" in l]
for fid, sid, e in ev:
    if e["layer"] != "gateway":
        continue
    cands = [{"name": i, "titles": [i.split("::")[-1].split("[")[0]]} for i in ids if i.split("::")[0] == e["file"]]
    hits = [c["name"] for c in cands if e["title"] in c["titles"]]
    res.append({"layer": "gateway", "fn": fid, "st": sid, "file": e["file"], "title": e["title"], "mode": "exact",
                "bound": len(hits), "why": "" if hits else ("file not collected" if not cands else "not collected"),
                "names": hits[:6]})
# native: the case as a string constant
consts = set()
for f in ("scripts/native_run.py", "scripts/test_support/native_cases.py"):
    for n in ast.walk(ast.parse((repo / f).read_text())):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            consts.add(n.value)
        if isinstance(n, ast.JoinedStr):
            consts.add("".join(v.value if isinstance(v, ast.Constant) else "{}" for v in n.values))
for fid, sid, e in ev:
    if e["layer"] != "native":
        continue
    t = e["title"]
    ok = t in consts or any(("{}" in c and re.fullmatch(re.escape(c).replace(r"\{\}", ".+"), t)) for c in consts)
    res.append({"layer": "native", "fn": fid, "st": sid, "file": e["file"], "title": t, "mode": "constant" if t in consts else "f-string",
                "bound": 1 if ok else 0, "why": "" if ok else "no string constant names the case", "names": []})

summary = Counter((r["layer"], r.get("project"), r["mode"], "resolved" if r["bound"] and not r["why"] else "UNRESOLVED") for r in res)
print(json.dumps({"summary": {" / ".join(map(str, k)): v for k, v in sorted(summary.items(), key=str)},
                  "unresolved_or_why": [r for r in res if not r["bound"] or r["why"]],
                  "fragments": [r for r in res if r["mode"] == "fragment"],
                  "templates": [r for r in res if r["mode"] == "template"],
                  "multi_bound_exact": [r for r in res if r["mode"] == "exact" and r["bound"] > 1]},
                 indent=1, ensure_ascii=False))
