#!/usr/bin/env python3
"""
audit-scoped-css.py — catch Vue scoped-CSS leaks across SFC boundaries.

Vue 3 propagates a parent's scoped `data-v-xxx` attribute to the root of any
child component instance it renders, but NOT to nested elements within that
child. So a class defined in component A's <style scoped> block applies to:

  - elements in A's own <template>
  - the root element of any child component A renders directly

But it silently fails to apply when:

  - another component B uses the class on any non-root element in its template

This script flags every such silent failure.

  DEFINITE   — class used on a native HTML element on a non-root line. Bug.
  ROOT?      — class used on the consumer's root element. The parent caller's
               data-v reaches it, so this may work depending on who renders B.
               Suppressed by default; pass --all to see.

Pass-through usages on PascalCase child component tags are skipped (the class
flows to the child's root where the child's own scoped CSS applies).
Consumers with their own scoped copy or a global fallback in style.css are skipped.

WS-C extension — design-token drift checks over every .vue <style> block
(style.css itself is the base layer that DEFINES the tokens, so it is exempt):

  TOKEN      — hardcoded value where a token exists: gap/margin px literals
               (vs --gap-*; padding is visual and stays hardcoded per the
               checklist), opacity literals outside @keyframes (vs
               --opacity-*), font-size/border-radius/font-family literals
               (vs --fs-*/--radius-*/--font-*), bare hex colors (a
               var(--x, #hex) fallback is allowed).
  HOVER      — color-mix percentage in a :hover/.selected/:active rule
               outside the 12/15/20 tier set (--hl-hover/selected/active).
  DEEP       — visual property (background/color/border/box-shadow/opacity/
               font-*) inside a :deep() rule. Layout-only :deep() is fine.
  STACK      — scoped rule re-implementing a stack utility: display:flex +
               flex-direction:column + gap:var(--gap-X) → use stack-X class.

  HLPCT      — a --hl-* token (a COLOUR: color-mix of fg into button-bg) used
               in the PERCENT slot of a color-mix() argument (`var(--fg)
               var(--hl-hover)`) — the browser drops the whole declaration.
               Parsed per argument, never by regex over the raw value.
  ZINDEX     — `z-index: <number>` literal in a .vue style block (vs --z-*).
  IMPORTANT  — `!important` in a .vue style block.
  INLINE     — a static `style="…"` attribute in the <template> (`:style`
               bindings are fine — they carry computed layout values).
  TOFIXED    — `.toFixed(` inside the <template> (formatting belongs in
               format.ts, the ONE place a number becomes text).
  CLOSE      — `<MachineBtn type="close"` without an `aria-label`: a close
               control is named for its context ("Close settings",
               "Dismiss upload error"), never announced as "times" (UX-05).
  ELLIPSIS   — an ASCII "..." after a word in the <template> (visible
               text, placeholders, labels): the UI writes "…" (design wave
               D0, UI-N01). A spread (`{ ...x }`, `(...args)`) is not text
               and never matches.
  UNIT_LITERAL — a unit glued to an interpolation in the <template>
               (`{{ v }}mm`, `${v}%`, `{{ v }} ms`): units come from their
               source and a formatter (fmtPct/fmtQty/fmtDist/fmtUnit in
               format.ts), never a literal next to a number (UI-N02–N04).

The <template> range is NESTING-AWARE: a nested `<template v-if>` /
`<template #slot>` no longer ends the scan at its `</template>` (App.vue's
template used to be cut at line 1743 of 2275).

Escape hatch: `/* audit-ok: <reason> */` on the declaration line or the line
above (or `<!-- audit-ok: <reason> -->` in the template) suppresses that
finding — same spirit as the backend `safe-silent` convention: the exemption
is visible and greppable at the site.

CLI: `audit-scoped-css.py [--all] [--paths FILE ...]`. Without `--paths`
every .vue under lcnc-webui/src (recursively) is scanned; with it only the
given files — the fixtures under scripts/test_fixtures/audit_css/ and
scripts/test_audit_scoped_css.py keep every category honest.

Manual `border-bottom` separators are deliberately NOT checked: every current
use is legit (table row underlines, a resize-corner glyph, totals rules) and
"is this a section separator" isn't decidable from syntax.

Exit 1 if any DEFINITE or token-drift finding.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

SRC = Path("lcnc-webui/src")
STYLE = SRC / "style.css"
TAG = r"[A-Za-z][\w-]*"


def repo_root() -> Path:
    return Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )


def block_range(text: str, open_re: str, close: str) -> tuple[int, int] | None:
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines, 1):
        if start is None and re.search(open_re, line):
            start = i
        elif start is not None and close in line:
            return (start, i)
    return None


@lru_cache(maxsize=None)
def read(path: str) -> str:
    return Path(path).read_text()


@lru_cache(maxsize=None)
def scoped_classes(path: str) -> frozenset[str]:
    rng = block_range(read(path), r"<style[^>]*\bscoped\b", "</style>")
    if not rng:
        return frozenset()
    s, e = rng
    block = "\n".join(read(path).splitlines()[s - 1 : e])
    return frozenset(re.findall(rf"(?m)^\s*\.({TAG})", block))


@lru_cache(maxsize=None)
def template_range(path: str) -> tuple[int, int] | None:
    """1-indexed (start, end) of the SFC's top-level <template> block.

    Nesting-aware: `<template v-if>` / `<template #slot>` inside the root
    template open a nested block whose `</template>` must NOT end the range
    (block_range stopped at the first close tag — App.vue's template was
    cut at 1743 of 2275 lines, and every template check after that line
    was blind).
    """
    lines = read(path).splitlines()
    start = None
    depth = 0
    open_re = re.compile(r"<template(?=[\s>])")
    close_re = re.compile(r"</template\s*>")
    for i, line in enumerate(lines, 1):
        if start is None:
            if re.match(r"^<template(?=[\s>])", line):
                start = i
                depth = 1
                # a root template that also closes on its own line
                depth += len(open_re.findall(line)) - 1
                depth -= len(close_re.findall(line))
                if depth == 0:
                    return (start, i)
            continue
        depth += len(open_re.findall(line))
        depth -= len(close_re.findall(line))
        if depth <= 0:
            return (start, i)
    return None


@lru_cache(maxsize=None)
def root_range(path: str) -> tuple[int, int] | None:
    """1-indexed line range of the root opening tag inside <template>."""
    tpl = template_range(path)
    if not tpl:
        return None
    lines = read(path).splitlines()
    open_tag = re.compile(rf"<({TAG})")
    start = None
    for i in range(tpl[0], tpl[1]):
        if open_tag.search(lines[i]):
            start = i + 1
            break
    if start is None:
        return None
    for i in range(start - 1, min(tpl[1], start - 1 + 12)):
        if ">" in lines[i]:
            return (start, i + 1)
    return (start, start)


def tag_at(lines: list[str], lineno: int) -> str:
    """Best-effort: nearest preceding <tag> on or above lineno."""
    pat = re.compile(rf"<({TAG})")
    for i in range(lineno - 1, max(-1, lineno - 8), -1):
        cleaned = re.sub(r"<!--.*?-->", "", lines[i])
        matches = pat.findall(cleaned)
        if matches:
            return matches[-1]
    return "?"


def class_lines(path: str, name: str) -> list[tuple[int, str]]:
    tpl = template_range(path)
    if not tpl:
        return []
    lines = read(path).splitlines()
    pat = re.compile(rf'class="[^"]*(?<![\w-]){re.escape(name)}(?![\w-])')
    out = []
    for i in range(tpl[0], tpl[1] + 1):
        if pat.search(lines[i - 1]):
            out.append((i, tag_at(lines, i)))
    return out


# ---------------------------------------------------------------------------
# WS-C token-drift checks
# ---------------------------------------------------------------------------

_HL_TIERS = {"12", "15", "20"}  # --hl-hover / --hl-selected / --hl-active

# Visual properties that must never be overridden through :deep() — doing so
# bypasses Btn.vue's state system (layout props are fine).
_DEEP_VISUAL = re.compile(
    r"^\s*(background[\w-]*|color|border(?!-radius\s*:\s*0)[\w-]*|"
    r"box-shadow|opacity|font-[\w-]+)\s*:"
)


def _style_blocks(path: str) -> list[tuple[int, str]]:
    """All <style> block bodies of a .vue file as (start_line, text)."""
    text = read(path)
    out = []
    for m in re.finditer(r"<style[^>]*>(.*?)</style>", text, re.S):
        start = text[: m.start(1)].count("\n") + 1
        out.append((start, m.group(1)))
    return out


def _audit_ok(lines: list[str], idx: int) -> bool:
    here = lines[idx]
    above = lines[idx - 1] if idx > 0 else ""
    return "audit-ok:" in here or "audit-ok:" in above


def _split_args(inner: str) -> list[str]:
    """Split a function's argument text on top-level commas (depth-aware)."""
    args, depth, cur = [], 0, []
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            args.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        args.append("".join(cur).strip())
    return args


