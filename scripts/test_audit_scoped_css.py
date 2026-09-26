"""Pins scripts/audit-scoped-css.py against fixtures (WP2, UI-06).

Every category has a hit AND a non-hit fixture, the template range is
nesting-aware, and the production sources must scan clean. Runs inside the
offline gate as the explicit `audit-css` entry of scripts/test_suite.py
(pytest in lcnc-gateway/ has testpaths=["."] and never discovers scripts/).

    python3 -m pytest scripts/test_audit_scoped_css.py
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "scripts/test_fixtures/audit_css"
STYLE = ROOT / "lcnc-webui/src/style.css"


def _load():
    spec = importlib.util.spec_from_file_location("audit_scoped_css", ROOT / "scripts/audit-scoped-css.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def audit():
    return _load()


def _drift(audit, name: str):
    _, drift, _ = audit.run([FIXTURES / name], style=STYLE)
    return [(cat, ln) for cat, _f, ln, _msg in drift]


def _cats(audit, name: str):
    return sorted(cat for cat, _ in _drift(audit, name))


def test_template_range_is_nesting_aware(audit):
    rng = audit.template_range(str(FIXTURES / "nested_template.vue"))
    lines = (FIXTURES / "nested_template.vue").read_text().splitlines()
    assert rng is not None
    assert lines[rng[0] - 1].startswith("<template>")
    assert lines[rng[1] - 1].startswith("</template>"), "range ended at the NESTED close tag"
    # The real App.vue: the range must reach the top-level close (last line
    # starting with </template>), not the first nested one.
    app = ROOT / "lcnc-webui/src/App.vue"
    app_lines = app.read_text().splitlines()
    top_close = max(i + 1 for i, l in enumerate(app_lines) if l.startswith("</template>"))
    assert audit.template_range(str(app))[1] == top_close


def test_hlpct_flags_the_two_real_keyboardtab_rules(audit):
    hits = _drift(audit, "hlpct_bad.vue")
    assert [c for c, _ in hits] == ["HLPCT", "HLPCT"], hits


def test_hlpct_accepts_the_token_as_a_colour(audit):
    assert "HLPCT" not in _cats(audit, "hlpct_ok.vue")


def test_hl_in_percent_slot_parser(audit):
    f = audit.hl_in_percent_slot
    assert f("color-mix(in oklab, var(--fg) var(--hl-hover), var(--bg))") == ["var(--fg) var(--hl-hover)"]
    assert f("color-mix(in oklab, var(--hl-hover) 50%, transparent)") == []
    assert f("color-mix(in oklab, var(--hl-hover), var(--bg))") == []
    assert f("var(--hl-hover)") == []
    # nested function in the colour slot, percent slot still checked
    assert f("color-mix(in srgb, rgb(1, 2, 3) var(--hl-active), red)") == ["rgb(1, 2, 3) var(--hl-active)"]


def test_zindex_literal_hit_token_ok_audit_ok_suppressed(audit):
    hits = _drift(audit, "zindex.vue")
    assert hits == [("ZINDEX", 9)], hits


def test_important_hit_and_suppressed(audit):
    hits = _drift(audit, "important.vue")
    assert hits == [("IMPORTANT", 9)], hits


def test_inline_static_style_hit_bindings_ok_audit_ok_suppressed(audit):
    hits = _drift(audit, "inline.vue")
    assert hits == [("INLINE", 7)], hits


def test_tofixed_in_template_only(audit):
    hits = _drift(audit, "tofixed.vue")
    assert hits == [("TOFIXED", 8)], hits


def test_tofixed_seen_after_a_nested_template_close(audit):
    hits = _drift(audit, "nested_template.vue")
    assert ("TOFIXED", 13) in hits, hits


def test_close_without_aria_label_hit_named_and_multiline_ok_audit_ok_suppressed(audit):
    hits = _drift(audit, "close.vue")
    assert hits == [("CLOSE", 7)], hits


def test_ellipsis_hit_unicode_and_spread_ok_audit_ok_suppressed(audit):
    hits = _drift(audit, "ellipsis.vue")
    assert hits == [("ELLIPSIS", 7)], hits


def test_unit_literal_hit_mustache_and_template_literal_formatter_ok(audit):
    hits = _drift(audit, "unit_literal.vue")
    assert hits == [("UNIT_LITERAL", 7), ("UNIT_LITERAL", 8)], hits


def test_long_title_static_and_bound_literal_hit_short_and_computed_ok(audit):
    hits = _drift(audit, "long_title.vue")
    assert hits == [("LONG_TITLE", 7), ("LONG_TITLE", 8)], hits


def test_long_reason_template_literal_and_script_constant_hit_short_ok(audit):
    hits = _drift(audit, "long_reason.vue")
    assert sorted(hits) == [("LONG_REASON", 3), ("LONG_REASON", 9)], hits


def test_long_help_slot_and_prop_hit_short_and_multiline_ok(audit):
    hits = _drift(audit, "long_help.vue")
    assert sorted(hits) == [("LONG_HELP", 3), ("LONG_HELP", 5)], hits


def test_dialog_frame_hand_built_overlay_and_role_hit_frame_and_lookalike_ok(audit):
    hits = [h for h in _drift(audit, "dialog_frame.vue") if h[0] == "DIALOG_FRAME"]
    assert sorted(hits) == [("DIALOG_FRAME", 3), ("DIALOG_FRAME", 4)], hits


def test_media_shadow_same_prop_and_later_shorthand_hit(audit):
    # .a padding-left (same prop), .c from a selector list, .d under a later
    # `padding` shorthand. Not: .a top (never set again), .b, .e (a later
    # longhand leaves the rest of the shorthand alive), .f (!important), .g
    # (audit-ok), .h (the media rule comes last), the @keyframes body.
    hits = [h for h in _drift(audit, "media_shadow.vue") if h[0] == "MEDIA_SHADOW"]
    assert sorted(hits) == [("MEDIA_SHADOW", 7), ("MEDIA_SHADOW", 8), ("MEDIA_SHADOW", 9)], hits


def test_media_shadow_scans_stylesheets(audit):
    _, drift, _ = audit.run([], style=STYLE, stylesheets=[FIXTURES / "media_shadow.css"])
    assert [(c, ln) for c, _f, ln, _m in drift] == [("MEDIA_SHADOW", 2)], drift


def test_clean_fixture_has_no_findings(audit):
    assert _drift(audit, "clean.vue") == []


def test_production_sources_scan_clean(audit):
    files = sorted((ROOT / "lcnc-webui/src").rglob("*.vue"))
    assert files, "no .vue sources found"
    leaks, drift, definite = audit.run(files, style=STYLE, stylesheets=[STYLE])
    assert definite == 0, [l for l in leaks if l[0] == "DEFINITE"]
    assert drift == [], drift
