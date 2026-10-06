# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rapids.viewer.spec.ts >> a finding shows its own move of a hidden layer — not the layer
- Location: e2e/rapids.viewer.spec.ts:125:1

# Error details

```
Error: with every rapid shown the longest runs along X

expect(received).toBeGreaterThan(expected)

Expected: > 0.95
Received:   0.9198662110077999
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: LinuxCNC WebUI (local)
    - generic [ref=e6]:
      - generic [ref=e7]: 07:20:55
      - generic [ref=e10]: WS connected
      - generic [ref=e11]: "LCNC: -"
      - generic [ref=e14]: ARMED
      - generic "Keyboard shortcuts active" [ref=e15]:
        - img [ref=e16]
      - generic [ref=e18]:
        - button "Connection details" [ref=e20] [cursor=pointer]:
          - img [ref=e21]
        - button "Messages (0)" [ref=e23] [cursor=pointer]:
          - img [ref=e24]
        - button "G-code Reference" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
        - button "Settings" [ref=e29] [cursor=pointer]:
          - img [ref=e30]
        - button "Fullscreen" [ref=e33] [cursor=pointer]:
          - img [ref=e34]
        - button "Shut Down" [ref=e43] [cursor=pointer]:
          - img [ref=e44]
          - generic [ref=e48]: Shut Down
  - generic [ref=e51] [cursor=pointer]: MACHINE OFF
  - group [ref=e52]:
    - generic [ref=e55]:
      - generic:
        - generic:
          - generic:
            - generic: Work · G54
            - generic: Machine
            - generic: X
            - generic: "1.111"
            - generic: —
            - generic: "Y"
            - generic: "2.222"
            - generic: —
            - generic: Z
            - generic: "3.333"
            - generic: —
            - generic: A
            - generic: 4.44°
            - generic: —
            - generic: C
            - generic: 5.55°
            - generic: —
            - generic: F
            - generic: —
            - generic: S
            - generic: —
          - generic: T— · Ø— · L—
      - generic [ref=e59]:
        - button "Reset view" [ref=e60] [cursor=pointer]: Reset
        - button "Clear backplot" [ref=e61] [cursor=pointer]: Clear
        - button "Show camera" [ref=e62] [cursor=pointer]:
          - img [ref=e63]
        - button "3D Viewer settings" [ref=e66] [cursor=pointer]:
          - img [ref=e67]
      - generic:
        - generic:
          - generic:
            - generic "Machine kinematics — jogs move the machine axes": MACHINE · G54
            - generic: 2 limit violations
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73] [cursor=pointer]:
              - checkbox "Sim" [ref=e74]
              - text: Sim
            - 'button "Help: Sim" [ref=e75] [cursor=pointer]': "?"
          - button "Play the program through the machine model" [ref=e76] [cursor=pointer]:
            - img [ref=e77]
          - generic [ref=e79]:
            - slider "Scrub the program — poses the machine model, nothing moves" [disabled] [ref=e80]: "0"
            - generic:
              - generic:
                - img
            - generic:
              - generic:
                - img
          - generic [ref=e81]: 0 %
    - generic [ref=e83]:
      - tablist "Side panel" [ref=e85]:
        - tab "Program" [ref=e86] [cursor=pointer]
        - tab "MDI" [ref=e87] [cursor=pointer]
        - tab "Probing" [ref=e88] [cursor=pointer]
        - tab "Offsets" [ref=e89] [cursor=pointer]
        - tab "Tools" [ref=e90] [cursor=pointer]
        - tab "Macros" [ref=e91] [cursor=pointer]
        - tab "Sim" [active] [selected] [ref=e92] [cursor=pointer]
      - tabpanel "Sim" [ref=e94]:
        - generic [ref=e95]:
          - generic [ref=e96]:
            - generic [ref=e97]: Speed
            - combobox "Playback speed" [ref=e98]:
              - option "×0.1"
              - option "×0.2"
              - option "×0.5"
              - option "×1" [selected]
              - option "×2"
              - option "×5"
              - option "×10"
              - option "×20"
              - option "×50"
              - option "×100"
            - generic [ref=e99]: 0 %
          - generic [ref=e100]:
            - generic [ref=e101]: Collision check
            - progressbar "Collision check progress" [ref=e102]
            - generic [ref=e103]: 0 %
            - 'button "Help: Collision check" [ref=e104] [cursor=pointer]': "?"
          - generic [ref=e105]: No moving pairs
          - generic [ref=e106]:
            - combobox "Show on the list" [ref=e107]:
              - option "All (2)"
              - option "Collisions (0)"
              - option "Limit violations (2)" [selected]
              - option "Tool changes (0)"
            - button "Previous limit violation" [ref=e108] [cursor=pointer]:
              - img [ref=e109]
            - button "Next limit violation" [ref=e111] [cursor=pointer]:
              - img [ref=e112]
            - 'button "Help: Timeline list" [ref=e114] [cursor=pointer]': "?"
          - table [ref=e116]:
            - rowgroup [ref=e117]:
              - row "Kind Line What Move Time" [ref=e118]:
                - columnheader "Kind" [ref=e119]
                - columnheader "Line" [ref=e120]
                - columnheader "What" [ref=e121]
                - columnheader "Move" [ref=e122]
                - columnheader "Time" [ref=e123]
            - rowgroup [ref=e124]:
              - 'row "Show L7: Y 0 mm < min 1 mm Y 0 mm < min 1 mm 58 %" [ref=e125] [cursor=pointer]':
                - cell [ref=e126]:
                  - img [ref=e127]
                - 'cell "Show L7: Y 0 mm < min 1 mm" [ref=e129]':
                  - 'button "Show L7: Y 0 mm < min 1 mm" [ref=e130]': L7
                - cell "Y 0 mm < min 1 mm" [ref=e131]
                - cell [ref=e132]
                - cell "58 %" [ref=e133]
              - 'row "Show L14: Y 27 mm > max 25 mm Y 27 mm > max 25 mm 99 %" [ref=e134] [cursor=pointer]':
                - cell [ref=e135]:
                  - img [ref=e136]
                - 'cell "Show L14: Y 27 mm > max 25 mm" [ref=e138]':
                  - 'button "Show L14: Y 27 mm > max 25 mm" [ref=e139]': L14
                - cell "Y 27 mm > max 25 mm" [ref=e140]
                - cell [ref=e141]
                - cell "99 %" [ref=e142]
  - group "Safety Disarm E-Stop E-Stop CLEAR Power OFF Axes HOMED Overrides NONE Mode MANUAL Interp IDLE Motion JOINT Elapsed 00:00 Active codes — open in the G-code reference" [ref=e143]:
    - generic [ref=e145]:
      - generic [ref=e146]: Safety
      - generic [ref=e147]:
        - button "Disarm" [ref=e149] [cursor=pointer]:
          - img [ref=e150]
          - generic [ref=e154]: Disarm
        - button "E-Stop" [ref=e156] [cursor=pointer]:
          - img [ref=e157]
          - generic [ref=e160]: E-Stop
        - group [ref=e161]:
          - button "Power on" [ref=e162] [cursor=pointer]:
            - img [ref=e163]
            - generic [ref=e166]: Power on
      - generic [ref=e167]:
        - generic [ref=e168]:
          - generic [ref=e169]:
            - generic [ref=e170]:
              - generic [ref=e171]: E-Stop
              - generic [ref=e174]: CLEAR
            - generic [ref=e175]:
              - generic [ref=e176]: Power
              - generic [ref=e179]: "OFF"
            - generic [ref=e180]:
              - generic [ref=e181]: Axes
              - generic [ref=e184]: HOMED
            - generic [ref=e185]:
              - generic [ref=e186]: Overrides
              - generic [ref=e189]: NONE
          - generic [ref=e190]:
            - generic [ref=e191]:
              - generic [ref=e192]: Mode
              - generic [ref=e195]: MANUAL
            - generic [ref=e196]:
              - generic [ref=e197]: Interp
              - generic [ref=e200]: IDLE
            - generic [ref=e201]:
              - generic [ref=e202]: Motion
              - generic [ref=e205]: JOINT
            - generic [ref=e206]:
              - generic [ref=e207]: Elapsed
              - generic [ref=e208]: 00:00
        - button "Active codes — open in the G-code reference" [ref=e210] [cursor=pointer]:
          - img [ref=e214]
    - generic [ref=e217]:
      - generic [ref=e218]: Jog
      - generic [ref=e219]:
        - generic [ref=e220]:
          - generic [ref=e222]:
            - button [ref=e223] [cursor=pointer]:
              - generic:
                - img
            - button "Y+" [ref=e224] [cursor=pointer]:
              - generic:
                - img
                - generic: Y+
            - button [ref=e225] [cursor=pointer]:
              - generic:
                - img
            - button "X-" [ref=e226] [cursor=pointer]:
              - generic:
                - img
                - generic: X-
            - button "Stop" [ref=e227] [cursor=pointer]:
              - generic:
                - img
                - generic: Stop
            - button "X+" [ref=e228] [cursor=pointer]:
              - generic:
                - img
                - generic: X+
            - button [ref=e229] [cursor=pointer]:
              - generic:
                - img
            - button "Y-" [ref=e230] [cursor=pointer]:
              - generic:
                - img
                - generic: Y-
            - button [ref=e231] [cursor=pointer]:
              - generic:
                - img
          - generic [ref=e232]:
            - button "Z+" [ref=e233] [cursor=pointer]:
              - generic:
                - img
                - generic: Z+
            - button "Z-" [ref=e234] [cursor=pointer]:
              - generic:
                - img
                - generic: Z-
          - generic [ref=e235]:
            - generic [ref=e236]:
              - button "A+" [ref=e237] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A+
              - button "A-" [ref=e238] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A-
            - generic [ref=e239]:
              - button "C+" [ref=e240] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C+
              - button "C-" [ref=e241] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C-
        - generic [ref=e242]:
          - generic [ref=e243]:
            - generic [ref=e244]: Linear
            - generic [ref=e245]:
              - generic [ref=e246]: "600"
              - generic [ref=e247]: mm/min
            - slider "Linear jog speed" [ref=e248] [cursor=pointer]: "10"
            - button "Reset linear jog speed to 600 mm/min" [ref=e249] [cursor=pointer]: "600"
          - generic [ref=e250]:
            - generic [ref=e251]: Rotary
            - generic [ref=e252]:
              - generic [ref=e253]: "600"
              - generic [ref=e254]: °/min
            - slider "Rotary jog speed" [ref=e255] [cursor=pointer]: "10"
            - button "Reset rotary jog speed to 600 °/min" [ref=e256] [cursor=pointer]: "600"
        - generic [ref=e257]:
          - generic [ref=e258]:
            - generic [ref=e259]: Step (mm / °)
            - radiogroup "Jog step" [ref=e261]:
              - radio "Cont" [checked] [ref=e262] [cursor=pointer]
              - radio ".001" [ref=e263] [cursor=pointer]
              - radio ".01" [ref=e264] [cursor=pointer]
              - radio ".1" [ref=e265] [cursor=pointer]
              - radio "1" [ref=e266] [cursor=pointer]
          - generic [ref=e267]:
            - generic [ref=e268]: Mode
            - toolbar "Task mode" [ref=e269]:
              - radiogroup "Task mode" [ref=e270]:
                - radio "Manual" [checked] [ref=e271] [cursor=pointer]
                - radio "MDI" [ref=e272] [cursor=pointer]
                - radio "Auto" [ref=e273] [cursor=pointer]
          - generic [ref=e274]:
            - generic [ref=e275]:
              - text: Kinematics Frame
              - 'button "Help: Kinematics Frame" [ref=e276] [cursor=pointer]': "?"
            - toolbar "Kinematics frame" [ref=e277]:
              - radiogroup "Kinematics frame" [ref=e278]:
                - radio "Machine" [checked] [ref=e279] [cursor=pointer]
                - radio "TCP" [ref=e280] [cursor=pointer]
    - generic [ref=e281]:
      - generic [ref=e282]:
        - text: Setup
        - 'button "Help: Go to positions" [ref=e283] [cursor=pointer]': "?"
      - generic [ref=e284]:
        - generic [ref=e285]:
          - generic [ref=e286]:
            - generic [ref=e287]:
              - textbox "Touch off X · Machine · G54" [ref=e288] [cursor=pointer]: "1.111"
              - button "Zero X" [ref=e289] [cursor=pointer]:
                - img [ref=e290]
                - text: X
              - button "Unhome X" [ref=e294] [cursor=pointer]:
                - img [ref=e295]
                - text: X
              - textbox "Touch off Y · Machine · G54" [ref=e299] [cursor=pointer]: "2.222"
              - button "Zero Y" [ref=e300] [cursor=pointer]:
                - img [ref=e301]
                - text: "Y"
              - button "Unhome Y" [ref=e305] [cursor=pointer]:
                - img [ref=e306]
                - text: "Y"
              - textbox "Touch off Z · Machine · G54" [ref=e310] [cursor=pointer]: "3.333"
              - button "Zero Z" [ref=e311] [cursor=pointer]:
                - img [ref=e312]
                - text: Z
              - button "Unhome Z" [ref=e316] [cursor=pointer]:
                - img [ref=e317]
                - text: Z
            - generic [ref=e321]:
              - textbox "Touch off A · Machine · G54" [ref=e322] [cursor=pointer]: "4.44"
              - button "Zero A" [ref=e323] [cursor=pointer]:
                - img [ref=e324]
                - text: A
              - button "Unhome A" [ref=e328] [cursor=pointer]:
                - img [ref=e329]
                - text: A
              - textbox "Touch off C · Machine · G54" [ref=e333] [cursor=pointer]: "5.55"
              - button "Zero C" [ref=e334] [cursor=pointer]:
                - img [ref=e335]
                - text: C
              - button "Unhome C" [ref=e339] [cursor=pointer]:
                - img [ref=e340]
                - text: C
          - generic [ref=e344]:
            - button "Zero XYZ" [ref=e345] [cursor=pointer]:
              - img [ref=e346]
              - text: Zero XYZ
            - button "Unhome All" [ref=e350] [cursor=pointer]:
              - img [ref=e351]
              - generic [ref=e356]: Unhome All
          - generic [ref=e357]:
            - button "Go to G30" [ref=e358] [cursor=pointer]
            - button "Go to MCS 0" [ref=e359] [cursor=pointer]
            - button "Go to WCS 0" [ref=e360] [cursor=pointer]
        - generic [ref=e361]:
          - generic [ref=e362]:
            - generic [ref=e363]: WCS
            - generic "Machine kinematics — jogs move the machine axes" [ref=e364]: MACHINE
          - toolbar "Work offset" [ref=e365]:
            - radiogroup "Work offset" [ref=e366]:
              - radio "G54" [checked] [ref=e367] [cursor=pointer]
              - radio "G55" [ref=e368] [cursor=pointer]
              - radio "G56" [ref=e369] [cursor=pointer]
              - radio "G57" [ref=e370] [cursor=pointer]
              - radio "G58" [ref=e371] [cursor=pointer]
              - radio "G59" [ref=e372] [cursor=pointer]
              - radio "G59.1" [ref=e373] [cursor=pointer]
              - radio "G59.2" [ref=e374] [cursor=pointer]
              - radio "G59.3" [ref=e375] [cursor=pointer]
    - group [ref=e376]:
      - generic [ref=e377]: Overrides
      - generic [ref=e378]:
        - generic [ref=e379]:
          - generic [ref=e380]: Feed
          - generic [ref=e381]: 100 %
          - slider "Feed override" [disabled] [ref=e382]: "100"
          - button "Reset feed override to 100 %" [ref=e383] [cursor=pointer]: 100 %
        - generic [ref=e384]:
          - generic [ref=e385]: Spindle
          - generic [ref=e386]: 100 %
          - slider "Spindle override" [disabled] [ref=e387]: "100"
          - button "Reset spindle override to 100 %" [ref=e388] [cursor=pointer]: 100 %
        - generic [ref=e389]:
          - generic [ref=e390]: Rapid
          - generic [ref=e391]: 100 %
          - slider "Rapid override" [disabled] [ref=e392]: "100"
          - button "Reset rapid override to 100 %" [ref=e393] [cursor=pointer]: 100 %
    - generic [ref=e394]:
      - generic [ref=e395]: Spindle
      - group [ref=e396]:
        - generic [ref=e397]:
          - button "Rev" [ref=e398] [cursor=pointer]:
            - generic [ref=e399]:
              - img [ref=e400]
              - text: Rev
          - button "Why is this unavailable? Spindle is already stopped" [ref=e403]:
            - button "Stop" [disabled]:
              - generic:
                - img
                - text: Stop
          - button "Fwd" [ref=e404] [cursor=pointer]:
            - generic [ref=e405]:
              - img [ref=e406]
              - text: Fwd
        - generic [ref=e409]:
          - button [ref=e410] [cursor=pointer]:
            - img [ref=e411]
          - textbox "Spindle speed" [ref=e412] [cursor=pointer]: "1000"
          - button [ref=e413] [cursor=pointer]:
            - img [ref=e414]
      - generic [ref=e416]:
        - generic [ref=e417]: Coolant
        - generic [ref=e418]:
          - generic [ref=e420] [cursor=pointer]:
            - checkbox "Flood" [ref=e421]
            - text: Flood
          - generic [ref=e423] [cursor=pointer]:
            - checkbox "Mist" [ref=e424]
            - text: Mist
    - generic [ref=e426]:
      - generic [ref=e427]: Tool
      - button "Tool Table" [ref=e428] [cursor=pointer]
      - generic [ref=e429]: No tool loaded
```

