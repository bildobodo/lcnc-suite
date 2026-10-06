# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sim-panel.viewer.spec.ts >> the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row
- Location: e2e/sim-panel.viewer.spec.ts:121:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.simBanner')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.simBanner')

```

```yaml
- banner:
  - text: "LinuxCNC WebUI (local) 08:32:49 WS connected LCNC: - ARMED"
  - button "Connection details"
  - button "Messages (0)"
  - button "G-code Reference"
  - button "Settings"
  - button "Fullscreen"
  - button "Shut Down"
- text: MACHINE OFF
- group:
  - text: Work · G54 Machine X 1.111 — Y 2.222 — Z 3.333 — A 4.44° — C 5.55° — F — S — T— · Ø— · L—
  - button "Reset view": Reset
  - button "Clear backplot": Clear
  - button "Show camera"
  - button "3D Viewer settings"
  - text: MACHINE · G54 2 limit violations
  - checkbox "Sim"
  - text: Sim
  - 'button "Help: Sim"': "?"
  - button "Play the program through the machine model"
  - slider "Scrub the program — poses the machine model, nothing moves" [disabled]: "0"
  - text: 00:00/01:56
  - tablist "Side panel":
    - tab "Program"
    - tab "MDI"
    - tab "Probing"
    - tab "Offsets"
    - tab "Tools"
    - tab "Macros"
    - tab "Sim" [selected]
  - tabpanel "Sim":
    - text: Speed
    - combobox "Playback speed":
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
    - text: 00:00/01:56 Collision check
    - progressbar "Collision check progress"
    - text: 100 %
    - 'button "Help: Collision check"': "?"
    - text: 2 collisions
    - combobox "Show on the list":
      - option "All (6)" [selected]
      - option "Collisions (2)"
      - option "Limit violations (2)"
      - option "Tool changes (2)"
    - button "Previous on the timeline"
    - button "Next on the timeline"
    - 'button "Help: Timeline list"': "?"
    - table:
      - rowgroup:
        - row "Kind Line What Move Time":
          - columnheader "Kind"
          - columnheader "Line"
          - columnheader "What"
          - columnheader "Move"
          - columnheader "Time"
      - rowgroup:
        - 'row "Show L10: Tool change → T3 Tool change → T3 00:24"':
          - cell
          - 'cell "Show L10: Tool change → T3"':
            - 'button "Show L10: Tool change → T3"': L10
          - cell "Tool change → T3"
          - cell
          - cell "00:24"
        - 'row "Show L12: Tool ↔ Table Tool ↔ Table Feed 00:36"':
          - cell
          - 'cell "Show L12: Tool ↔ Table"':
            - 'button "Show L12: Tool ↔ Table"': L12
          - cell "Tool ↔ Table"
          - cell "Feed"
          - cell "00:36"
        - 'row "Show L20: Tool change → T5 Tool change → T5 01:04"':
          - cell
          - 'cell "Show L20: Tool change → T5"':
            - 'button "Show L20: Tool change → T5"': L20
          - cell "Tool change → T5"
          - cell
          - cell "01:04"
        - 'row "Show L20: X 110 mm > max 100 mm X 110 mm > max 100 mm 01:04"':
          - cell
          - 'cell "Show L20: X 110 mm > max 100 mm"':
            - 'button "Show L20: X 110 mm > max 100 mm"': L20
          - cell "X 110 mm > max 100 mm"
          - cell
          - cell "01:04"
        - 'row "Show L26: Tool ↔ Table Tool ↔ Table Rapid 01:32"':
          - cell
          - 'cell "Show L26: Tool ↔ Table"':
            - 'button "Show L26: Tool ↔ Table"': L26
          - cell "Tool ↔ Table"
          - cell "Rapid"
          - cell "01:32"
        - 'row "Show L32: X 120 mm > max 100 mm X 120 mm > max 100 mm 01:52"':
          - cell
          - 'cell "Show L32: X 120 mm > max 100 mm"':
            - 'button "Show L32: X 120 mm > max 100 mm"': L32
          - cell "X 120 mm > max 100 mm"
          - cell
          - cell "01:52"
