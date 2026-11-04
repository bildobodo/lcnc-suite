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

# Every place a scanned file reads from disk or runs a program (Codex R256
# TS256-02): the heavy unit files, every e2e file and every node-side module
# under src. file → (Read(the call's text, how many times, what it reads)).
# A read call the table does not name fails the guard, a named one that is
# gone or counted differently fails it too — a second unknown read is never
# covered by a first known one. `reads` None = an exception with its reason
# (a file the test itself made, the mock serving the built app).
@dataclass(frozen=True)
class Read:
    text: str
    count: int
    reads: tuple[str, ...] | None
    why: str = ""


# The FixtureFiles loader (`text:` / `bytes:` → readFileSync(ROOT/rel)) reads
# the paths collisionFixtures names; collisionBounds reads the model dirs it
# names itself. The guard extracts those literals and requires them here.
HEAVY_LOADER = (
    "examples/sim_config/machine-*/**",
    "examples/sim_config/*.ini",       # their setp lines only (collisionFixtures.iniSetp)
    "lcnc-gateway/machine/**",
)
_LOADER = Read('readFileSync(path.join(ROOT, rel)', 2, HEAVY_LOADER)
_MODEL5 = ("examples/sim_config/machine-5axis-xyzac/**",)
_MODEL_JSON = Read('readFileSync(new URL("machine.json", MODEL)', 1, _MODEL5)
_MODEL_ROUTE = 'readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL))'
_W, _E = "lcnc-webui/src/viewer/", "lcnc-webui/e2e/"

READ_SITES: dict[str, tuple[Read, ...]] = {
    _W + "collisionContacts.test.ts": (_LOADER,),
    _W + "collisionRangeOracle.test.ts": (_LOADER,),
    _W + "contactViewCross.test.ts": (_LOADER,),
    _W + "collisionOracle.test.ts": (_LOADER,),
    _W + "sweepShards.test.ts": (_LOADER,),
    _W + "collisionLineSample.test.ts": (_LOADER,),
    _W + "collisionBounds.test.ts": (
        Read('readFileSync(path.join(dir, "machine.json")', 1, HEAVY_LOADER),
        Read("readFileSync(path.join(dir, partCollisionFile(p)))", 1, HEAVY_LOADER)),
    _E + "bake-hold.viewer.spec.ts": (_MODEL_JSON, Read(_MODEL_ROUTE, 1, _MODEL5)),
    _E + "collisions.viewer.spec.ts": (
        _MODEL_JSON, Read(_MODEL_ROUTE, 1, _MODEL5),
        Read('readFileSync(new URL("../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack"', 2,
             ("scripts/test_fixtures/start_dep_payloads/**",))),
    _E + "reach.viewer.spec.ts": (_MODEL_JSON, Read(_MODEL_ROUTE, 1, _MODEL5)),
    _E + "toolsetter.viewer.spec.ts": (_MODEL_JSON, Read(_MODEL_ROUTE, 4, _MODEL5)),
    _E + "sim-panel.viewer.spec.ts": (
        Read("readFileSync(new URL(`../../scripts/test_fixtures/limit_origin_payloads/", 1,
             ("scripts/test_fixtures/limit_origin_payloads/**",)),),
    _E + "example-tool-library.spec.ts": (
        Read('readFileSync(new URL("../../examples/sim_config/tool-libraries/fusion-freecad.json"', 1,
             ("examples/sim_config/tool-libraries/**",)),
        Read('execFileSync("python3"', 1, ("lcnc-gateway/**", "examples/sim_config/tool-libraries/**"),
             "runs the gateway's import over the library")),
    _E + "freecad-import.spec.ts": (
        Read('readFileSync(new URL("../../test-fixtures/freecad/custom-native.json"', 1, ("test-fixtures/freecad/**",)),),
    _E + "macroFolder.ts": (
        Read('readFileSync(new URL("../../scripts/test_fixtures/macro_refusals.json"', 1,
             ("scripts/test_fixtures/macro_refusals.json",)),),
    _E + "macros.spec.ts": (
        Read("readFileSync((await download.path())!", 1, None, "a file the test downloaded itself"),),
    _E + "mock-gateway.mjs": (
        Read("readFile(f)", 1, None, "serves the built app (dist/) — the mock is central: FULL"),
        Read("existsSync(hold)", 1, None, "the isolation harness's hold file (MOCK_EXIT_HOLD_UNTIL), never set by the suite")),
    _E + "mockFixture.ts": (
        Read("spawn(process.execPath, [MOCK_SCRIPT]", 1, ("lcnc-webui/e2e/mock-gateway.mjs",),
             "starts the worker's own mock"),
        Read("readFileSync(registryPath(slot)", 1, None, "this run's slot-owner registry (a temp file it wrote)")),
}

