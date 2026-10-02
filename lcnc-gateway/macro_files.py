"""Macros as LinuxCNC subroutine files (package 5, stage B; plan
docs/reviews/makros.plan.md, Fassung 3).

A macro is `<name>.ngc` in the macro folder (`[DISPLAY] WEBUI_MACRO_DIR`, on
`[RS274NGC] SUBROUTINE_PATH`): one subroutine `o<name> sub … o<name> endsub`
with a comment header the gateway parses — the ONLY parser; the client shows
what this module returns. Pure: no LinuxCNC, no HAL, no event loop; the
gateway does the I/O around it.

Interpreter facts this module mirrors (LinuxCNC v2.9.4 source):
- every o-word name is lower-cased, NO_DOWNCASE_OWORD notwithstanding
  (`interp_internal.cc` close_and_downcase), and `.ngc` is appended;
- `find_ngc_file` (`rs274ngc_pre.cc:2660-2753`): the name relative to
  milltask's working directory, then PROGRAM_PREFIX, then the
  SUBROUTINE_PATH dirs in order, then WIZARD_ROOT — the first file fopen()
  opens wins;
- at most 30 positional arguments; unpassed #N are 0 in the sub;
- a line is at most 254 characters (LINELEN 255).
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import shlex
from typing import Callable, Dict, List, Optional, Sequence

#: A macro's name: what the interpreter can find (lower case, it downcases
#: every o-word) and what is also an identifier (no dash).
NAME_RE = re.compile(r"^[a-z0-9_]{1,63}$")
MAX_ARGS = 30
#: LinuxCNC's LINELEN is 255 including the terminator.
MAX_LINE = 254
LABEL_MAX = 40
TITLE_MAX = 40
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
UNIT_KINDS = ("length", "feed", "angle", "rpm", "time", "count", "none")
HEADER_WORDS = ("MACRO", "UNITS", "FRAME", "PARAM")

_SUB_RE = re.compile(r"^o<([^>]*)>(sub|endsub)$")
_OWORD_ANY_RE = re.compile(r"^o<([^>]*)>(sub|endsub)\b")
_NAMED_PARAM_RE = re.compile(r"#<[^>]*>")


def revision_of(data: bytes) -> str:
    """The revision a client saw: sha256 of the file's bytes."""
    return hashlib.sha256(data).hexdigest()


def _strip_comments(line: str) -> str:
    """The executable part of a line: `( … )` comments and everything after
    `;` removed (an unclosed `(` comments out the rest, as LinuxCNC reads it)."""
    out, depth = [], 0
    for ch in line:
        if depth == 0 and ch == ";":
            break
        if ch == "(":
            depth += 1
        elif ch == ")" and depth:
            depth -= 1
        elif depth == 0:
            out.append(ch)
    return "".join(out)


def _code(line: str) -> str:
    """The interpreter's view of a line: comments gone, white space gone,
    lower case (close_and_downcase)."""
    return re.sub(r"\s+", "", _strip_comments(line)).lower()


def _words(code: str) -> List[str]:
    """Letter + number words of a normalised line (named parameters and
    bracketed expressions dropped — a computed word is the named limit)."""
    code = _NAMED_PARAM_RE.sub("", code)
    code = re.sub(r"\[[^\]]*\]", "", code)
    return re.findall(r"(?<![a-z#])([a-z])([-+]?\d+(?:\.\d+)?)", code)


def _has_word(code: str, letter: str, number: float) -> bool:
    return any(l == letter and abs(float(n) - number) < 1e-9 for l, n in _words(code))


def parse_macro(name: str, text: str) -> Dict:
    """The macro's metadata and every reason it may not run.

    Returns {name, title, units, frame, params, description, errors,
    warnings}; `errors` (each {line, message}) make it not runnable, a
    `warning` does not. Lines are 1-based."""
    errors: List[Dict] = []
    warnings: List[Dict] = []
    def err(n: int, msg: str): errors.append({"line": n, "message": msg})
    def warn(n: int, msg: str): warnings.append({"line": n, "message": msg})

    meta: Dict = {"name": name, "title": None, "units": None, "frame": None,
                  "params": [], "description": [], "errors": errors, "warnings": warnings}
    if not NAME_RE.match(name or ""):
        err(0, "File name: lower-case letters, digits and _ only, at most 63")
    lines = text.splitlines()
    sub_at = end_at = None
    seen_once: Dict[str, int] = {}

    for i, raw in enumerate(lines, 1):
        code = _code(raw)
        m = _OWORD_ANY_RE.match(code)
        if m:
            oname, kind = m.group(1), m.group(2)
            if kind == "sub":
                if sub_at is not None:
                    err(i, "One subroutine per file — a second o<…> sub")
                    continue
                if oname != name:
                    err(i, f"The subroutine is o<{oname}> — the file name says o<{name}>")
                sub_at = i
            else:
                if sub_at is None:
                    err(i, "endsub before sub")
                elif end_at is None:
                    if oname != name:
                        err(i, f"endsub names o<{oname}> — expected o<{name}>")
                    end_at = i
            continue
        if sub_at is None:
            _header_line(i, raw, code, meta, seen_once, err)
        elif end_at is None:
            _body_line(i, code, err)
    if sub_at is None:
        err(0, f"No o<{name}> sub in the file")
    elif end_at is None:
        err(sub_at, f"No o<{name}> endsub after the sub")

    params = meta["params"]
    ns = sorted(p["n"] for p in params)
    if ns != list(range(1, len(ns) + 1)):
        err(0, "PARAM positions must run 1, 2, 3 … without a gap")
    kinds = {p["unit"] for p in params}
    if kinds & {"length", "feed"} and not meta["units"]:
        err(0, "UNITS mm or UNITS inch is required with length or feed parameters")
    if sub_at is not None and end_at is not None:
        body = [(j, _code(lines[j - 1])) for j in range(sub_at + 1, end_at)]
        _entry_rule(meta, [b for b in body if b[1]], sub_at, err)
        if meta["frame"] != "machine":
            for j, c in body:
                if any(l == "g" and abs(float(n) - 53) < 1e-9 for l, n in _words(c)):
                    warn(j, "G53 without FRAME machine — G53 needs the machine frame")
                    break
    return meta