# Test source

```ts
  40  |   await expect(reveal).toHaveCount(0);
  41  | 
  42  |   // A jump to the finding on the hidden rapid (entering the simulation at a
  43  |   // stopped machine): the rapids show for it, named, the stored choice untouched.
  44  |   await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
  45  |   await next.click();
  46  |   await expect(page.locator(".simBanner")).toBeVisible();
  47  |   await expect(reveal).toHaveText("Rapids shown for this finding — hidden in Layers");
  48  |   await expect.poll(() => shown("rapid"), { message: "shown for the finding" }).toBe(true);
  49  | 
  50  |   // A manual scrub ends it: the stored choice stands again.
  51  |   await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
  52  |     el.value = String(Number(el.max) * 0.2);
  53  |     el.dispatchEvent(new Event("input", { bubbles: true }));
  54  |   });
  55  |   await expect(reveal).toHaveCount(0);
  56  |   await expect.poll(() => shown("rapid"), { message: "hidden again after a manual scrub" }).toBe(false);
  57  | 
  58  |   // Again. A settings refresh that leaves the layer as it is — a theme
  59  |   // switch, the same stored choice again — keeps it (Codex R31 VP-I01: every
  60  |   // refresh re-applies every layer, and each used to end the view).
  61  |   await next.click();
  62  |   await expect(reveal).toHaveCount(1);
  63  |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "dark" }, viewer: { layers: { rapids: false } } } } });
  64  |   await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  65  |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { layers: { rapids: false } } } } });
  66  |   await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  67  |   await expect(reveal, "an unchanged layer choice keeps the finding's view").toHaveCount(1);
  68  |   expect(await shown("rapid")).toBe(true);
  69  |   // A real change of the choice — here or from another client — ends it:
  70  |   // the layer is the operator's.
  71  |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: true } } } } });
  72  |   await expect(reveal).toHaveCount(0);
  73  |   await expect.poll(() => shown("rapid")).toBe(true);
  74  | });
  75  | 
  76  | // The view a finding opens on a hidden layer is told whatever else the
  77  | // viewer shows (Codex R31 VP-I02): with the HUD off the findings card held
  78  | // nothing, and folded it hid the line behind "N warnings" — a layer the
  79  | // operator switched off must never come back unexplained.
  80  | for (const form of ["hud-off", "folded"] as const) {
  81  |   test(`a finding's view on hidden rapids is told — ${form}`, async ({ page, context }) => {
  82  |     test.setTimeout(90_000);
  83  |     await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  84  |     await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
  85  |       body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(rapids)" : `G1 X${i} F100`).join("\n") }));
  86  |     await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === (form === "folded" ? "touch-portrait" : "desktop"))!);
  87  |     await ctl({ op: "status_delta", data: { active_file: "/rapids.ngc", is_enabled: false, enabled: false,
  88  |       ...(form === "folded" ? { eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } : {}) } });
  89  |     await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: form === "folded" ? 972 : 971, file: "/rapids.ngc" } });
  90  |     await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  91  |     if (form === "folded") await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  92  |     await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false, ...(form === "hud-off" ? { hud: false } : {}) } } } } });
  93  |     await settleLayout(page);
  94  |     if (form === "hud-off") await expect(page.locator(".viewerPane .hud")).toBeHidden();
  95  |     else await expect(page.locator(".viewerPane .hudNotes.needsCompact"), "the warnings card folds at 150 % portrait").toHaveCount(1);
  96  |     await simShow(page, "limit");
  97  |     const next = simStepBtn(page, "Next limit violation");
  98  |     await next.click();
  99  |     await expect(page.locator(".simBanner")).toBeVisible();
  100 |     await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("rapid") != null), { message: "shown for the finding" }).toBe(true);
  101 |     await expect(page.locator("[data-path-reveal]"), "the view is named on screen").toBeVisible();
  102 |     await expect(page.locator("[data-path-reveal]")).toHaveText("Rapids shown for this finding — hidden in Layers");
  103 |     if (form === "folded") {
  104 |       await expect(page.locator(".viewerPane .hudNotes.needsCompact"), "the other warnings stay folded").toHaveCount(1);
  105 |       // Comp Z, the rotation and the limit violation wait behind the count;
  106 |       // the pinned view is not counted (it read "4 warnings" before).
  107 |       await expect(page.locator(".hudNotesSummary"), "the count holds only what waits behind it").toContainText("· 3 warnings");
  108 |     }
  109 |   });
  110 | }
  111 | 
  112 | // Only the finding's SECTION shows, never the whole hidden layer (Codex R31
  113 | // VP-I03). Seen from the top: a remote 90 mm rapid along X at Y 80, a 71 mm
  114 | // rapid along X at Y 20 (line 13), then the finding — a 7 mm rapid along Y
  115 | // (line 14). The shown rapid must be the finding's own move: short AND along
  116 | // Y; the whole layer shows the 90 mm one, an off-by-one the 71 mm one.
  117 | const SECTION = Buffer.from(encode({ file: "/section.ngc", preview_schema: 10, feed: FEED,
  118 |   feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  119 |   feed_outside: new Uint8Array(FEED.map((_, i) => (i === 4 ? 1 : 0))),   // line 7: (9,20)→(12,0)
  120 |   rapid: [[0, 80, 0], [90, 80, 0], [98, 20, 0], [98, 27, 0]], rapid_lines: [1, 2, 13, 14], rapid_seq: [1, 2, 13, 14],
  121 |   rapid_outside: new Uint8Array([0, 0, 0, 1]),
  122 |   violations: [{ line: 7, axis: "Y", value: 0, limit: 1, kind: "min" }, { line: 14, axis: "Y", value: 27, limit: 25, kind: "max" }],
  123 |   violations_total: 2 }));
  124 | 
  125 | test("a finding shows its own move of a hidden layer — not the layer", async ({ page, context }) => {
  126 |   test.setTimeout(90_000);
  127 |   await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: SECTION }));
  128 |   await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
  129 |     body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(section)" : `G1 X${i} F100`).join("\n") }));
  130 |   await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  131 |   await ctl({ op: "status_delta", data: { active_file: "/section.ngc", is_enabled: false, enabled: false } });
  132 |   await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 973, file: "/section.ngc" } });
  133 |   await simShow(page, "limit");
  134 |   const next = simStepBtn(page, "Next limit violation");
  135 |   await expect(page.locator(".simPanel [data-sim-row]").first()).toBeVisible({ timeout: 15_000 });
  136 |   await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  137 |   const role = (r: string) => page.evaluate(x => window.__viewerDiag!.projectRole!(x), r);
  138 |   await expect.poll(async () => (await role("rapid"))?.length ?? 0).toBeGreaterThan(0);
  139 |   const all = (await role("rapid"))!;