# Modules only tests import: a runtime walk from the app's and the workers'
# entries, with no cut, must not reach one (Codex R270) — so their unit-only
# rule can never hide a change to what runs.
RUNTIME_ENTRIES = ("main.ts", "App.vue")

# Specs only a FULL rule selects, with the reason no narrower source owns them.
FULL_ONLY = {
    "lifecycle": "the connection's lifecycle: lcncWs, the worker and ws/ — central",
    "smoke": "the app loading without a gateway: main, App and the build — central",
    "mock-baseline": "the per-worker mock's baseline reset (e2e/test.ts) — central",
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


# The test-only tools' rule and its guard read ONE list (Codex R271 FI-I07):
# every file it exempts is a file the runtime walk must not reach.
TEST_ONLY_GLOBS = src("inventory/**", "controlScan.ts", "controlInventory.ts")

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
             "permissions.ts", "machineControls.ts",
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
          W + "playwright.select.config.ts", W + "playwright.gate.config.ts", W + "e2e/mock-gateway.mjs",
          W + "e2e/ctl.ts", W + "e2e/layout-fixtures.ts", W + "e2e/layout-audit.ts",
          W + "e2e/test.ts", W + "e2e/mockFixture.ts", W + "e2e/mockSlot.mjs", W + "e2e/mockSlot.d.mts"),
         "build, test configuration or the shared mock and fixtures",
         browser=FULL, firefox=True),
    Rule((W + "eslint.config.js",), "lint configuration: lint runs in every round",
         none="lint runs in every round"),
    Rule((W + "e2e-proof/**", W + "playwright.proof.config.ts"),
         "the per-worker mock's isolation harness: run by scripts/test_select/proof_harness.py at the "
         "package's acceptance, never by the suite or a gate", none="a proof harness, not a suite test", final=True),
    Rule((W + "scripts/**", W + "tsconfig.test.json", W + "tsconfig.node.json"),
         "node-side tests, configs and tools: type-checked by the build, never in the bundle",
         unit_only=True),
    Rule(src("testGlobals.ts", "shims.d.ts"),
         "types and unit-test globals: the build and the light unit set cover them",
         unit_only=True, final=True),
    Rule(TEST_ONLY_GLOBS,
         "test-only tools — the function inventory's adapters, the template scan and the disarmed "
         "inventory: no app or worker runtime import reaches them (TEST_ONLY, the graph guard); "
         "the light unit set runs their tests in every round",
         unit_only=True, final=True),

    # ── Every component and every module it uses: its rendered surface ───
    Rule((S + "**/*.vue", S + "**/*.ts"),
         "a component, or a module a component renders through: every rendered surface",
         browser=UI_SWEEP, additive=True),

    # ── Areas ────────────────────────────────────────────────────────────
    Rule(src("GcodePanel.vue", "CodeEditor.vue", "codeGlide.ts", "trackHighlight.ts",
             "gcodeHighlight.ts", "gcodeCmLanguage.ts", "gcodeRfl.ts", "subRows.ts",
             "runBasis.ts", "useMdiHistory.ts", "limitMarks.ts", "toolMarks.ts"),
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
    Rule(src("codeGlide.ts", "trackHighlight.ts", "limitMarks.ts", "toolMarks.ts"),
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