- group "Safety Disarm E-Stop E-Stop CLEAR Power OFF Axes HOMED Overrides NONE Mode MANUAL Interp IDLE Motion JOINT Elapsed 00:00 Active codes — open in the G-code reference":
  - text: Safety
  - button "Disarm"
  - button "E-Stop"
  - group:
    - button "Power on"
  - text: E-Stop CLEAR Power OFF Axes HOMED Overrides NONE Mode MANUAL Interp IDLE Motion JOINT Elapsed 00:00
  - button "Active codes — open in the G-code reference"
  - text: Jog
  - button
  - button "Y+"
  - button
  - button "X-"
  - button "Stop"
  - button "X+"
  - button
  - button "Y-"
  - button
  - button "Z+"
  - button "Z-"
  - button "A+"
  - button "A-"
  - button "C+"
  - button "C-"
  - text: Linear 600 mm/min
  - slider "Linear jog speed": "10"
  - button "Reset linear jog speed to 600 mm/min": "600"
  - text: Rotary 600 °/min
  - slider "Rotary jog speed": "10"
  - button "Reset rotary jog speed to 600 °/min": "600"
  - text: Step (mm / °)
  - radiogroup "Jog step":
    - radio "Cont" [checked]
    - radio ".001"
    - radio ".01"
    - radio ".1"
    - radio "1"
  - text: Mode
  - toolbar "Task mode":
    - radiogroup "Task mode":
      - radio "Manual" [checked]
      - radio "MDI"
      - radio "Auto"
  - text: Kinematics Frame
  - 'button "Help: Kinematics Frame"': "?"
  - toolbar "Kinematics frame":
    - radiogroup "Kinematics frame":
      - radio "Machine" [checked]
      - radio "TCP"
  - text: Setup
  - 'button "Help: Go to positions"': "?"
  - textbox "Touch off X · Machine · G54": "1.111"
  - button "Zero X": X
  - button "Unhome X": X
  - textbox "Touch off Y · Machine · G54": "2.222"
  - button "Zero Y": "Y"
  - button "Unhome Y": "Y"
  - textbox "Touch off Z · Machine · G54": "3.333"
  - button "Zero Z": Z
  - button "Unhome Z": Z
  - textbox "Touch off A · Machine · G54": "4.44"
  - button "Zero A": A
  - button "Unhome A": A
  - textbox "Touch off C · Machine · G54": "5.55"
  - button "Zero C": C
  - button "Unhome C": C
  - button "Zero XYZ"
  - button "Unhome All"
  - button "Go to G30"
  - button "Go to MCS 0"
  - button "Go to WCS 0"
  - text: WCS MACHINE
  - toolbar "Work offset":
    - radiogroup "Work offset":
      - radio "G54" [checked]
      - radio "G55"
      - radio "G56"
      - radio "G57"
      - radio "G58"
      - radio "G59"
      - radio "G59.1"
      - radio "G59.2"
      - radio "G59.3"
  - group:
    - text: Overrides Feed 100 %
    - slider "Feed override" [disabled]: "100"
    - button "Reset feed override to 100 %": 100 %
    - text: Spindle 100 %
    - slider "Spindle override" [disabled]: "100"
    - button "Reset spindle override to 100 %": 100 %
    - text: Rapid 100 %
    - slider "Rapid override" [disabled]: "100"
    - button "Reset rapid override to 100 %": 100 %
  - text: Spindle
  - group:
    - button "Rev"
    - button "Why is this unavailable? Spindle is already stopped":
      - button "Stop" [disabled]
    - button "Fwd"
    - button
    - textbox "Spindle speed": "1000"
    - button
  - text: Coolant
  - checkbox "Flood"
  - text: Flood
  - checkbox "Mist"
  - text: Mist Tool
  - button "Tool Table"
  - text: No tool loaded