def _header_line(i: int, raw: str, code: str, meta: Dict, seen: Dict[str, int], err) -> None:
    stripped = raw.strip()
    if not stripped:
        return
    if code:
        if code.startswith("%"):
            err(i, "% before endsub — a program starting with % reads it as the file's end")
        else:
            err(i, "Code before o<…> sub never runs when the macro is called")
        return
    if stripped.startswith(";"):
        meta["description"].append(stripped.lstrip(";").strip())
        return
    if not (stripped.startswith("(") and stripped.endswith(")")):
        meta["description"].append(stripped)
        return
    inner = stripped[1:-1].strip()
    first = inner.split(None, 1)[0] if inner else ""
    if not re.fullmatch(r"[A-Z]+", first):
        meta["description"].append(inner)
        return
    rest = inner[len(first):].strip()
    if first not in HEADER_WORDS:
        err(i, f"Unknown header word {first} — MACRO, UNITS, FRAME or PARAM")
        return
    if first != "PARAM":
        if first in seen:
            err(i, f"{first} twice (line {seen[first]})")
            return
        seen[first] = i
    if first == "MACRO":
        if not rest or len(rest) > TITLE_MAX:
            err(i, f"MACRO needs a title of 1 … {TITLE_MAX} characters")
        else:
            meta["title"] = rest
    elif first == "UNITS":
        if rest not in ("mm", "inch"):
            err(i, "UNITS is mm or inch")
        else:
            meta["units"] = rest
    elif first == "FRAME":
        if rest != "machine":
            err(i, "FRAME is machine")
        else:
            meta["frame"] = "machine"
    else:
        _param(i, rest, meta, err)


def _param(i: int, rest: str, meta: Dict, err) -> None:
    try:
        tok = shlex.split(rest, posix=True)
    except ValueError as e:
        err(i, f"PARAM: {e}")
        return
    if len(tok) < 5:
        err(i, 'PARAM <n> <key> "<Label>" <unit> <default> [min=…] [max=…] [integer]')
        return
    n_s, key, label, unit, default_s, *opts = tok
    try:
        n = int(n_s)
    except ValueError:
        err(i, f"PARAM position {n_s!r} is not a number")
        return
    if not 1 <= n <= MAX_ARGS:
        err(i, f"PARAM position {n} — 1 … {MAX_ARGS}")
        return
    params = meta["params"]
    if any(p["n"] == n for p in params):
        err(i, f"PARAM position {n} twice")
        return
    if not KEY_RE.match(key):
        err(i, f"PARAM key {key!r}: a lower-case identifier")
        return
    if any(p["key"] == key for p in params):
        err(i, f"PARAM key {key} twice")
        return
    if not label or len(label) > LABEL_MAX:
        err(i, f"PARAM label: 1 … {LABEL_MAX} characters")
        return
    if unit not in UNIT_KINDS:
        err(i, f"PARAM unit {unit!r} — one of {', '.join(UNIT_KINDS)}")
        return
    vmin = vmax = None
    integer = False
    try:
        default = float(default_s)
    except ValueError:
        err(i, f"PARAM default {default_s!r} is not a number")
        return
    for o in opts:
        if o == "integer":
            integer = True
            continue
        k, sep, v = o.partition("=")
        if not sep or k not in ("min", "max"):
            err(i, f"PARAM option {o!r} — min=…, max=… or integer")
            return
        try:
            fv = float(v)
        except ValueError:
            err(i, f"PARAM {k} {v!r} is not a number")
            return
        if not math.isfinite(fv):
            err(i, f"PARAM {k} is not finite")
            return
        if k == "min":
            vmin = fv
        else:
            vmax = fv
    if not math.isfinite(default):
        err(i, "PARAM default is not finite")
        return
    if vmin is not None and vmax is not None and vmin > vmax:
        err(i, f"PARAM min {vmin:g} is above max {vmax:g}")
        return
    if integer and default != int(default):
        err(i, f"PARAM default {default:g} is not an integer")
        return
    if (vmin is not None and default < vmin) or (vmax is not None and default > vmax):
        err(i, f"PARAM default {default:g} is outside its range")
        return
    params.append({"n": n, "key": key, "label": label, "unit": unit, "default": default,
                   "min": vmin, "max": vmax, "integer": integer})
    params.sort(key=lambda p: p["n"])