def _color_mix_calls(val: str) -> list[str]:
    """Inner argument text of every color-mix(...) call in a value."""
    out = []
    pos = 0
    while True:
        k = val.find("color-mix(", pos)
        if k < 0:
            return out
        i = k + len("color-mix(")
        depth = 1
        j = i
        while j < len(val) and depth:
            if val[j] == "(":
                depth += 1
            elif val[j] == ")":
                depth -= 1
            j += 1
        out.append(val[i : j - 1])
        pos = j


def _arg_tokens(arg: str) -> list[str]:
    """Top-level whitespace-separated tokens of one color-mix argument
    (`var(--fg) 12%` → ['var(--fg)', '12%'])."""
    toks, depth, cur = [], 0, []
    for ch in arg:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch.isspace() and depth == 0:
            if cur:
                toks.append("".join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        toks.append("".join(cur))
    return toks


def hl_in_percent_slot(val: str) -> list[str]:
    """Arguments of color-mix() where a --hl-* token stands in the PERCENT
    position (after a colour token). `var(--hl-hover)` as the colour itself
    is valid. Returns the offending argument texts."""
    bad = []
    for inner in _color_mix_calls(val):
        args = _split_args(inner)
        for arg in args[1:]:  # args[0] is the `in <colorspace>` method
            toks = _arg_tokens(arg)
            for tok in toks[1:]:
                if tok.startswith("var(--hl-"):
                    bad.append(arg)
                    break
    return bad


# "word..." / "3..." / ")..." — an ellipsis written as three dots after a
# word; a spread ("{ ...x", "(...a", ", ...b") is preceded by punctuation or
# space and followed by an identifier, so it never matches.
ELLIPSIS_RE = re.compile(r"(?<=[A-Za-z0-9)\]])\.\.\.(?![A-Za-z_$(\[{])")
# a unit right after a mustache or a template-literal interpolation
UNIT_LITERAL_RE = re.compile(r"(?:\}\}|\$\{[^}]*\})\s?(?:mm|ms|%)(?![\w/])")


def _template_audit_ok(lines: list[str], idx: int) -> bool:
    here = lines[idx]
    above = lines[idx - 1] if idx > 0 else ""
    return "audit-ok:" in here or "audit-ok:" in above


def template_findings(path: str) -> list[tuple[str, int, str]]:
    """INLINE (static style=), TOFIXED (number formatting), CLOSE (an
    unnamed close control), ELLIPSIS and UNIT_LITERAL inside the SFC's
    top-level template — nothing outside it (script/style)."""
    findings: list[tuple[str, int, str]] = []
    tpl = template_range(path)
    if not tpl:
        return findings
    lines = read(path).splitlines()
    for ln in range(tpl[0], tpl[1] + 1):
        line = lines[ln - 1]
        idx = ln - 1
        if _template_audit_ok(lines, idx):
            continue
        # a static style attribute: `style="…"` not preceded by `:` or `v-bind`
        if re.search(r'(?<![:\w-])style="', line):
            findings.append(("INLINE", ln, "static style=\"…\" — use a utility class (.w-full) or a scoped layout rule"))
        if ".toFixed(" in line:
            findings.append(("TOFIXED", ln, ".toFixed( in the template — format through format.ts"))
        if ELLIPSIS_RE.search(line):
            findings.append(("ELLIPSIS", ln, 'ASCII "..." in the template — write "…"'))
        m_unit = UNIT_LITERAL_RE.search(line)
        # a CSS length inside a :style binding is layout, not a readout
        if m_unit and ":style=" not in line[:m_unit.start()]:
            findings.append(("UNIT_LITERAL", ln, "unit literal glued to an interpolation — format it through format.ts (fmtPct/fmtQty/fmtDist/fmtUnit)"))
        # a close control without an accessible name: read the whole tag (it
        # may span lines) and look for aria-label / :aria-label on it
        if '<MachineBtn' in line and 'type="close"' in line:
            tag, j = line, idx
            while ">" not in tag and j + 1 < len(lines):
                j += 1
                tag += " " + lines[j]
            if "aria-label" not in tag:
                findings.append(("CLOSE", ln, 'type="close" without aria-label — name the close for its context ("Close settings", "Dismiss upload error")'))
    return findings


def token_findings(path: str) -> list[tuple[str, int, str]]:
    """(category, lineno, message) per drift site in one .vue file.

    Brace/segment-driven scan (NOT one-declaration-per-line): `.x { gap: 7px }`
    single-line rules and multiple declarations per line are parsed the same
    as formatted CSS — the first adversarial proof planted single-line rules
    and a line-based matcher missed every one.
    """
    findings: list[tuple[str, int, str]] = []
    for block_start, body in _style_blocks(path):
        lines = body.splitlines()  # RAW lines — _audit_ok must see comments
        # Strip comments (incl. multi-line) newline-preserving, so comment
        # text can't leak into selectors and line numbers stay aligned.
        scan_lines = re.sub(
            r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), body, flags=re.S
        ).splitlines()
        depth = 0            # brace depth
        keyframes_at = None  # depth at which an @keyframes block opened
        selector = ""        # selector of the innermost open rule
        pending_sel: list[str] = []  # selector text accumulating before '{'
        # Rule-level accumulation for the STACK check.
        rule_props: dict[str, str] = {}
        rule_open_line = 0

        def flag(cat: str, i: int, msg: str) -> None:
            if not _audit_ok(lines, i):
                findings.append((cat, block_start + i, msg))

        def scan_decls(seg: str, i: int) -> None:
            in_keyframes = keyframes_at is not None
            for m in re.finditer(r"([\w-]+)\s*:\s*([^;{}]+)", seg):
                prop, val = m.group(1), m.group(2).strip()
                rule_props[prop] = val

                if prop in ("gap", "row-gap", "column-gap") or prop.startswith("margin"):
                    if re.search(r"\b\d*\.?\d+(px|em|rem)\b", val) and "var(--gap-" not in val:
                        flag("TOKEN", i, f"{prop}: {val} — use a --gap-* token")
                elif prop == "opacity" and not in_keyframes:
                    if re.match(r"0?\.\d+", val):
                        flag("TOKEN", i, f"opacity: {val} — use an --opacity-* token")
                elif prop == "font-size":
                    if re.search(r"\b\d", val) and "var(--fs-" not in val and "%" not in val:
                        flag("TOKEN", i, f"font-size: {val} — use an --fs-* token")
                elif prop == "border-radius":
                    if re.search(r"\b\d*\.?\d+(px|em|rem)\b", val) and "var(--radius-" not in val:
                        flag("TOKEN", i, f"border-radius: {val} — use a --radius-* token")
                elif prop == "font-family":
                    # `inherit` is not a hardcoded family — it defers to the
                    # cascade, which is exactly what the rule wants.
                    if "var(--font-" not in val and val != "inherit":
                        flag("TOKEN", i, f"font-family: {val} — use var(--font-mono|sans)")

                if re.search(r"#[0-9a-fA-F]{3,8}\b", val) and not re.search(
                    r"var\(--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}", val
                ):
                    flag("TOKEN", i, f"{prop}: {val} — bare hex; use a semantic var")

                for bad in hl_in_percent_slot(val):
                    flag("HLPCT", i, f"{prop}: `{bad}` — --hl-* is a colour, not a percentage; "
                                     "use --hl-surface / --hl-surface-info or the token as the colour")

                if prop == "z-index" and re.fullmatch(r"-?\d+", val):
                    flag("ZINDEX", i, f"z-index: {val} — use a --z-* token")

                if "!important" in val:
                    flag("IMPORTANT", i, f"{prop}: {val} — resolve by specificity, not !important")

                if ":deep(" in selector and _DEEP_VISUAL.match(f"{prop}:"):
                    flag("DEEP", i, f"visual '{prop}' via :deep() in `{selector}`")

                # Pseudo-classes and `.selected` only: a `.active` CLASS is a
                # semantic machine state (Btn.vue's green active, gamepad
                # pressed indicator), not a hover-highlight tier. Background
                # fills only: the tier system governs highlight fills, not
                # border/outline mixes.
                if (
                    prop.startswith("background")
                    and "color-mix" in val
                    and re.search(r":hover|:active|\.selected\b", selector)
                ):
                    for pct in re.findall(r"(\d+)%", val):
                        if pct not in _HL_TIERS and "var(--hl-" not in val:
                            flag("HOVER", i, f"color-mix {pct}% in `{selector}` — use --hl-hover/selected/active")
                            break

        def close_rule(i: int) -> None:
            # STACK check fires when the rule closes with the full trio.
            nonlocal keyframes_at, rule_props
            if (
                rule_props.get("display") == "flex"
                and rule_props.get("flex-direction") == "column"
                and "var(--gap-" in rule_props.get("gap", "")
            ):
                tok = re.search(r"var\(--gap-([\w-]+)\)", rule_props["gap"]).group(1)
                cls = {"section": "stack-sections"}.get(tok, f"stack-{tok}")
                flag("STACK", rule_open_line,
                     f"`{selector}` re-implements {cls} — use the utility class")
            if keyframes_at is not None and depth == keyframes_at:
                keyframes_at = None
            rule_props = {}

        for i, line in enumerate(scan_lines):
            pos = 0
            for brace in re.finditer(r"[{}]", line):
                seg = line[pos : brace.start()]
                if brace.group() == "{":
                    selector = (" ".join(pending_sel + [seg])).strip()
                    pending_sel = []
                    depth += 1
                    if selector.startswith("@keyframes") and keyframes_at is None:
                        keyframes_at = depth
                    rule_props = {}
                    rule_open_line = i
                else:
                    if depth > 0:
                        scan_decls(seg, i)
                        close_rule(i)
                        depth -= 1
                pos = brace.end()
            tail = line[pos:]
            if depth > 0:
                scan_decls(tail, i)
            elif tail.strip():
                pending_sel.append(tail.strip())
    return findings