```

# Test source

```ts
  39  | const rows = (page: Page) => page.locator(".simPanel tbody tr");
  40  | const rowKeys = (page: Page) => rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  41  | 
  42  | test("the list is the timeline's marks: one row each, in timeline order, each kind in its words", async ({ page, context }) => {
  43  |   await prepare(page, context);
  44  |   const marks = await page.locator(".scrubBar .scrubTick").evaluateAll(ts => ts.map(t => ({
  45  |     kind: ["clash", "limit", "tool"].find(k => t.classList.contains(k)), left: t.getBoundingClientRect().left })));
  46  |   const byKind = (k: string) => marks.filter(m => m.kind === k).length;
  47  |   const kinds = await rows(page).evaluateAll(trs => trs.map(t => ["clash", "limit", "tool"].find(k => t.querySelector(`.colKind.${k}`))));
  48  |   expect(kinds.filter(k => k === "clash").length, "a row per collision mark").toBe(byKind("clash"));
  49  |   expect(kinds.filter(k => k === "limit").length, "a row per limit mark").toBe(byKind("limit"));
  50  |   expect(kinds.filter(k => k === "tool").length, "a row per tool-change mark").toBe(byKind("tool"));
  51  |   expect(kinds, "timeline order").toEqual([...marks].sort((a, b) => a.left - b.left).map(m => m.kind));
  52  |   await expect(page.locator('.simPanel [data-sim-row="L20"] .colWhat')).toContainText("X 110 mm > max 100 mm");
  53  |   await expect(page.locator('.simPanel [data-sim-row="T10"] .colWhat')).toContainText("Tool change → T3");
  54  |   await expect(page.locator(".simPanel tr").filter({ hasText: "L26" }).locator(".colMove")).toHaveText("Rapid");
  55  |   // the filter counts and narrows
  56  |   await expect(page.locator('.simPanel select[name="simFilter"] option[value="clash"]')).toHaveText("Collisions (2)");
  57  |   await simShow(page, "limit");
  58  |   expect(await rowKeys(page)).toEqual(["L20", "L32"]);
  59  |   // the collision check: its progress and its verdict, the tools in its "?"
  60  |   await expect(page.locator(".simPanel .checkPct")).toHaveText("100 %");
  61  |   await expect(page.locator(".simPanel .checkVerdict")).toHaveText("2 collisions");
  62  | });
  63  | 
  64  | test("a row shows its finding; the steps go through the shown kind; the next row follows the position", async ({ page, context }) => {
  65  |   await prepare(page, context);
  66  |   await simShow(page, "all");
  67  |   const first = page.locator('.simPanel tr[data-sim-row^="C"]').first();
  68  |   const key = await first.getAttribute("data-sim-row");
  69  |   await first.click();
  70  |   await expect(page.locator(".simBanner"), "a row enters the simulation").toBeVisible();
  71  |   await expect(page.locator(`.simPanel [data-sim-row="${key}"]`)).toHaveClass(/shownRow/);
  72  |   await expect(page.locator(`.simPanel [data-sim-row="${key}"] .rowPick`)).toHaveAttribute("aria-current", "true");
  73  |   await expect(simLine(page)).toHaveText(/^L12\b/);
  74  |   // the steps of one kind: the old "Next limit violation" from here
  75  |   await simShow(page, "limit");
  76  |   await simStepBtn(page, "Next limit violation").click();
  77  |   await expect(simLine(page)).toHaveText(/^L20\b/);
  78  |   await simStepBtn(page, "Next limit violation").click();
  79  |   await expect(simLine(page)).toHaveText(/^L32\b/);
  80  |   await simStepBtn(page, "Previous limit violation").click();
  81  |   await expect(simLine(page)).toHaveText(/^L20\b/);
  82  |   // a manual position: no finding shown, the next row ahead of it marked
  83  |   await simShow(page, "all");
  84  |   await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
  85  |     el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  86  |   await expect(page.locator(".simPanel .shownRow")).toHaveCount(0);
  87  |   const next = await page.locator(".simPanel .nextRow").getAttribute("data-sim-row");
  88  |   const all = await page.locator(".simPanel tbody tr").evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  89  |   expect(all.indexOf(next), "the next row is the first past the position").toBeGreaterThan(0);
  90  | });
  91  | 
  92  | // Keyboard jog ON with the navigation keys bound to jog (tabs.spec's map): a
  93  | // key a row failed to keep would move the machine.
  94  | const KEYBOARD = { keyboard: { jogEnabled: true, buttonsEnabled: true, mapping: {
  95  |   "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown",
  96  |   "jog_z+": "Home", "jog_z-": "End", estop: "Escape", cycle: " ", abort: "Backspace",
  97  | } } };
  98  | const jogs = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string }[]).map(c => c.cmd).filter(c => /jog/.test(c));
  99  | /** The machine on or off — waited for in the CLIENT (the strip's power
  100 |  *  button names the next action), not only in the mock's reply. */
  101 | async function machine(page: Page, on: boolean) {
  102 |   await ctl({ op: "status_delta", data: { is_enabled: on, enabled: on } });
  103 |   await expect(page.locator(".safetyStrip")).toContainText(on ? /power off/i : /power on/i);
  104 | }
  105 | /** The machine on (homed by the layout fixture), the keyboard jog bound to
  106 |  *  the arrows — and proven live: an arrow on the unfocused page jogs. */
  107 | async function jogLive(page: Page) {
  108 |   await machine(page, true);
  109 |   await ctl({ op: "raw", frame: { type: "settings_init", settings: KEYBOARD } });
  110 |   await ctl({ op: "clearCmds" });
  111 |   await expect.poll(async () => {
  112 |     await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  113 |     await page.keyboard.down("ArrowRight");
  114 |     await page.waitForTimeout(100);
  115 |     await page.keyboard.up("ArrowRight");
  116 |     return jogs();
  117 |   }, { message: "control: an arrow on the unfocused page jogs" }).toEqual(expect.arrayContaining(["jog_cont", "jog_stop"]));
  118 |   await ctl({ op: "clearCmds" });
  119 | }
  120 | 
  121 | test("the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row", async ({ page, context }) => {
  122 |   await prepare(page, context);
  123 |   await simShow(page, "all");
  124 |   await jogLive(page);
  125 |   const picks = page.locator(".simPanel .rowPick");
  126 |   await picks.first().focus();
  127 |   for (const key of ["ArrowDown", "ArrowDown", "Control+ArrowDown", "ArrowUp", "End", "Home", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
  128 |   await expect(picks.first(), "Home brought the focus back to the first row").toBeFocused();
  129 |   await page.waitForTimeout(300);
  130 |   expect(await jogs(), "no key on a row reached the jog map").toEqual([]);
  131 |   // the machine on: Enter on a row says why at the row, nothing else happens
  132 |   await page.keyboard.press("Enter");
  133 |   await expect(page.locator(".btnHint")).toHaveText("Machine on — power off to simulate");
  134 |   await expect(page.locator(".simBanner")).toHaveCount(0);
  135 |   // the machine off: Enter shows the row
  136 |   await machine(page, false);
  137 |   await page.keyboard.press("ArrowDown");
  138 |   await page.keyboard.press("Enter");
> 139 |   await expect(page.locator(".simBanner")).toBeVisible();
      |                                            ^ Error: expect(locator).toBeVisible() failed
  140 |   await expect(page.locator(".simPanel .shownRow .rowPick")).toBeFocused();
  141 | });
  142 | 
  143 | test("stepping through the findings never changes the bar: the same box, the same timeline", async ({ page, context }) => {
  144 |   for (const [vp, zoom] of [["desktop", 1], ["touch-landscape", 1], ["touch-portrait", 1.5]] as const) {
  145 |     await prepare(page, context, vp);
  146 |     if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
  147 |     await settleLayout(page);
  148 |     await simShow(page, "all");
  149 |     // Layout px (CSS zoom aside): the bar, the timeline, the bar's content box.
  150 |     const bar = () => page.locator(".scrubBar").evaluate(el => {
  151 |       const b = el as HTMLElement, cs = getComputedStyle(b);
  152 |       return { w: b.offsetWidth, h: b.offsetHeight, slider: (b.querySelector(".sliderWrap") as HTMLElement).offsetWidth,
  153 |         content: b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), narrow: !!b.closest(".narrowViewer") };
  154 |     });
  155 |     const step = simStepBtn(page, "Next on the timeline");
  156 |     await step.click();
  157 |     await expect(page.locator(".simBanner")).toBeVisible();
  158 |     await settleLayout(page);
  159 |     const at = await bar();
  160 |     expect(at.narrow, `${vp}: a narrow viewer only at 150 % portrait`).toBe(vp === "touch-portrait");
  161 |     expect(at.slider, `${vp}: the timeline keeps its room`).toBeGreaterThanOrEqual(120);
  162 |     if (at.narrow) expect(at.slider, `${vp}: a narrow viewer gives the timeline a row of its own`).toBeGreaterThanOrEqual(at.content - 1);
  163 |     for (let i = 0; i < 6; i++) {
  164 |       await step.click();
  165 |       expect(await bar(), `${vp}: step ${i + 2} — the bar as it was`).toEqual(at);
  166 |     }
  167 |     await ctl({ op: "reset" });
  168 |   }
  169 | });
  170 | 
  171 | // Codex R78 VP-I37: a result change removed the focused row (or re-rendered a
  172 | // focused step button) and the focus fell to BODY — the next arrow jogged.
  173 | // The panel owns its focus: the row now at its place, else the list filter.
  174 | test("a result change under the focus keeps it in the panel; no arrow jogs", async ({ page, context }) => {
  175 |   await prepare(page, context);
  176 |   await simShow(page, "all");
  177 |   await jogLive(page);
  178 |   const inPanel = () => page.evaluate(() => !!document.activeElement?.closest(".simPanel"));
  179 |   const tryJog = async () => {
  180 |     for (const k of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) await page.keyboard.press(k);
  181 |     await page.waitForTimeout(300);
  182 |     return jogs();
  183 |   };
  184 |   // a focused collision row, then a result without collisions
  185 |   await page.locator('.simPanel tr[data-sim-row^="C"] .rowPick').first().focus();
  186 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]) ?? false)).toBe(true);
  187 |   await expect(page.locator('.simPanel tr[data-sim-row^="C"]')).toHaveCount(0);
  188 |   expect(await inPanel(), "the focus stays in the panel").toBe(true);
  189 |   await expect(page.locator(".simPanel .rowPick:focus"), "on the row now at its place").toHaveCount(1);
  190 |   expect(await tryJog(), "no arrow reached the jog map").toEqual([]);
  191 |   // the list filtered to collisions, a focused row, then the list empties
  192 |   await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12, frac: 9 / 29 }]));
  193 |   await simShow(page, "clash");
  194 |   await page.locator(".simPanel .rowPick").first().focus();
  195 |   await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]));
  196 |   await expect(page.locator(".simPanel tbody tr")).toHaveCount(0);
  197 |   await expect(page.locator('.simPanel select[name="simFilter"]'), "an empty list: the filter holds the focus").toBeFocused();
  198 |   expect(await tryJog(), "no arrow reached the jog map").toEqual([]);
  199 | });
  200 | 
  201 | // Codex R78 VP-I38: the steps sorted by position alone — where a tool change,
  202 | // a limit and a collision share one moment, "Next on the timeline" went down
  203 | // the list and back up. One order for both, ties and the wrap included.
  204 | test("the steps through mixed kinds follow the list's own order, ties included", async ({ page, context }) => {
  205 |   await prepare(page, context);
  206 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
  207 |     [{ line: 12, frac: 9 / 29 }, { line: 20, frac: 64 / 116 }, { line: 26, frac: 23 / 29, rapid: true }]) ?? false)).toBe(true);
  208 |   await simShow(page, "all");
  209 |   const list = await rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")!.split("|")[0]));
  210 |   expect(list, "the list: the tool, the limit and the collision of L20 at one moment").toEqual(["T10", "C12", "T20", "L20", "C20", "C26", "L32"]);
  211 |   const shownKey = () => page.locator(".simPanel .shownRow").getAttribute("data-sim-row").then(k => k?.split("|")[0]);
  212 |   await page.locator('.simPanel tr[data-sim-row^="C12"]').click();
  213 |   await expect.poll(shownKey).toBe("C12");
  214 |   const next = simStepBtn(page, "Next on the timeline"), prev = simStepBtn(page, "Previous on the timeline");
  215 |   for (const want of ["T20", "L20", "C20", "C26", "L32", "T10", "C12"]) {
  216 |     await next.click();
  217 |     await expect.poll(shownKey, `next → ${want}`).toBe(want);
  218 |   }
  219 |   for (const want of ["T10", "L32", "C26", "C20", "L20", "T20", "C12"]) {
  220 |     await prev.click();
  221 |     await expect.poll(shownKey, `previous → ${want}`).toBe(want);
  222 |   }
  223 | });
  224 | 
  225 | // Codex R78 VP-I39: a jump to a tool change kept the previous finding's
  226 | // reveal — its move and the line "Toolpath shown for this finding" stayed at
  227 | // the tool change. A tool change ends it; the stored layer stays off.
  228 | test("a tool change shown after a finding ends the finding's reveal, the stored layer untouched", async ({ page, context }) => {
  229 |   await prepare(page, context);
  230 |   await simShow(page, "all");
  231 |   await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false } } } } });
  232 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed"))).toBeNull();
  233 |   const reveal = page.locator("[data-path-reveal]");
  234 |   // by a row
  235 |   await page.locator('.simPanel tr[data-sim-row^="C12"]').click();
  236 |   await expect(reveal).toHaveText("Toolpath shown for this finding — hidden in Layers");
  237 |   await page.locator('.simPanel tr[data-sim-row="T20"]').click();
  238 |   await expect(reveal, "a row's tool change ends the reveal").toHaveCount(0);
  239 |   // by a step: from the collision the next on the timeline is the tool change
```