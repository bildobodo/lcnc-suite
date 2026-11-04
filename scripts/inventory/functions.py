"""The function inventory: every operator function, the atoms it owns, its
statements and their evidence (Codex R265–R269).

functions.json is kept by hand; the atoms come from the generators
(atoms.web.json from webAtoms.test.ts, atoms.py.json from py_atoms.py) and
the operator's table docs/inventory/funktionen.md is rendered from both —
never kept by hand.

A claim is an exact atom id or a pattern with its pinned count
(`control:NumberKeypadStrip.vue|*=24`; only `*` is special). A new atom inside
a pattern changes its count: the guard turns red instead of the pattern
quietly taking it. Every atom is claimed by exactly ONE function (its primary
owner); a function names the atoms it shares in `uses`.

    python3 -I scripts/inventory/functions.py           # the problems
    python3 -I scripts/inventory/functions.py --write   # render the table
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TABLE = ROOT / "docs/inventory/funktionen.md"

# Where the operator meets a control, by its component (the table's
# "Bedienort"); a component with controls and no place fails the guard.
PLACES = {
    "App.vue": "Hauptfenster (Kopf, Banner, MDI, Dialoge)", "SafetyStrip.vue": "Leiste › Sicherheit",
    "JogStrip.vue": "Leiste › Jog", "SetupStrip.vue": "Leiste › Setup", "SetupActions.vue": "Leiste › Setup",
    "OverridesStrip.vue": "Leiste › Overrides", "SpindleStrip.vue": "Leiste › Spindel", "ToolStrip.vue": "Leiste › Werkzeug",
    "GcodePanel.vue": "Tab „Program“", "FileBrowser.vue": "Tab „Program“ › Dateien", "CodeEditor.vue": "Editor",
    "ProbePanel.vue": "Tab „Probing“", "ToolsetterSettings.vue": "Tab „Probing“ › Toolsetter", "OffsetPanel.vue": "Tab „Offsets“",
    "ToolTablePanel.vue": "Tab „Tools“", "MacrosPanel.vue": "Tab „Macros“", "MacroBar.vue": "Makro-Leiste", "SimPanel.vue": "Tab „Sim“",
    "ThreeViewer.vue": "3D-Ansicht", "ViewCube.vue": "3D-Ansicht › Würfel", "ScrubBar.vue": "3D-Ansicht › Zeitleiste",
    "CameraPip.vue": "3D-Ansicht › Kamerabild", "SettingsPanel.vue": "Einstellungen", "KeyboardTab.vue": "Einstellungen › Tastatur",
    "GamepadTab.vue": "Einstellungen › Gamepad", "GamepadMapWizard.vue": "Einstellungen › Gamepad", "HalshowTab.vue": "Einstellungen › HAL",
    "DebugTab.vue": "Einstellungen › Debug", "MessagesDialog.vue": "Meldungen", "GcodeReferenceDialog.vue": "G-Code-Referenz",
    "NumberKeypadStrip.vue": "Zahlentastatur", "TextKeypadStrip.vue": "Texttastatur", "FloatingOverlays.vue": "Tastatur-Symbol am Feld",
    "TabNav.vue": "Tabs", "TabPanel.vue": "Tabs", "DialogFrame.vue": "jeder Dialog", "MoreMenu.vue": "Menü „More“",
    "HelpIcon.vue": "„?“-Hilfe", "DetailsPopover.vue": "Detailkarte", "ChoiceGroup.vue": "Auswahlgruppen",
    **{f: "jedes Bedienelement" for f in ("Btn.vue", "MachineBtn.vue", "MachineChoice.vue", "MachineColor.vue", "MachineInput.vue",
                                          "MachineRadio.vue", "MachineSelect.vue", "MachineSlider.vue", "MachineToggle.vue")},
}

# App.vue holds controls of several places: the first fragment of its key
# that matches names the place (an App control matching none fails).
APP_PLACES = (
    ("|MachineBtn:mdi|", "Tab „MDI“"), ("|MachineInput:mdiText|", "Tab „MDI“"), ("|div|@click=mdiText", "Tab „MDI“"),
    ("clearMdiHistory", "Tab „MDI“"), ("|MachineBtn:toolChangeConfirm|", "Dialog"), ("|MachineBtn:banner", "Banner"),
    ("|MachineBtn:headerIcon|", "Kopfzeile"), ("|div|@click=openMessages", "Kopfzeile"), ("|MachineBtn:tool", "Tab „Tools“"),
    ("toolTableRef", "Tab „Tools“"), ("|MachineSelect:tabSelect|", "Tab „Probing“"), ("|MachineBtn:simTrip|", "Tab „Probing“"),
    ("|MachineBtn:abort|", "Tab-Kopf (Abort)"), ("|MachineBtn:dialog", "Dialog"), ("|MachineBtn:macroExecute|", "Dialog"),
    ("|MachineInput:macroParam|", "Dialog"), ("|MachineBtn:shutdown|", "Dialog"),
)
MODES = ("Machine", "TCP", "Plane")
# A statement's scope beside the modes and the profile ids: every mode and
# profile on purpose, or not decided yet (Codex R270).
SCOPE_WORDS = ("alle", "offen")


def place_of(atom: str) -> str | None:
    """The place of a control atom (None for an App control no fragment names)."""
    key = atom.split(":", 1)[1]
    file = key.split("|", 1)[0]
    if file == "App.vue":
        return next((p for frag, p in APP_PLACES if frag in key), None)
    return PLACES.get(file)


EVIDENCE_LAYERS = {"browser": "lcnc-webui/e2e", "unit": "lcnc-webui/src", "gateway": "lcnc-gateway", "script": "scripts"}
STATEMENT_KINDS = ("Daten", "Wirkung", "Ablehnung", "Abbruch", "Unbekannt", "Bedienbarkeit", "Zeichnung")


def load(root: Path = ROOT) -> tuple[dict, dict, dict]:
    here = root / "scripts/inventory"
    return (json.loads((here / "atoms.web.json").read_text()), json.loads((here / "atoms.py.json").read_text()),
            json.loads((here / "functions.json").read_text()))


def atom_ids(*sides: dict) -> dict[str, list[str]]:
    """Atom id → the adapters that found it (one id may come from two
    readers, e.g. an INI option the gateway and the launcher both read)."""
    out: dict[str, list[str]] = {}
    for side in sides:
        for name, a in side["adapters"].items():
            for atom in a["atoms"]:
                out.setdefault(atom["id"], []).append(name)
    return out


def _pattern(claim: str) -> tuple[re.Pattern, int] | None:
    m = re.fullmatch(r"(.*\*.*)=(\d+)", claim)
    if not m:
        return None
    return re.compile("^" + ".*".join(re.escape(p) for p in m.group(1).split("*")) + "$"), int(m.group(2))


def claimed(claims: list[str], ids: list[str], where: str, problems: list[str]) -> set[str]:
    got: set[str] = set()
    for c in claims:
        p = _pattern(c)
        if p is None:
            if "*" in c:
                problems.append(f"{where}: the pattern {c!r} has no pinned count (=n)")
            elif c not in ids:
                problems.append(f"{where}: claims {c!r}, which no adapter finds")
            got.add(c)
            continue
        rx, n = p
        hit = {i for i in ids if rx.match(i)}
        if len(hit) != n:
            problems.append(f"{where}: {c!r} matches {len(hit)} atoms, pinned {n}")
        got |= hit
    return got


def completeness(*sides: dict) -> dict:
    """The source inventory's verdict: complete only with no unresolved site
    in any adapter (Codex R268/R269 — an explained unresolved site is still
    unresolved). Excluded sites and open variants are counted, never hidden."""
    unresolved = [(n, u) for s in sides for n, a in s["adapters"].items() for u in a["unresolved"]]
    return {"complete": not unresolved, "unresolved": unresolved,
            "excluded": sum(len(a.get("excluded", [])) for s in sides for a in s["adapters"].values()),
            "variantsOpen": sum(len(a.get("variantsOpen", [])) for s in sides for a in s["adapters"].values())}


def problems(web: dict, py: dict, fns: dict, root: Path = ROOT) -> list[str]:
    out: list[str] = []
    ids = atom_ids(web, py)
    all_ids = sorted(ids)
    profiles = {a.split(":", 1)[1] for a in all_ids if a.startswith("profile:")}
    owner: dict[str, str] = {}
    seen_fn: set[str] = set()
    for f in fns["functions"]:
        fid = f["id"]
        if fid in seen_fn:
            out.append(f"{fid}: the id is used twice")
        seen_fn.add(fid)
        if f.get("area") not in fns["areas"]:
            out.append(f"{fid}: unknown area {f.get('area')!r}")
        for a in claimed(f.get("atoms", []), all_ids, fid, out):
            if a in owner:
                out.append(f"{a}: claimed by {owner[a]} and {fid} — one primary owner, the other `uses` it")
            owner.setdefault(a, fid)
        for a in f.get("uses", []):
            if a not in ids:
                out.append(f"{fid}: uses {a!r}, which no adapter finds")
        for s in f.get("statements", []):
            if s.get("kind") not in STATEMENT_KINDS:
                out.append(f"{fid}.{s.get('id')}: unknown statement kind {s.get('kind')!r}")
            if not s.get("applies"):
                out.append(f"{fid}.{s.get('id')}: no applies — a mode, a profile, \"alle\" or \"offen\"")
            for x in s.get("applies", []):
                if x not in MODES and x not in profiles and x not in SCOPE_WORDS:
                    out.append(f"{fid}.{s.get('id')}: applies to {x!r} — neither a mode, a profile, \"alle\" nor \"offen\"")
            for e in s.get("evidence", []):
                out += [f"{fid}.{s['id']}: {p}" for p in evidence_problems(e, root)]
    for a, why in fns.get("excludedAtoms", {}).items():
        if a not in ids:
            out.append(f"excludedAtoms: {a!r} — no adapter finds it")
        elif a in owner:
            out.append(f"excludedAtoms: {a!r} is also claimed by {owner[a]}")
        if len(why) < 10:
            out.append(f"excludedAtoms: {a!r} needs its reason")
    out += [f"{a}: a control without a place (PLACES / APP_PLACES)" for a in all_ids
            if a.startswith("control:") and place_of(a) is None]
    out += routine_problems(all_ids, root)
    unowned = [a for a in all_ids if a not in owner and a not in fns.get("excludedAtoms", {})]
    out += [f"{a}: no function claims it (found by {', '.join(ids[a])})" for a in unowned]
    return out


def _ini_values(text: str) -> dict[tuple[str, str], list[str]]:
    """(section, key) → every value, in order — REMAP and PATH_APPEND repeat."""
    out: dict[tuple[str, str], list[str]] = {}
    sec = ""
    for line in text.splitlines():
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            sec = t[1:-1]
        elif "=" in t and not t.startswith("#"):
            k, v = t.split("=", 1)
            out.setdefault((sec, k.strip()), []).append(v.strip())
    return out


def routine_homes(root: Path = ROOT) -> dict[str, dict]:
    """Per example profile: its SUBROUTINE_PATH folders in the repository
    (relative to the INI's folder; `~` entries are the user's folders, not
    shipped), its remaps (code → `ngc=` file or `python=` function) and the
    functions its Python remap modules define."""
    out: dict[str, dict] = {}
    base = root / "examples/sim_config"
    for ini in sorted(base.glob("*.ini")):
        v = _ini_values(ini.read_text())
        dirs = [base / e for p in v.get(("RS274NGC", "SUBROUTINE_PATH"), []) for e in p.split(":") if e and not e.startswith("~")]
        remaps = {}
        for r in v.get(("RS274NGC", "REMAP"), []):
            words = dict(w.split("=", 1) for w in r.split()[1:] if "=" in w)
            impl = ("ngc", words["ngc"]) if "ngc" in words else ("python", words.get("python", ""))
            remaps[r.split()[0].upper()] = impl
        py = {m.group(1) for d in v.get(("PYTHON", "PATH_APPEND"), []) for f in sorted((base / d).glob("*.py"))
              for m in re.finditer(r"^def (\w+)\(", f.read_text(), re.M)}
        out[ini.name] = {"dirs": dirs, "remaps": remaps, "python": py}
    return out


def routine_problems(all_ids: list[str], root: Path = ROOT) -> list[str]:
    """Every routine the UI or the gateway names has its shipped file in some
    profile — an M-code through that profile's remap — and every example
    remap its implementation (Codex R270 FI-I05)."""
    homes = routine_homes(root)

    def impl_ok(h: dict, impl: tuple[str, str]) -> bool:
        kind, name = impl
        return any((d / f"{name}.ngc").is_file() for d in h["dirs"]) if kind == "ngc" else name in h["python"]

    out = []
    for a in all_ids:
        if a.startswith("routine:"):
            name = a.split(":", 1)[1]
            found = [p for p, h in homes.items() if (name.upper() in h["remaps"] and impl_ok(h, h["remaps"][name.upper()]))
                     or any((d / f"{name}.ngc").is_file() for d in h["dirs"])]
            if not found:
                out.append(f"{a}: no shipped file in any profile's SUBROUTINE_PATH (nor a remap of it)")
        elif a.startswith("remap:"):
            code = a.split(":", 1)[1]
            for p, h in homes.items():
                if code in h["remaps"] and not impl_ok(h, h["remaps"][code]):
                    out.append(f"{a}: {p} remaps it to {h['remaps'][code][0]}={h['remaps'][code][1]}, which it does not ship")
    return out


def evidence_problems(e: dict, root: Path) -> list[str]:
    """Step 1 binds a named test STATICALLY: its file exists and holds its
    title. Whether it ran and passed comes from the run artifacts (step 2)."""
    layer, file, title = e.get("layer"), e.get("file"), e.get("title")
    if layer not in EVIDENCE_LAYERS:
        return [f"evidence layer {layer!r} unknown"]
    path = root / EVIDENCE_LAYERS[layer] / file if file else None
    if path is None or not path.is_file():
        return [f"evidence file {layer}/{file} does not exist"]
    if not title or title not in path.read_text():
        return [f"evidence {layer}/{file}: the title {title!r} is not in the file"]
    if "${" in title and not e.get("instances"):
        return [f"evidence {layer}/{file}: the parametric title {title!r} names no instances"]
    return []


# ── The operator's table ─────────────────────────────────────────────────

def render(web: dict, py: dict, fns: dict) -> str:
    ids = atom_ids(web, py)
    all_ids = sorted(ids)
    verdict = completeness(web, py)
    lines = ["# Funktionsinventar", "",
             "Erzeugt von `scripts/inventory/functions.py` aus `functions.json` und den Atomen der Quellen — nicht von Hand ändern.", ""]
    lines += ["## Vollständigkeit der Quellen", "",
              f"- **Quellen vollständig erfasst:** {'ja' if verdict['complete'] else 'NEIN'} "
              f"({len(all_ids)} Atome in {sum(len(s['adapters']) for s in (web, py))} Quellen)",
              f"- **Ungelöste Stellen:** {len(verdict['unresolved'])}"]
    for n, u in verdict["unresolved"]:
        lines.append(f"  - {n}: `{u['file']}` — {u['form']}: `{u['expr']}`")
    lines += [f"- **Ausgeschlossen (außerhalb der Grenze, mit Grund):** {verdict['excluded']}",
              f"- **Familien mit offenen Varianten:** {verdict['variantsOpen']} — das Atom steht, seine Varianten sind nicht einzeln abgeleitet",
              "- **Anzeigen** (was die Oberfläche zusagt, etwa „Kompensation bestätigt aktiv“) haben keine Quelle mit Atomen; "
              "ihr Katalog sichtbarer Zusagen folgt als eigener Schritt.",
              "- **Belegt** heißt hier: ein benannter Test existiert mit diesem Titel. Ob er lief und bestand, "
              "kommt aus den Laufberichten (nächster Schritt).", ""]
    open_ = [(f, st) for f in fns["functions"] for st in f.get("statements", []) if not st.get("evidence")]
    lines += ["## Offene Aussagen", "",
              f"{len(open_)} Aussagen ohne Beleg — die Lücken, mit der Schicht, die den Bruch sehen würde.", "",
              "| Funktion | Aussage | Art | gilt für | Lücke |", "|---|---|---|---|---|"]
    lines += [f"| {f['name']} | {st['text']} | {st['kind']} | {', '.join(st.get('applies', ['offen']))} | {st.get('gap', '—')} |"
              for f, st in open_]
    without = [f for f in fns["functions"] if not f.get("statements")]
    lines += ["", f"**Ohne formulierte Aussagen:** {len(without)} Funktionen ohne eigene Maschinenwirkung — "
              + ", ".join(f"{f['name']} `{f['id']}`" for f in without), ""]
    for area, title in fns["areas"].items():
        group = [f for f in fns["functions"] if f["area"] == area]
        if not group:
            continue
        lines += [f"## {title}", "", "| Funktion | Bedienort | Atome | Aussagen | Belegt | Offen |", "|---|---|---|---|---|---|"]
        for f in group:
            got = claimed(f.get("atoms", []), all_ids, f["id"], [])
            places = sorted({place_of(a) or "?" for a in got if a.startswith("control:")})
            st = f.get("statements", [])
            proven = sum(1 for s in st if s.get("evidence"))
            open_ = [s for s in st if not s.get("evidence")]
            lines.append(f"| **{f['name']}** `{f['id']}` | {', '.join(places) or '—'} | {len(got)} | {len(st)} | {proven} | "
                         f"{len(open_) if st else 'Aussagen noch nicht formuliert'} |")
        lines.append("")
        for f in group:
            if not f.get("statements"):
                continue
            lines += [f"### {f['name']}", ""]
            for s in f["statements"]:
                ev = "; ".join(f"{e['layer']}: `{e['file']}` — {e['title']}"
                               + (f" (je: {', '.join(e['instances'])})" if e.get("instances") else "")
                               + (" (live, nicht im Gate)" if e.get("live") else "")
                               for e in s.get("evidence", [])) or "**offen**"
                gap = f" — Lücke: {s['gap']}" if s.get("gap") else ""
                applies = f" — gilt für: {', '.join(s.get('applies', ['offen']))}"
                lines.append(f"- **{s['id']} ({s['kind']}):** {s['text']}{applies}\n  - Beleg: {ev}{gap}")
            lines.append("")
    by_place: dict[str, list[str]] = {}
    for f in fns["functions"]:
        for p in sorted({place_of(a) or "?" for a in claimed(f.get("atoms", []), all_ids, f["id"], []) if a.startswith("control:")}):
            by_place.setdefault(p, []).append(f"{f['name']} `{f['id']}`")
    lines += ["## Nach Bedienort", "", "Dieselben Funktionen, geordnet nach dem Ort, an dem man sie bedient.", "",
              "| Bedienort | Funktionen |", "|---|---|"]
    lines += [f"| {p} | {'<br>'.join(by_place[p])} |" for p in sorted(by_place)]
    without = [f"{f['name']} `{f['id']}`" for f in fns["functions"]
               if not any(a.startswith("control:") for a in claimed(f.get("atoms", []), all_ids, f["id"], []))]
    lines += ["", f"**Ohne eigenes Bedienelement** (über Befehle, Tasten, Einstellungen oder das Gateway): {', '.join(without)}", ""]
    return "\n".join(lines) + "\n"


def dump(fns: dict) -> str:
    """functions.json in its one layout: a function per block, its atoms
    wrapped, a statement per line — so an edit by script and by hand diff
    alike (`functions.py --format`)."""
    j = lambda v: json.dumps(v, ensure_ascii=False)

    def wrapped(key: str, items: list[str]) -> list[str]:
        head = f'   "{key}": ['
        lines, cur = [], head
        for k, x in enumerate(items):
            piece = j(x) + (", " if k < len(items) - 1 else "")
            if len(cur) + len(piece) > 118 and cur.strip() not in (head.strip(),):
                lines.append(cur.rstrip())
                cur = " " * len(head)
            cur += piece
        lines.append(cur + "]")
        return lines

    out = ["{", ' "areas": {']
    areas = list(fns["areas"].items())
    out += [f"  {j(k)}: {j(v)}" + ("," if i < len(areas) - 1 else "") for i, (k, v) in enumerate(areas)]
    out += [" },", ' "functions": [']
    for i, f in enumerate(fns["functions"]):
        block = [f'  {{"id": {j(f["id"])}, "area": {j(f["area"])}, "name": {j(f["name"])},']
        parts = [wrapped("atoms", f.get("atoms", []))]
        if "uses" in f:
            parts.append(wrapped("uses", f["uses"]))
        if "statements" in f:
            st = f["statements"]
            parts.append(['   "statements": ['] + [f"    {j(x)}" + ("," if k < len(st) - 1 else "") for k, x in enumerate(st)] + ["   ]"])
        for k, part in enumerate(parts):
            part = list(part)
            part[-1] += "," if k < len(parts) - 1 else "}"
            block += part
        block[-1] += "," if i < len(fns["functions"]) - 1 else ""
        out += block
    out += [" ],", f' "excludedAtoms": {j(fns.get("excludedAtoms", {}))}', "}"]
    return "\n".join(out) + "\n"


def main() -> int:
    if "--format" in sys.argv[1:]:
        path = HERE / "functions.json"
        fns = json.loads(path.read_text())
        text = dump(fns)
        # the layout is checked before the file is touched (Codex R276
        # FI-I12): a field dump() does not write is refused, never dropped
        if json.loads(text) != fns:
            print("functions.json not formatted — it holds a field the layout does not write (functions.py dump())")
            return 1
        path.write_text(text)
    web, py, fns = load()
    found = problems(web, py, fns)
    for p in found:
        print(p)
    if "--write" in sys.argv[1:]:
        TABLE.parent.mkdir(parents=True, exist_ok=True)
        TABLE.write_text(render(web, py, fns))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
