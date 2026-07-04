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

Escape hatch: `/* audit-ok: <reason> */` on the declaration line or the line
above suppresses that finding — same spirit as the backend `safe-silent`
convention: the exemption is visible and greppable at the site.

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
    return block_range(read(path), r"<template>", "</template>")


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


def main(argv: list[str]) -> int:
    show_all = "--all" in argv

    os.chdir(repo_root())
    if not SRC.is_dir() or not STYLE.is_file():
        print(f"missing {SRC} or {STYLE}", file=sys.stderr)
        return 2

    vue_files = sorted(SRC.glob("*.vue"))
    # Capture every class token in style.css, including those buried in compound
    # selectors like `.dialog.lg` or `.val-status.warn`. Top-line-only would miss
    # these and produce dozens of false positives.
    global_classes = set(re.findall(rf"\.({TAG})", STYLE.read_text()))

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
    definite = 0
    for sev, f, ln, name, dfile, tag in findings:
        if sev == "DEFINITE":
            definite += 1
        if sev == "DEFINITE" or show_all:
            print(
                f"{sev:<9} {f}:{ln:<4} .{name:<24} on <{tag}>  (scoped in {dfile})"
            )

    drift = 0
    for f in vue_files:
        for cat, ln, msg in token_findings(str(f)):
            drift += 1
            print(f"{cat:<9} {f}:{ln:<4} {msg}")

    if definite or drift:
        print(
            f"\nFAIL: {definite} definite scoped-CSS leak(s), {drift} token-drift finding(s).",
            file=sys.stderr,
        )
        return 1
    suffix = "" if show_all else " (use --all to see ROOT? candidates)"
    print(f"OK: no definite scoped-CSS leaks, no token drift.{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