def _body_line(i: int, code: str, err) -> None:
    if not code:
        return
    if "%" in code:
        err(i, "% before endsub — a program starting with % reads it as the file's end")
    for l, n in _words(code):
        if l == "m" and float(n) in (2.0, 30.0):
            err(i, f"M{int(float(n))} in the macro ends the program — use endsub")
            break


def _entry_rule(meta: Dict, body: List, sub_at: int, err) -> None:
    """VP69-04: a macro whose values depend on modal state starts with
    `M73` on its own line, then a line setting what the values mean."""
    kinds = {p["unit"] for p in meta["params"]}
    if not kinds & {"length", "feed", "rpm"}:
        return
    if not body or body[0][1] != "m73":
        err(body[0][0] if body else sub_at, "The first line after sub must be M73 alone (it saves the modal state)")
        return
    if len(body) < 2:
        err(body[0][0], "After M73 a line must set the units and modes the values need")
        return
    j, c = body[1]
    need = []
    if kinds & {"length", "feed"} and meta["units"]:
        need.append(("g", 21.0 if meta["units"] == "mm" else 20.0))
    if "feed" in kinds:
        need.append(("g", 94.0))
    if "rpm" in kinds:
        need.append(("g", 97.0))
    missing = [f"G{int(n)}" for l, n in need if not _has_word(c, l, n)]
    if missing:
        err(j, f"The line after M73 must set {' '.join(missing)}")


def format_arg(v: float) -> str:
    """A value as the call passes it: 6 decimals like every #N= the gateway
    writes, trailing zeros dropped (the line is at most 254 characters)."""
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def build_call(meta: Dict, values: Sequence) -> Dict:
    """`o<name> call [a1] …` for the parsed macro and the operator's values,
    or {error}. Every declared parameter is passed (unpassed #N would be 0,
    not the doc's 'caller value'); each value is rounded to what the line
    carries BEFORE its range is checked."""
    if meta.get("errors"):
        return {"error": "Macro has header errors — fix them in the editor"}
    params = meta["params"]
    if len(values) != len(params):
        return {"error": f"Macro takes {len(params)} values, got {len(values)}"}
    words = []
    for p, v in zip(params, values):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return {"error": f"{p['label']}: not a finite number"}
        s = format_arg(float(v))
        r = float(s)
        if p["integer"] and r != int(r):
            return {"error": f"{p['label']}: a whole number"}
        if p["min"] is not None and r < p["min"]:
            return {"error": f"{p['label']}: at least {p['min']:g}"}
        if p["max"] is not None and r > p["max"]:
            return {"error": f"{p['label']}: at most {p['max']:g}"}
        words.append(f"[{s}]")
    line = f"o<{meta['name']}> call" + "".join(" " + w for w in words)
    if len(line) > MAX_LINE:
        return {"error": f"Call is {len(line)} characters — LinuxCNC reads {MAX_LINE}"}
    return {"line": line}


def resolve_oword(name: str, cwd: Optional[str], program_prefix: str,
                  subroutine_dirs: Sequence[str],
                  opens: Callable[[str], bool] = lambda p: os.access(p, os.R_OK)) -> Optional[str]:
    """The file `o<name> call` opens, as find_ngc_file looks: milltask's
    working directory, PROGRAM_PREFIX (as configured — unset is "" and the
    interpreter tries "/<name>.ngc"), the SUBROUTINE_PATH dirs in order.
    WIZARD_ROOT is searched last, after SUBROUTINE_PATH — it can never win
    over a macro folder on that path, so it is not walked here."""
    fname = name + ".ngc"
    cands = []
    if cwd:
        cands.append(os.path.join(cwd, fname))
    cands.append(f"{os.path.expanduser(program_prefix or '')}/{fname}")
    cands.extend(os.path.join(d, fname) for d in subroutine_dirs)
    for c in cands:
        if opens(c):
            return os.path.realpath(c)
    return None


def folders_overlap(a: str, b: str) -> bool:
    """True when one real folder contains the other (or they are one)."""
    ra, rb = os.path.realpath(a), os.path.realpath(b)
    return ra == rb or ra.startswith(rb + os.sep) or rb.startswith(ra + os.sep)


def runnable_reason(meta: Dict, macro_path: str, resolved: Optional[str]) -> Optional[str]:
    """Why a parsed macro cannot run, or None. A header error, or the
    interpreter's first hit for its name being another file (shadowed)."""
    if meta["errors"]:
        e = meta["errors"][0]
        where = f"line {e['line']}: " if e["line"] else ""
        return f"Header error — {where}{e['message']}"
    if resolved is None:
        return "LinuxCNC does not find this file — macro folder not on SUBROUTINE_PATH"
    if os.path.realpath(macro_path) != resolved:
        return f"Shadowed by {resolved}"
    return None
