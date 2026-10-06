# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sim-panel.viewer.spec.ts >> the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row
- Location: e2e/sim-panel.viewer.spec.ts:99:1

# Error details

```
Error: control: an arrow on the unfocused page jogs

control: an arrow on the unfocused page jogs

expect(received).toContain(expected) // indexOf

Expected value: "jog_cont"
Received array: []

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: LinuxCNC WebUI (local)
    - generic [ref=e6]:
      - generic [ref=e7]: 07:21:16
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
  - generic [ref=e51] [cursor=pointer]: IDLE
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
            - generic [ref=e73]:
              - checkbox "Sim" [disabled] [ref=e74]
              - text: Sim
            - 'button "Help: Sim" [ref=e75] [cursor=pointer]': "?"
          - button "Play the program through the machine model" [disabled] [ref=e76]:
            - img [ref=e77]
          - generic [ref=e79]:
            - slider "Scrub the program — poses the machine model, nothing moves" [disabled] [ref=e80]: "0"
            - generic:
              - generic:
                - img
            - generic:
              - generic:
                - img
            - generic:
              - generic:
                - img
            - generic:
              - generic:
                - img
            - generic:
              - generic:
                - img
          - generic [ref=e81]: 00:00/01:56
    - generic [ref=e83]:
      - tablist "Side panel" [ref=e85]:
        - tab "Program" [ref=e86] [cursor=pointer]
        - tab "MDI" [ref=e87] [cursor=pointer]
        - tab "Probing" [ref=e88] [cursor=pointer]
        - tab "Offsets" [ref=e89] [cursor=pointer]
        - tab "Tools" [ref=e90] [cursor=pointer]
        - tab "Macros" [ref=e91] [cursor=pointer]
        - tab "Sim" [selected] [ref=e92] [cursor=pointer]
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
            - generic [ref=e99]: 00:00/01:56
          - generic [ref=e100]:
            - generic [ref=e101]: Collision check
            - progressbar "Collision check progress" [ref=e102]
            - generic [ref=e104]: 100 %
            - 'button "Help: Collision check" [ref=e105] [cursor=pointer]': "?"
          - generic [ref=e106]: 2 collisions
          - generic [ref=e107]:
            - combobox "Show on the list" [ref=e108]:
              - option "All (5)" [selected]
              - option "Collisions (2)"
              - option "Limit violations (2)"
              - option "Tool changes (1)"
            - button "Why is this unavailable? Machine on — power off to simulate" [ref=e109]:
              - button "Previous on the timeline" [disabled]:
                - img
            - button "Why is this unavailable? Machine on — power off to simulate" [ref=e110]:
              - button "Next on the timeline" [disabled]:
                - img
            - 'button "Help: Timeline list" [ref=e111] [cursor=pointer]': "?"
          - table [ref=e113]:
            - rowgroup [ref=e114]:
              - row "Kind Line What Move Time" [ref=e115]:
                - columnheader "Kind" [ref=e116]
                - columnheader "Line" [ref=e117]
                - columnheader "What" [ref=e118]
                - columnheader "Move" [ref=e119]
                - columnheader "Time" [ref=e120]
            - rowgroup [ref=e121]:
              - 'row "Show L10: Tool change → T3 Tool change → T3 00:24" [ref=e122] [cursor=pointer]':
                - cell [ref=e123]:
                  - img [ref=e124]
                - 'cell "Show L10: Tool change → T3" [ref=e126]':
                  - 'button "Show L10: Tool change → T3" [ref=e127]': L10
                - cell "Tool change → T3" [ref=e128]
                - cell [ref=e129]
                - cell "00:24" [ref=e130]
              - 'row "Show L12: Tool ↔ Table Tool ↔ Table Feed 00:36" [ref=e131] [cursor=pointer]':
                - cell [ref=e132]:
                  - img [ref=e133]
                - 'cell "Show L12: Tool ↔ Table" [ref=e136]':
                  - 'button "Show L12: Tool ↔ Table" [ref=e137]': L12
                - cell "Tool ↔ Table" [ref=e138]
                - cell "Feed" [ref=e139]
                - cell "00:36" [ref=e140]
              - 'row "Show L20: X 110 mm > max 100 mm X 110 mm > max 100 mm 01:04" [ref=e141] [cursor=pointer]':
                - cell [ref=e142]:
                  - img [ref=e143]
                - 'cell "Show L20: X 110 mm > max 100 mm" [ref=e145]':
                  - 'button "Show L20: X 110 mm > max 100 mm" [ref=e146]': L20
                - cell "X 110 mm > max 100 mm" [ref=e147]
                - cell [ref=e148]
                - cell "01:04" [ref=e149]
              - 'row "Show L26: Tool ↔ Table Tool ↔ Table Rapid 01:32" [ref=e150] [cursor=pointer]':
                - cell [ref=e151]:
                  - img [ref=e152]
                - 'cell "Show L26: Tool ↔ Table" [ref=e155]':
                  - 'button "Show L26: Tool ↔ Table" [ref=e156]': L26
                - cell "Tool ↔ Table" [ref=e157]
                - cell "Rapid" [ref=e158]
                - cell "01:32" [ref=e159]
              - 'row "Show L32: X 120 mm > max 100 mm X 120 mm > max 100 mm 01:52" [ref=e160] [cursor=pointer]':
                - cell [ref=e161]:
                  - img [ref=e162]
                - 'cell "Show L32: X 120 mm > max 100 mm" [ref=e164]':
                  - 'button "Show L32: X 120 mm > max 100 mm" [ref=e165]': L32
                - cell "X 120 mm > max 100 mm" [ref=e166]
                - cell [ref=e167]
                - cell "01:52" [ref=e168]
  - group "Safety Disarm E-Stop E-Stop CLEAR Power ON Axes HOMED Overrides NONE Mode MANUAL Interp IDLE Motion JOINT Elapsed 00:00 Active codes — open in the G-code reference" [ref=e169]:
    - generic [ref=e171]:
      - generic [ref=e172]: Safety
      - generic [ref=e173]:
        - button "Disarm" [ref=e175] [cursor=pointer]:
          - img [ref=e176]
          - generic [ref=e180]: Disarm
        - button "E-Stop" [ref=e182] [cursor=pointer]:
          - img [ref=e183]
          - generic [ref=e186]: E-Stop
        - group [ref=e187]:
          - button "Power off" [ref=e188] [cursor=pointer]:
            - img [ref=e189]
            - generic [ref=e192]: Power off
      - generic [ref=e193]:
        - generic [ref=e194]:
          - generic [ref=e195]:
            - generic [ref=e196]:
              - generic [ref=e197]: E-Stop
              - generic [ref=e200]: CLEAR
            - generic [ref=e201]:
              - generic [ref=e202]: Power
              - generic [ref=e205]: "ON"
            - generic [ref=e206]:
              - generic [ref=e207]: Axes
              - generic [ref=e210]: HOMED
            - generic [ref=e211]:
              - generic [ref=e212]: Overrides
              - generic [ref=e215]: NONE
          - generic [ref=e216]:
            - generic [ref=e217]:
              - generic [ref=e218]: Mode
              - generic [ref=e221]: MANUAL
            - generic [ref=e222]:
              - generic [ref=e223]: Interp
              - generic [ref=e226]: IDLE
            - generic [ref=e227]:
              - generic [ref=e228]: Motion
              - generic [ref=e231]: JOINT
            - generic [ref=e232]:
              - generic [ref=e233]: Elapsed
              - generic [ref=e234]: 00:00
        - button "Active codes — open in the G-code reference" [ref=e236] [cursor=pointer]:
          - img [ref=e240]
    - generic [ref=e243]:
      - generic [ref=e244]: Jog
      - generic [ref=e245]:
        - generic [ref=e246]:
          - generic [ref=e248]:
            - button [ref=e249] [cursor=pointer]:
              - generic:
                - img
            - button "Y+" [ref=e250] [cursor=pointer]:
              - generic:
                - img
                - generic: Y+
            - button [ref=e251] [cursor=pointer]:
              - generic:
                - img
            - button "X-" [ref=e252] [cursor=pointer]:
              - generic:
                - img
                - generic: X-
            - button "Stop" [ref=e253] [cursor=pointer]:
              - generic:
                - img
                - generic: Stop
            - button "X+" [ref=e254] [cursor=pointer]:
              - generic:
                - img
                - generic: X+
            - button [ref=e255] [cursor=pointer]:
              - generic:
                - img
            - button "Y-" [ref=e256] [cursor=pointer]:
              - generic:
                - img
                - generic: Y-
            - button [ref=e257] [cursor=pointer]:
              - generic:
                - img
          - generic [ref=e258]:
            - button "Z+" [ref=e259] [cursor=pointer]:
              - generic:
                - img
                - generic: Z+
            - button "Z-" [ref=e260] [cursor=pointer]:
              - generic:
                - img
                - generic: Z-
          - generic [ref=e261]:
            - generic [ref=e262]:
              - button "A+" [ref=e263] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A+
              - button "A-" [ref=e264] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A-
            - generic [ref=e265]:
              - button "C+" [ref=e266] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C+
              - button "C-" [ref=e267] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C-
        - generic [ref=e268]:
          - generic [ref=e269]:
            - generic [ref=e270]: Linear
            - generic [ref=e271]:
              - generic [ref=e272]: "600"
              - generic [ref=e273]: mm/min
            - slider "Linear jog speed" [ref=e274] [cursor=pointer]: "10"
            - button "Reset linear jog speed to 600 mm/min" [ref=e275] [cursor=pointer]: "600"
          - generic [ref=e276]:
            - generic [ref=e277]: Rotary
            - generic [ref=e278]:
              - generic [ref=e279]: "600"
              - generic [ref=e280]: °/min
            - slider "Rotary jog speed" [ref=e281] [cursor=pointer]: "10"
            - button "Reset rotary jog speed to 600 °/min" [ref=e282] [cursor=pointer]: "600"
        - generic [ref=e283]:
          - generic [ref=e284]:
            - generic [ref=e285]: Step (mm / °)
            - radiogroup "Jog step" [ref=e287]:
              - radio "Cont" [checked] [ref=e288] [cursor=pointer]
              - radio ".001" [ref=e289] [cursor=pointer]
              - radio ".01" [ref=e290] [cursor=pointer]
              - radio ".1" [ref=e291] [cursor=pointer]
              - radio "1" [ref=e292] [cursor=pointer]
          - generic [ref=e293]:
            - generic [ref=e294]: Mode
            - toolbar "Task mode" [ref=e295]:
              - radiogroup "Task mode" [ref=e296]:
                - radio "Manual" [checked] [ref=e297] [cursor=pointer]
                - radio "MDI" [ref=e298] [cursor=pointer]
                - radio "Auto" [ref=e299] [cursor=pointer]
          - generic [ref=e300]:
            - generic [ref=e301]:
              - text: Kinematics Frame
              - 'button "Help: Kinematics Frame" [ref=e302] [cursor=pointer]': "?"
            - toolbar "Kinematics frame" [ref=e303]:
              - radiogroup "Kinematics frame" [ref=e304]:
                - radio "Machine" [checked] [ref=e305] [cursor=pointer]
                - radio "TCP" [ref=e306] [cursor=pointer]
    - generic [ref=e307]:
      - generic [ref=e308]:
        - text: Setup
        - 'button "Help: Go to positions" [ref=e309] [cursor=pointer]': "?"
      - generic [ref=e310]:
        - generic [ref=e311]:
          - generic [ref=e312]:
            - generic [ref=e313]:
              - textbox "Touch off X · Machine · G54" [ref=e314] [cursor=pointer]: "1.111"
              - button "Zero X" [ref=e315] [cursor=pointer]:
                - img [ref=e316]
                - text: X
              - button "Unhome X" [ref=e320] [cursor=pointer]:
                - img [ref=e321]
                - text: X
              - textbox "Touch off Y · Machine · G54" [ref=e325] [cursor=pointer]: "2.222"
              - button "Zero Y" [ref=e326] [cursor=pointer]:
                - img [ref=e327]
                - text: "Y"
              - button "Unhome Y" [ref=e331] [cursor=pointer]:
                - img [ref=e332]
                - text: "Y"
              - textbox "Touch off Z · Machine · G54" [ref=e336] [cursor=pointer]: "3.333"
              - button "Zero Z" [ref=e337] [cursor=pointer]:
                - img [ref=e338]
                - text: Z
              - button "Unhome Z" [ref=e342] [cursor=pointer]:
                - img [ref=e343]
                - text: Z
            - generic [ref=e347]:
              - textbox "Touch off A · Machine · G54" [ref=e348] [cursor=pointer]: "4.44"
              - button "Zero A" [ref=e349] [cursor=pointer]:
                - img [ref=e350]
                - text: A
              - button "Unhome A" [ref=e354] [cursor=pointer]:
                - img [ref=e355]
                - text: A
              - textbox "Touch off C · Machine · G54" [ref=e359] [cursor=pointer]: "5.55"
              - button "Zero C" [ref=e360] [cursor=pointer]:
                - img [ref=e361]
                - text: C
              - button "Unhome C" [ref=e365] [cursor=pointer]:
                - img [ref=e366]
                - text: C
          - generic [ref=e370]:
            - button "Zero XYZ" [ref=e371] [cursor=pointer]:
              - img [ref=e372]
              - text: Zero XYZ
            - button "Unhome All" [ref=e376] [cursor=pointer]:
              - img [ref=e377]
              - generic [ref=e382]: Unhome All
          - generic [ref=e383]:
            - button "Go to G30" [ref=e384] [cursor=pointer]
            - button "Go to MCS 0" [ref=e385] [cursor=pointer]
            - button "Go to WCS 0" [ref=e386] [cursor=pointer]
        - generic [ref=e387]:
          - generic [ref=e388]:
            - generic [ref=e389]: WCS
            - generic "Machine kinematics — jogs move the machine axes" [ref=e390]: MACHINE
          - toolbar "Work offset" [ref=e391]:
            - radiogroup "Work offset" [ref=e392]:
              - radio "G54" [checked] [ref=e393] [cursor=pointer]
              - radio "G55" [ref=e394] [cursor=pointer]
              - radio "G56" [ref=e395] [cursor=pointer]
              - radio "G57" [ref=e396] [cursor=pointer]
              - radio "G58" [ref=e397] [cursor=pointer]
              - radio "G59" [ref=e398] [cursor=pointer]
              - radio "G59.1" [ref=e399] [cursor=pointer]
              - radio "G59.2" [ref=e400] [cursor=pointer]
              - radio "G59.3" [ref=e401] [cursor=pointer]
    - group [ref=e402]:
      - generic [ref=e403]: Overrides
      - generic [ref=e404]:
        - generic [ref=e405]:
          - generic [ref=e406]: Feed
          - generic [ref=e407]: 100 %
          - slider "Feed override" [disabled] [ref=e408]: "100"
          - button "Reset feed override to 100 %" [ref=e409] [cursor=pointer]: 100 %
        - generic [ref=e410]:
          - generic [ref=e411]: Spindle
          - generic [ref=e412]: 100 %
          - slider "Spindle override" [disabled] [ref=e413]: "100"
          - button "Reset spindle override to 100 %" [ref=e414] [cursor=pointer]: 100 %
        - generic [ref=e415]:
          - generic [ref=e416]: Rapid
          - generic [ref=e417]: 100 %
          - slider "Rapid override" [disabled] [ref=e418]: "100"
          - button "Reset rapid override to 100 %" [ref=e419] [cursor=pointer]: 100 %
    - generic [ref=e420]:
      - generic [ref=e421]: Spindle
      - group [ref=e422]:
        - generic [ref=e423]:
          - button "Rev" [ref=e424] [cursor=pointer]:
            - generic [ref=e425]:
              - img [ref=e426]
              - text: Rev
          - button "Why is this unavailable? Spindle is already stopped" [ref=e429]:
            - button "Stop" [disabled]:
              - generic:
                - img
                - text: Stop
          - button "Fwd" [ref=e430] [cursor=pointer]:
            - generic [ref=e431]:
              - img [ref=e432]
              - text: Fwd
        - generic [ref=e435]:
          - button [ref=e436] [cursor=pointer]:
            - img [ref=e437]
          - textbox "Spindle speed" [ref=e438] [cursor=pointer]: "1000"
          - button [ref=e439] [cursor=pointer]:
            - img [ref=e440]
      - generic [ref=e442]:
        - generic [ref=e443]: Coolant
        - generic [ref=e444]:
          - generic [ref=e446] [cursor=pointer]:
            - checkbox "Flood" [ref=e447]
            - text: Flood
          - generic [ref=e449] [cursor=pointer]:
            - checkbox "Mist" [ref=e450]
            - text: Mist
    - generic [ref=e452]:
      - generic [ref=e453]: Tool
      - button "Tool Table" [ref=e454] [cursor=pointer]
      - generic [ref=e455]: No tool loaded
```