def run(vue_files: list[Path], show_all: bool = False, style: Path | None = None) -> tuple[list, list, int]:
    """Scan `vue_files`: (leak findings, drift findings, definite-leak count).
    Drift findings are (category, file, line, message). `style` is the global
    stylesheet whose classes exempt a scoped class from the leak check."""
    vue_files = sorted(vue_files)
    # Capture every class token in style.css, including those buried in compound
    # selectors like `.dialog.lg` or `.val-status.warn`. Top-line-only would miss
    # these and produce dozens of false positives.
    global_classes = set(re.findall(rf"\.({TAG})", style.read_text())) if style and style.is_file() else set()

    findings = []
    for def_file in vue_files:
        for name in scoped_classes(str(def_file)):
            if name in global_classes:
                continue
            for use_file in vue_files:
                if use_file == def_file:
                    continue
                if name in scoped_classes(str(use_file)):
                    continue
                rspan = root_range(str(use_file))
                for ln, tag in class_lines(str(use_file), name):
                    if tag and tag[0].isupper():
                        continue
                    sev = (
                        "ROOT?"
                        if rspan and rspan[0] <= ln <= rspan[1]
                        else "DEFINITE"
                    )
                    findings.append((sev, str(use_file), ln, name, str(def_file), tag))
    findings.sort()
    definite = sum(1 for f in findings if f[0] == "DEFINITE")

    drift = []
    for f in vue_files:
        for cat, ln, msg in token_findings(str(f)) + template_findings(str(f)):
            drift.append((cat, str(f), ln, msg))
    drift.sort(key=lambda d: (d[1], d[2], d[0]))
    return findings, drift, definite


