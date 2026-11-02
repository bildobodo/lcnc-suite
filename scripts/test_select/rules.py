"""The test selector's rule table (test strategy, Codex R248–R251, TS248-01).

Every changed path gets a decision: concrete test areas, the full run it
belongs to, or an explicitly named category without product tests. All
rules that match a path are UNITED; a path no rule matches selects the full
frontend AND backend run, named in the gate record — never "the core only".

A rule names:
  browser  spec names (file name without ".spec.ts") or FULL
  backend  the offline backend gate (scripts/test_suite.py --component backend)
  firefox  the pinned Mozilla target's core set (step 6; until it exists the
           record names it pending)
  live     live checks owed before main (never run by the selector)
  none     a reason: the path carries no product test (documentation, agent
           configuration); with `final` it decides alone
  unit_only  nothing beyond the light unit set and the build
  additive   adds its selection to the rules that own a path; a path only
           additive rules match is unmatched (the fail-closed default)

The light unit set (every unit file but HEAVY_UNIT), lint and build run in
every round regardless of the table. A changed spec always runs itself and a
changed unit file always runs (selector.py adds both). An e2e helper selects
the specs that import it, a data file the specs whose declared reads
(SPEC_READS) cover it, and the heavy group runs when one of its files changed,
when `vitest list --changed` reaches one, or when a path lies under
HEAVY_DATA — all computed by selector.py.

Pure: no git, no node, no file reads at import.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

FULL = "full"

# The eight heavy unit files: 88 % of the unit CPU time (2019 of 2291 s at
# 9d152d4e). Exact paths, checked to exist; test_select also checks that no
# other unit file is above HEAVY_THRESHOLD_MS in the recorded timings.
HEAVY_UNIT = (
    "lcnc-webui/src/viewer/collisionContacts.test.ts",
    "lcnc-webui/src/viewer/collisionRangeOracle.test.ts",
    "lcnc-webui/src/viewer/sweepShards.test.ts",
    "lcnc-webui/src/viewer/contactViewCross.test.ts",
    "lcnc-webui/src/viewer/collisionLineSample.test.ts",
    "lcnc-webui/src/viewer/collisionOracle.test.ts",
    "lcnc-webui/src/viewer/collisionBounds.test.ts",
    "lcnc-webui/src/viewer/contactViewIndexed.test.ts",
)
HEAVY_THRESHOLD_MS = 60_000

# What the heavy files read from disk (not imports — `vitest list --changed`
# never sees them, Codex R248 TS248-01). test_select extracts every read
# target of the eight files and of collisionFixtures.ts and requires each one
# under a path here.
HEAVY_DATA = (
    "examples/sim_config/**",
    "lcnc-gateway/machine/**",
)

# The data each spec (or e2e helper) reads from disk outside lcnc-webui:
# a `new URL("../../…", import.meta.url)` or a run of a gateway module.
# test_select requires every such literal in e2e/ to lie under its file's
# entry here.
SPEC_READS = {
    "bake-hold.viewer": ("examples/sim_config/machine-5axis-xyzac/**",),
    "collisions.viewer": ("examples/sim_config/machine-5axis-xyzac/**",
                          "scripts/test_fixtures/start_dep_payloads/**"),
    "reach.viewer": ("examples/sim_config/machine-5axis-xyzac/**",),
    "toolsetter.viewer": ("examples/sim_config/machine-5axis-xyzac/**",),
    "example-tool-library": ("examples/sim_config/tool-libraries/**", "lcnc-gateway/**"),
    "freecad-import": ("test-fixtures/freecad/**",),
    # e2e/macroFolder.ts, imported by these specs
    "macroFolder": ("scripts/test_fixtures/macro_refusals.json",),
}

# Specs only a FULL rule selects, with the reason no narrower source owns them.
FULL_ONLY = {
    "lifecycle": "the connection's lifecycle: lcncWs, the worker and ws/ — central",
    "smoke": "the app loading without a gateway: main, App and the build — central",
}

# ── Spec groups ──────────────────────────────────────────────────────────
# Every rendered surface: what any component change can move or recolour.
UI_SWEEP = ("layout", "layout-audit", "contrast", "visual", "dialogs")
VIEWER = ("bake-hold.viewer", "collisions.viewer", "fatpaths.viewer", "findings.viewer",
          "rapids.viewer", "reach.viewer", "scenes.viewer", "sim-panel.viewer",
          "toolsetter.viewer", "viewcube.viewer", "viewer", "frames")
PROGRAM = ("editor-guards", "run-hold", "safety-during-edit", "input-session",
           "keyboard-guards", "feedback-channels", "disarmed", "tabs", "select-writes",
           "sim-panel.viewer")
TOOLS = ("example-tool-library", "freecad-import", "tool-geometry", "tool-holder",
         "tool-import", "tool-table-read")
TOOLSETTER = ("toolsetter-setup", "g30", "forms", "toolsetter.viewer")
PROBING = ("probe-click", "forms", "disarmed", "tabs")
SETUP = ("offsets", "touchoff", "setup-gates", "setup-layout", "choices", "nine-axis")
STRIP = ("joint-jog", "keyboard-guards", "touch-hold", "touch-surface", "armed", "disarmed",
         "choices", "setup-layout", "safety-during-edit", "setup-gates", "input-session")
SETTINGS = ("forms", "appearance", "select-writes", "tabs", "disarmed", "feedback-channels",
            "keyboard-guards", "scenes.viewer")
MACROS = ("macros", "run-hold", "disarmed")
MESSAGES = ("messages", "feedback-channels")


@dataclass(frozen=True)
class Rule:
    globs: tuple[str, ...]
    why: str
    browser: tuple[str, ...] | str = ()
    backend: bool = False
    firefox: bool = False
    live: tuple[str, ...] = ()
    none: str | None = None
    unit_only: bool = False
    final: bool = False     # a match decides alone (documentation)
    additive: bool = False  # adds to an owning rule, never owns a path alone


W = "lcnc-webui/"
S = W + "src/"


def src(*names: str) -> tuple[str, ...]:
    return tuple(S + n for n in names)


RULES: tuple[Rule, ...] = (
    # ── No product code: decides alone ───────────────────────────────────
    Rule(("docs/**", "*.md", "**/README.md", "subroutines/**/*.md", ".claude/**", "LICENSE",
          "NOTICE", ".gitattributes", "**/.gitignore", W + ".vscode/**", ".github/**"),
         "documentation, agent and CI configuration (CI proves itself on GitHub)",
         none="no product code", final=True),

    # ── Central: every surface or every connection depends on it ─────────
    Rule(src("style.css", "assets/**", "main.ts", "App.vue", "lcncWs.ts", "wsWorker.ts",
             "lcncApi.ts", "auth.ts", "connKey.ts", "ws/**", "modalRegistry.ts",
             "DialogFrame.vue", "TabNav.vue", "TabPanel.vue", "tabIds.ts", "ChoiceGroup.vue",
             "MachineChoice.vue", "choiceGroup.ts", "btnHint.ts", "FloatingOverlays.vue",
             "gateExplain.ts", "useNumberKeypad.ts", "inputSession.ts", "NumberKeypadStrip.vue",
             "TextKeypadStrip.vue", "textKeyboardPages.ts", "mathEval.ts", "Btn.vue",
             "MachineBtn.vue", "MachineInput.vue", "MachineToggle.vue", "MachineSlider.vue",
             "MachineSelect.vue", "MachineRadio.vue", "MachineColor.vue", "Gate.vue",
             "permissions.ts", "machineControls.ts", "controlScan.ts", "controlInventory.ts",
             "actionAdmission.ts", "lcnc.ts", "defaults.ts", "settingsSaveStatus.ts",
             "format.ts", "useAxes.ts", "useKeyboardShortcuts.ts", "touchDetect.ts",
             "sidePaneNarrow.ts", "stickyHead.ts", "scrollFade.ts", "helpPlacement.ts",
             "HelpIcon.vue", "FormField.vue", "MoreMenu.vue", "DetailsPopover.vue",
             "useMediaMql.ts", "flashClock.ts", "useDialogState.ts",
             "dragScroll.ts", "clientDiag.ts", "wakeLock.ts", "StatsDonut.vue"),
         "central: every surface, every dialog or every connection depends on it",
         browser=FULL, firefox=True),
    Rule(src("macroFiles.ts", "runBasis.ts", "viewerPerf.ts", "viewer/eventIndex.ts",
             "viewer/kinematics.ts", "viewer/kins.ts", "viewer/partFrame.ts",
             "viewer/tloEvents.ts", "viewer/wcsEpochs.ts"),
         "the connection's status and bulk path (lcncWs, ws/statusStore, ws/bulkData) "
         "imports it: every status-driven surface (graph.py)",
         browser=FULL),
    Rule((W + "index.html", W + "package.json", W + "package-lock.json", W + ".npmrc",
          W + "vite.config.ts", W + "viteHttpRestartPing.ts", W + "vitest.config.ts",
          W + "tsconfig.json", W + "tsconfig.app.json", W + "playwright.config.ts",
          W + "playwright.select.config.ts", W + "e2e/mock-gateway.mjs",
          W + "e2e/ctl.ts", W + "e2e/layout-fixtures.ts", W + "e2e/layout-audit.ts"),
         "build, test configuration or the shared mock and fixtures",
         browser=FULL, firefox=True),
    Rule((W + "eslint.config.js",), "lint configuration: lint runs in every round",
         none="lint runs in every round"),
    Rule((W + "scripts/**", W + "tsconfig.test.json", W + "tsconfig.node.json"),
         "node-side tests, configs and tools: type-checked by the build, never in the bundle",
         unit_only=True),
    Rule(src("testGlobals.ts", "shims.d.ts"),
         "types and unit-test globals: the build and the light unit set cover them",
         unit_only=True, final=True),

    # ── Every component and every module it uses: its rendered surface ───
    Rule((S + "**/*.vue", S + "**/*.ts"),
         "a component, or a module a component renders through: every rendered surface",
         browser=UI_SWEEP, additive=True),

    # ── Areas ────────────────────────────────────────────────────────────
    Rule(src("GcodePanel.vue", "CodeEditor.vue", "codeGlide.ts", "trackHighlight.ts",
             "gcodeHighlight.ts", "gcodeCmLanguage.ts", "gcodeRfl.ts", "subRows.ts",
             "runBasis.ts", "useMdiHistory.ts", "limitMarks.ts"),
         "the program panel, its editor and the run", browser=PROGRAM),
    Rule(src("FileBrowser.vue", "browseFailure.ts", "download.ts"),
         "the file browser: programs, macros and tool import",
         browser=PROGRAM + ("macros", "tool-import", "example-tool-library")),
    Rule(src("GcodeReferenceDialog.vue", "gcodeRefView.ts", "gcodeReference.ts"),
         "the G-code reference", browser=("gcode-reference", "editor-guards")),
    Rule(src("MessagesDialog.vue", "messageView.ts"), "the message center", browser=MESSAGES),
    Rule(src("ProbePanel.vue", "probeFields.ts", "probeViews.ts", "probeVars.ts",
             "CornerGlyph.vue", "axisColors.ts"),
         "the probing panel and its glyphs", browser=PROBING, firefox=True,
         live=("probe-live",)),
    Rule(src("ToolsetterSettings.vue", "toolsetterSetup.ts", "toolsetterVars.ts",
             "g30Form.ts", "g30Shared.ts"),
         "the toolsetter form and G30", browser=TOOLSETTER, live=("toolsetter-readback",)),
    Rule(src("ToolTablePanel.vue", "ToolPreview.vue", "ToolStrip.vue", "toolHolder.ts",
             "toolImportSummary.ts", "toolPreviewNotice.ts", "toolUnits.ts", "toolTypes.ts"),
         "the tool table, import and preview", browser=TOOLS),
    Rule(src("toolGeometry.ts"), "tool geometry: the table's preview and the 3D tool",
         browser=TOOLS + VIEWER),
    Rule(src("OffsetPanel.vue", "offsetRows.ts", "useTouchoffMath.ts", "SetupStrip.vue",
             "SetupActions.vue", "SetupIcon.vue", "setupLayout.ts"),
         "offsets, touch-off and the Setup section", browser=SETUP,
         live=("twp-buttons",)),
    Rule(src("wcs.ts", "twpPose.ts"), "fixtures and the plane pose: Setup and the viewer",
         browser=SETUP + VIEWER, live=("twp-buttons",)),
    Rule(src("JogStrip.vue", "jointJog.ts", "jogGesture.ts", "useJogPointers.ts",
             "SafetyStrip.vue", "safetyFold.ts", "OverridesStrip.vue", "SpindleStrip.vue"),
         "the strip's machine controls", browser=STRIP, live=("twp-buttons",)),
    Rule(src("SettingsPanel.vue", "GamepadTab.vue", "GamepadLiveInput.vue",
             "GamepadMapWizard.vue", "gamepadProfile.ts", "useGamepad.ts", "KeyboardTab.vue",
             "HalshowTab.vue", "DebugTab.vue", "viewerLayerGroups.ts", "viewerSection.ts"),
         "the settings tabs", browser=SETTINGS),
    Rule(src("MacrosPanel.vue", "MacroBar.vue", "macroBar.ts", "macroFiles.ts",
             "macroHeader.ts", "macroParams.ts", "macroTemplate.ts", "useMacros.ts"),
         "macros", browser=MACROS, live=("macro-live",)),
    Rule(src("ThreeViewer.vue", "ViewCube.vue", "ScrubBar.vue", "SimPanel.vue",
             "simPanelStore.ts", "simMode.ts", "CameraPip.vue", "viewer/**",
             "previewWorker.ts", "previewDecode.ts", "edgeWorker.ts", "viewerPerf.ts",
             "geometryCache.ts"),
         "the viewer, the preview and the simulation", browser=VIEWER + ("layout",)),
    Rule(src("previewWorker.ts", "previewDecode.ts"), "the preview's decode",
         live=("live-twp",)),

    # ── Modules several areas render through (graph.py names them) ───────
    Rule(src("axisColors.ts", "viewer/labelFont.ts"), "axis colours and the label font: probing glyphs and the viewer",
         browser=PROBING + VIEWER),
    Rule(src("codeGlide.ts", "trackHighlight.ts", "limitMarks.ts"),
         "the running line and the marks: the code panel and the Sim tab", browser=PROGRAM + VIEWER),
    Rule(src("download.ts"), "a file saved: programs, macros, tool tables", browser=PROGRAM + MACROS + TOOLS),
    Rule(src("gcodeRefView.ts", "gcodeReference.ts"), "the reference opened from the code panel",
         browser=PROGRAM),
    Rule(src("g30Shared.ts", "toolHolder.ts", "toolUnits.ts", "viewer/toolOffsetState.ts"),
         "tool and G30 values the 3D view draws", browser=TOOLS + TOOLSETTER + VIEWER),
    Rule(src("toolsetterSetup.ts", "toolsetterVars.ts", "probeFields.ts"),
         "the toolsetter's values: the form, the measure from the table, run from line, the setter in 3D",
         browser=TOOLSETTER + TOOLS + PROGRAM + VIEWER + PROBING),
    Rule(src("viewer/activeFixtureFrame.ts", "viewer/programZero.ts", "viewer/twpPlaneFrame.ts"),
         "the work frame: the viewer's marker and the Setup section", browser=VIEWER + SETUP),
    Rule(src("viewer/colourMath.ts", "viewer/customContrast.ts", "viewer/palette.ts",
             "viewer/palettePairs.ts", "viewer/viewerPalette.ts"),
         "the viewer's colours and their settings", browser=VIEWER + SETTINGS),

    # ── Outside the frontend ─────────────────────────────────────────────
    Rule(("lcnc-gateway/**",), "the gateway: the browser suite runs against the mock",
         backend=True),
    Rule(("lcnc-gateway/command_policy.py", "lcnc-gateway/gateway.py"),
         "command admission: the motion buttons", live=("twp-buttons",)),
    Rule(("lcnc-gateway/gateway.py", "lcnc-gateway/status_runtime.py",
          "lcnc-gateway/ws_fanout.py", "lcnc-gateway/hal_*.py", "lcnc-gateway/session_bind.py"),
         "the status loop and the safety chain", live=("perf-matrix",)),
    Rule(("lcnc-gateway/gcode_*.py", "lcnc-gateway/bulk_pipeline.py",
          "lcnc-gateway/native_*_probe.py"),
         "the parse and its native parity", live=("live-twp",)),
    Rule(("lcnc-gateway/macro_files.py",), "macro files", live=("macro-live",)),
    Rule(("examples/**",), "the shipped examples: backend, models, var files",
         backend=True),
    Rule(("examples/sim_config/*/*.var",), "a shipped var file: the probe numbers",
         live=("probe-live",)),
    Rule(("subroutines/**",), "the bundled routines", backend=True,
         live=("probe-live", "toolsetter-readback")),
    Rule(("scripts/**",), "scripts and their tests ride the backend gate", backend=True),
    Rule(("test-fixtures/**",), "fixtures of the tool import", backend=True),
    Rule(("lcnc-suite", "install.sh", "restart.sh", "kill.sh"),
         "the launcher and the install scripts", backend=True, live=("perf-matrix",)),
)


# ── Globs ────────────────────────────────────────────────────────────────
def glob_re(glob: str) -> re.Pattern[str]:
    """`**` crosses directories, `*` and `?` stay inside one; anchored."""
    out, i = [], 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


_COMPILED: dict[str, re.Pattern[str]] = {}


def matches(glob: str, path: str) -> bool:
    pat = _COMPILED.get(glob)
    if pat is None:
        pat = _COMPILED[glob] = glob_re(glob)
    return pat.match(path) is not None


@dataclass
class Decision:
    """What one changed path selects; the union of every matching rule."""
    path: str
    rules: list[str] = field(default_factory=list)
    browser: set[str] = field(default_factory=set)
    browser_full: bool = False
    backend: bool = False
    heavy: bool = False
    firefox: bool = False
    live: set[str] = field(default_factory=set)
    none: str | None = None
    unmatched: bool = False


def decide(path: str, rules: tuple[Rule, ...] = RULES) -> Decision:
    d = Decision(path)
    owned = False
    for rule in rules:
        if not any(matches(g, path) for g in rule.globs):
            continue
        if rule.final:
            d.rules, d.none = [rule.why], rule.none
            return d
        d.rules.append(rule.why)
        owned |= not rule.additive
        if rule.browser == FULL:
            d.browser_full = True
        else:
            d.browser.update(rule.browser)
        d.backend |= rule.backend
        d.firefox |= rule.firefox
        d.live.update(rule.live)
    if not owned:
        d.unmatched = True     # fail closed: the full frontend and backend runs
        d.browser_full = d.backend = d.heavy = True
    return d