# Test source

```ts
  9   | import { encode } from "@msgpack/msgpack";
  10  | import { ctl } from "./ctl";
  11  | import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
  12  | import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";
  13  | 
  14  | const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
  15  | FEED[17]![0] = 110;   // line 20 out of the X window
  16  | FEED[29]![0] = 120;   // line 32 out of the X window
  17  | const PREVIEW = Buffer.from(encode({ file: "/sim.ngc", preview_schema: 10, feed: FEED,
  18  |   feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  19  |   feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  20  |   feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  21  |   violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  22  |   violations_total: 2 }));
  23  | const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : `G1 X${i} F100`).join("\n");
  24  | 
  25  | async function prepare(page: Page, context: BrowserContext, vp = "desktop") {
  26  |   await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  27  |   await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  28  |   await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  29  |   await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  30  |   await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  31  |   await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  32  |   // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  33  |   await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  34  |   await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
  35  |     [{ line: 12, frac: 9 / 29 }, { line: 26, frac: 23 / 29, rapid: true }]) ?? false)).toBe(true);
  36  |   await openSimTab(page);
  37  | }
  38  | const rows = (page: Page) => page.locator(".simPanel tbody tr");
  39  | const rowKeys = (page: Page) => rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  40  | 
  41  | test("the list is the timeline's marks: one row each, in timeline order, each kind in its words", async ({ page, context }) => {
  42  |   await prepare(page, context);
  43  |   const marks = await page.locator(".scrubBar .scrubTick").evaluateAll(ts => ts.map(t => ({
  44  |     kind: ["clash", "limit", "tool"].find(k => t.classList.contains(k)), left: t.getBoundingClientRect().left })));
  45  |   const byKind = (k: string) => marks.filter(m => m.kind === k).length;
  46  |   const kinds = await rows(page).evaluateAll(trs => trs.map(t => ["clash", "limit", "tool"].find(k => t.querySelector(`.colKind.${k}`))));
  47  |   expect(kinds.filter(k => k === "clash").length, "a row per collision mark").toBe(byKind("clash"));
  48  |   expect(kinds.filter(k => k === "limit").length, "a row per limit mark").toBe(byKind("limit"));
  49  |   expect(kinds.filter(k => k === "tool").length, "a row per tool-change mark").toBe(byKind("tool"));
  50  |   expect(kinds, "timeline order").toEqual([...marks].sort((a, b) => a.left - b.left).map(m => m.kind));
  51  |   await expect(page.locator('.simPanel [data-sim-row="L20"] .colWhat')).toContainText("X 110 mm > max 100 mm");
  52  |   await expect(page.locator('.simPanel [data-sim-row="T10"] .colWhat')).toContainText("Tool change → T3");
  53  |   await expect(page.locator(".simPanel tr").filter({ hasText: "L26" }).locator(".colMove")).toHaveText("Rapid");
  54  |   // the filter counts and narrows
  55  |   await expect(page.locator('.simPanel select[name="simFilter"] option[value="clash"]')).toHaveText("Collisions (2)");
  56  |   await simShow(page, "limit");
  57  |   expect(await rowKeys(page)).toEqual(["L20", "L32"]);
  58  |   // the collision check: its progress and its verdict, the tools in its "?"
  59  |   await expect(page.locator(".simPanel .checkPct")).toHaveText("100 %");
  60  |   await expect(page.locator(".simPanel .checkVerdict")).toHaveText("2 collisions");
  61  | });
  62  | 
  63  | test("a row shows its finding; the steps go through the shown kind; the next row follows the position", async ({ page, context }) => {
  64  |   await prepare(page, context);
  65  |   await simShow(page, "all");
  66  |   const first = page.locator('.simPanel tr[data-sim-row^="C"]').first();
  67  |   const key = await first.getAttribute("data-sim-row");
  68  |   await first.click();
  69  |   await expect(page.locator(".simBanner"), "a row enters the simulation").toBeVisible();
  70  |   await expect(page.locator(`.simPanel [data-sim-row="${key}"]`)).toHaveClass(/shownRow/);
  71  |   await expect(page.locator(`.simPanel [data-sim-row="${key}"] .rowPick`)).toHaveAttribute("aria-current", "true");
  72  |   await expect(simLine(page)).toHaveText(/^L12\b/);
  73  |   // the steps of one kind: the old "Next limit violation" from here
  74  |   await simShow(page, "limit");
  75  |   await simStepBtn(page, "Next limit violation").click();
  76  |   await expect(simLine(page)).toHaveText(/^L20\b/);
  77  |   await simStepBtn(page, "Next limit violation").click();
  78  |   await expect(simLine(page)).toHaveText(/^L32\b/);
  79  |   await simStepBtn(page, "Previous limit violation").click();
  80  |   await expect(simLine(page)).toHaveText(/^L20\b/);
  81  |   // a manual position: no finding shown, the next row ahead of it marked
  82  |   await simShow(page, "all");
  83  |   await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
  84  |     el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  85  |   await expect(page.locator(".simPanel .shownRow")).toHaveCount(0);
  86  |   const next = await page.locator(".simPanel .nextRow").getAttribute("data-sim-row");
  87  |   const all = await page.locator(".simPanel tbody tr").evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  88  |   expect(all.indexOf(next), "the next row is the first past the position").toBeGreaterThan(0);
  89  | });
  90  | 
  91  | // Keyboard jog ON with the navigation keys bound to jog (tabs.spec's map): a
  92  | // key a row failed to keep would move the machine.
  93  | const KEYBOARD = { keyboard: { jogEnabled: true, buttonsEnabled: true, mapping: {
  94  |   "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown",
  95  |   "jog_z+": "Home", "jog_z-": "End", estop: "Escape", cycle: " ", abort: "Backspace",
  96  | } } };
  97  | const jogs = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string }[]).map(c => c.cmd).filter(c => /jog/.test(c));
  98  | 
  99  | test("the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row", async ({ page, context }) => {
  100 |   await prepare(page, context);
  101 |   await simShow(page, "all");
  102 |   // The machine on (homed by the layout fixture) and the keyboard jog live.
  103 |   await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true } });
  104 |   await ctl({ op: "raw", frame: { type: "settings_init", settings: KEYBOARD } });
  105 |   // Control: an arrow on the unfocused page jogs.
  106 |   await ctl({ op: "clearCmds" });
  107 |   await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  108 |   await page.keyboard.down("ArrowRight");
> 109 |   await expect.poll(jogs, "control: an arrow on the unfocused page jogs").toContain("jog_cont");
      |                                                                           ^ Error: control: an arrow on the unfocused page jogs
  110 |   await page.keyboard.up("ArrowRight");
  111 |   await expect.poll(jogs).toContain("jog_stop");
  112 |   await ctl({ op: "clearCmds" });
  113 |   const picks = page.locator(".simPanel .rowPick");
  114 |   await picks.first().focus();
  115 |   for (const key of ["ArrowDown", "ArrowDown", "Control+ArrowDown", "ArrowUp", "End", "Home", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
  116 |   await expect(picks.first(), "Home brought the focus back to the first row").toBeFocused();
  117 |   await page.waitForTimeout(300);
  118 |   expect(await jogs(), "no key on a row reached the jog map").toEqual([]);
  119 |   // the machine on: Enter on a row says why at the row, nothing else happens
  120 |   await page.keyboard.press("Enter");
  121 |   await expect(page.locator(".btnHint")).toHaveText("Machine on — power off to simulate");
  122 |   await expect(page.locator(".simBanner")).toHaveCount(0);
  123 |   // the machine off: Enter shows the row
  124 |   await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
  125 |   await page.keyboard.press("ArrowDown");
  126 |   await page.keyboard.press("Enter");
  127 |   await expect(page.locator(".simBanner")).toBeVisible();
  128 |   await expect(page.locator(".simPanel .shownRow .rowPick")).toBeFocused();
  129 | });
  130 | 
  131 | test("stepping through the findings never changes the bar: the same box, the same timeline", async ({ page, context }) => {
  132 |   for (const [vp, zoom] of [["desktop", 1], ["touch-landscape", 1], ["touch-portrait", 1.5]] as const) {
  133 |     await prepare(page, context, vp);
  134 |     if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
  135 |     await settleLayout(page);
  136 |     await simShow(page, "all");
  137 |     // Layout px (CSS zoom aside): the bar, the timeline, the bar's content box.
  138 |     const bar = () => page.locator(".scrubBar").evaluate(el => {
  139 |       const b = el as HTMLElement, cs = getComputedStyle(b);
  140 |       return { w: b.offsetWidth, h: b.offsetHeight, slider: (b.querySelector(".sliderWrap") as HTMLElement).offsetWidth,
  141 |         content: b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), narrow: !!b.closest(".narrowViewer") };
  142 |     });
  143 |     const step = simStepBtn(page, "Next on the timeline");
  144 |     await step.click();
  145 |     await expect(page.locator(".simBanner")).toBeVisible();
  146 |     await settleLayout(page);
  147 |     const at = await bar();
  148 |     expect(at.narrow, `${vp}: a narrow viewer only at 150 % portrait`).toBe(vp === "touch-portrait");
  149 |     expect(at.slider, `${vp}: the timeline keeps its room`).toBeGreaterThanOrEqual(120);
  150 |     if (at.narrow) expect(at.slider, `${vp}: a narrow viewer gives the timeline a row of its own`).toBeGreaterThanOrEqual(at.content - 1);
  151 |     for (let i = 0; i < 6; i++) {
  152 |       await step.click();
  153 |       expect(await bar(), `${vp}: step ${i + 2} — the bar as it was`).toEqual(at);
  154 |     }
  155 |     await ctl({ op: "reset" });
  156 |   }
  157 | });
  158 | 
```