> 140 |   expect(Math.abs(all.dx), "with every rapid shown the longest runs along X").toBeGreaterThan(0.95);
      |                                                                               ^ Error: with every rapid shown the longest runs along X
  141 | 
  142 |   // Rapids off, jump to the finding on line 14 (the second finding in order).
  143 |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false } } } } });
  144 |   await expect.poll(() => role("rapid")).toBeNull();
  145 |   await next.click();
  146 |   await expect(page.locator(".simBanner")).toBeVisible();
  147 |   await next.click();
  148 |   await expect(page.locator("[data-path-reveal]")).toHaveText("Rapids shown for this finding — hidden in Layers");
  149 |   const shown = (await role("rapid"))!;
  150 |   expect(shown, "the finding's move is shown").not.toBeNull();
  151 |   expect(Math.abs(shown.dy), "the finding's own move, along Y — not the 90 mm or the 71 mm rapid").toBeGreaterThan(0.95);
  152 |   expect(shown.length, "one short move, not the layer").toBeLessThan(all.length / 5);
  153 | 
  154 |   // The whole toolpath off, a finding on a feed (line 7): its move and its
  155 |   // limit mark — nothing of the rest of the path.
  156 |   await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
  157 |     el.value = "0";
  158 |     el.dispatchEvent(new Event("input", { bubbles: true }));
  159 |   });
  160 |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: true, toolpath: false } } } } });
  161 |   await expect.poll(() => role("feed")).toBeNull();
  162 |   expect(await role("limit"), "the whole toolpath off hides its marks too").toBeNull();
  163 |   await next.click();
  164 |   await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
  165 |   // The jump lands IN the violating line's move — a point carries the line of
  166 |   // the move ending there, and the target used to be that end (read "L8").
  167 |   await expect(simLine(page)).toHaveText(/^L7\b/);
  168 |   const feed = (await role("feed"))!;
  169 |   expect(feed, "the finding's feed move is shown").not.toBeNull();
  170 |   expect(feed.length, "one move of the zigzag, not the long diagonal into it").toBeLessThan(all.length / 3);
  171 |   expect(await role("rapid"), "no rapid belongs to the feed finding's move").toBeNull();
  172 |   const mark = (await role("limit"))!;
  173 |   expect(mark, "its limit mark is shown with it").not.toBeNull();
  174 |   expect(Math.hypot(mark.x - feed.x, mark.y - feed.y), "the mark lies on the shown move").toBeLessThan(2);
  175 | });
  176 | 
```