def main(argv: list[str]) -> int:
    show_all = "--all" in argv

    if "--paths" in argv:
        paths = [Path(a) for a in argv[argv.index("--paths") + 1 :] if not a.startswith("--")]
        if not paths:
            print("--paths needs at least one .vue file", file=sys.stderr)
            return 2
        style = Path(repo_root()) / STYLE
        vue_files = [p.resolve() for p in paths]
    else:
        os.chdir(repo_root())
        if not SRC.is_dir() or not STYLE.is_file():
            print(f"missing {SRC} or {STYLE}", file=sys.stderr)
            return 2
        vue_files = sorted(SRC.rglob("*.vue"))
        style = STYLE

    findings, drift, definite = run(vue_files, show_all, style)
    for sev, f, ln, name, dfile, tag in findings:
        if sev == "DEFINITE" or show_all:
            print(
                f"{sev:<9} {f}:{ln:<4} .{name:<24} on <{tag}>  (scoped in {dfile})"
            )
    for cat, f, ln, msg in drift:
        print(f"{cat:<9} {f}:{ln:<4} {msg}")

    if definite or drift:
        print(
            f"\nFAIL: {definite} definite scoped-CSS leak(s), {len(drift)} token-drift finding(s).",
            file=sys.stderr,
        )
        return 1
    suffix = "" if show_all else " (use --all to see ROOT? candidates)"
    print(f"OK: no definite scoped-CSS leaks, no token drift.{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
