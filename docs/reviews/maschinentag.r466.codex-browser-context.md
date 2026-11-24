# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: program-header.viewer.spec.ts >> R466 Python comment: the card must not claim a proven header unit
- Location: e2e/program-header.viewer.spec.ts:224:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Array [
    Object {
-     "text": "T13 · L 63.192 · Ø 8.000 mm · program header Ø 8., units not proven — not compared",
+     "text": "T13 · L 63.192 · Ø 8.000 mm",
      "warn": false,
    },
  ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: LinuxCNC WebUI (local)
    - generic [ref=e6]:
      - generic [ref=e7]: 16:01:23
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
  - generic [ref=e52]:
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
      - generic [ref=e71]:
        - generic [ref=e72]:
          - generic [ref=e73] [cursor=pointer]:
            - checkbox "Sim" [ref=e74]
            - text: Sim
          - 'button "Help: Sim" [ref=e75] [cursor=pointer]'
        - button "Back to start" [ref=e76] [cursor=pointer]:
          - img [ref=e77]
        - button "Play the program through the machine model" [ref=e79] [cursor=pointer]:
          - img [ref=e80]
        - combobox "Playback speed" [ref=e82]:
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
        - generic [ref=e83]:
          - slider "Scrub the program — poses the machine model, nothing moves" [disabled] [ref=e84]: "0"
          - generic:
            - generic:
              - img
        - generic "0 %" [ref=e85]:
          - generic [ref=e88]: 0 %
        - button "Open the Sim tab" [ref=e89] [cursor=pointer]:
          - img [ref=e90]
    - generic [ref=e95]:
      - tablist "Side panel" [ref=e97]:
        - tab "Program" [ref=e98] [cursor=pointer]
        - tab "MDI" [ref=e99] [cursor=pointer]
        - tab "Probing" [ref=e100] [cursor=pointer]
        - tab "Offsets" [ref=e101] [cursor=pointer]
        - tab "Tools" [ref=e102] [cursor=pointer]
        - tab "Macros" [ref=e103] [cursor=pointer]
        - tab "Sim" [selected] [ref=e104] [cursor=pointer]
      - tabpanel "Sim" [ref=e106]:
        - generic [ref=e107]:
          - generic [ref=e109]: 0 %
          - generic [ref=e110]:
            - generic [ref=e111]: Collision check
            - progressbar "Collision check progress" [ref=e112]
            - generic [ref=e113]: 0 %
            - button "Check basis" [expanded] [active] [ref=e115] [cursor=pointer]:
              - img [ref=e116]
            - generic "Check basis" [ref=e119]:
              - generic [ref=e120]: Check basis
              - generic [ref=e121]:
                - term [ref=e122]: Basis
                - definition [ref=e123]: The machine when the check started — changed since
                - term [ref=e124]: Program kinematics
                - definition [ref=e125]: Machine frame
                - term [ref=e126]: Work offset
                - definition [ref=e127]: G54 values not read
                - term [ref=e128]: Start tool
                - definition [ref=e129]: None — the check uses a stub body
                - term [ref=e130]: Program tools
                - definition [ref=e131]: T13 · L 63.192 · Ø 8.000 mm
                - term [ref=e132]: Start
                - definition [ref=e133]: The program's first point
              - generic [ref=e134]: "The check's tool body: the table length + 20 mm, at least 40 mm, and the table's diameter (none: a 6 mm stub)."
            - 'button "Help: Collision check" [ref=e135] [cursor=pointer]'
          - generic [ref=e136]:
            - generic [ref=e137]:
              - img "No moving pairs" [ref=e138]:
                - img [ref=e139]
                - generic [ref=e142]: No moving pairs
              - img "No limit violations" [ref=e143]:
                - img [ref=e144]
                - generic [ref=e146]: No limit violations
              - img "1 tool change" [ref=e147]:
                - img [ref=e148]
                - generic [ref=e150]: 1 tool change
            - 'button "Help: Summary" [ref=e151] [cursor=pointer]'
          - generic [ref=e152]:
            - combobox "Show on the list" [ref=e153]:
              - option "All (1)" [selected]
              - option "Collisions (0)"
              - option "Limit violations (0)"
              - option "Tool changes (1)"
            - button "Previous on the timeline" [ref=e154] [cursor=pointer]:
              - img [ref=e155]
            - button "Next on the timeline" [ref=e157] [cursor=pointer]:
              - img [ref=e158]
            - 'button "Help: Timeline list" [ref=e160] [cursor=pointer]'
          - table [ref=e162]:
            - rowgroup [ref=e163]:
              - row "Kind Line What Move Time" [ref=e164]:
                - columnheader "Kind" [ref=e165]
                - columnheader "Line" [ref=e166]
                - columnheader "What" [ref=e167]
                - columnheader "Move" [ref=e168]
                - columnheader "Time" [ref=e169]
            - rowgroup [ref=e170]:
              - 'row "Show L7: Tool change → T13 Tool change → T13 0 %" [ref=e171] [cursor=pointer]':
                - cell [ref=e172]:
                  - img [ref=e173]
                - 'cell "Show L7: Tool change → T13" [ref=e175]':
                  - 'button "Show L7: Tool change → T13" [ref=e176]': L7
                - cell "Tool change → T13" [ref=e177]
                - cell [ref=e178]
                - cell "0 %" [ref=e179]
  - generic [ref=e180]:
    - generic [ref=e181]:
      - generic [ref=e182]: Safety
      - generic [ref=e183]:
        - button "Disarm" [ref=e185] [cursor=pointer]:
          - img [ref=e186]
          - generic [ref=e190]: Disarm
        - button "E-Stop" [ref=e192] [cursor=pointer]:
          - img [ref=e193]
          - generic [ref=e196]: E-Stop
        - group [ref=e197]:
          - button "Power on" [ref=e198] [cursor=pointer]:
            - img [ref=e199]
            - generic [ref=e202]: Power on
      - generic [ref=e203]:
        - generic [ref=e204]:
          - generic [ref=e205]:
            - generic [ref=e206]:
              - generic [ref=e207]: E-Stop
              - generic [ref=e210]: CLEAR
            - generic [ref=e211]:
              - generic [ref=e212]: Power
              - generic [ref=e215]: "OFF"
            - generic [ref=e216]:
              - generic [ref=e217]: Axes
              - generic [ref=e220]: HOMED
            - generic [ref=e221]:
              - generic [ref=e222]: Overrides
              - generic [ref=e225]: NONE
          - generic [ref=e226]:
            - generic [ref=e227]:
              - generic [ref=e228]: Mode
              - generic [ref=e231]: MANUAL
            - generic [ref=e232]:
              - generic [ref=e233]: Interp
              - generic [ref=e236]: IDLE
            - generic [ref=e237]:
              - generic [ref=e238]: Motion
              - generic [ref=e241]: JOINT
            - generic [ref=e242]:
              - generic [ref=e243]: Elapsed
              - generic [ref=e244]: 00:00
        - button "Active codes — open in the G-code reference" [ref=e246] [cursor=pointer]:
          - img [ref=e250]
    - generic [ref=e253]:
      - generic [ref=e254]: Jog
      - generic [ref=e255]:
        - generic [ref=e256]:
          - generic [ref=e258]:
            - button "Jog X- Y+" [ref=e259] [cursor=pointer]:
              - generic:
                - img
            - button "Y+" [ref=e260] [cursor=pointer]:
              - generic:
                - img
                - generic: Y+
            - button "Jog X+ Y+" [ref=e261] [cursor=pointer]:
              - generic:
                - img
            - button "X-" [ref=e262] [cursor=pointer]:
              - generic:
                - img
                - generic: X-
            - button "Stop" [ref=e263] [cursor=pointer]:
              - generic:
                - img
                - generic: Stop
            - button "X+" [ref=e264] [cursor=pointer]:
              - generic:
                - img
                - generic: X+
            - button "Jog X- Y-" [ref=e265] [cursor=pointer]:
              - generic:
                - img
            - button "Y-" [ref=e266] [cursor=pointer]:
              - generic:
                - img
                - generic: Y-
            - button "Jog X+ Y-" [ref=e267] [cursor=pointer]:
              - generic:
                - img
          - generic [ref=e268]:
            - button "Z+" [ref=e269] [cursor=pointer]:
              - generic:
                - img
                - generic: Z+
            - button "Z-" [ref=e270] [cursor=pointer]:
              - generic:
                - img
                - generic: Z-
        - generic [ref=e272]:
          - generic [ref=e273]: Speed
          - generic [ref=e274]:
            - generic [ref=e275]: "600"
            - generic [ref=e276]: mm/min
          - slider "Jog speed" [ref=e277] [cursor=pointer]: "10"
          - button "Reset jog speed to 600 mm/min" [ref=e278] [cursor=pointer]: "600"
        - generic [ref=e279]:
          - generic [ref=e280]:
            - generic [ref=e281]: Step (mm)
            - radiogroup "Jog step" [ref=e283]:
              - radio "Cont" [checked] [ref=e284] [cursor=pointer]
              - radio ".001" [ref=e285] [cursor=pointer]
              - radio ".01" [ref=e286] [cursor=pointer]
              - radio ".1" [ref=e287] [cursor=pointer]
              - radio "1" [ref=e288] [cursor=pointer]
          - generic [ref=e289]:
            - generic [ref=e290]: Mode
            - toolbar "Task mode" [ref=e291]:
              - radiogroup "Task mode" [ref=e292]:
                - radio "Manual" [checked] [ref=e293] [cursor=pointer]
                - radio "MDI" [ref=e294] [cursor=pointer]
                - radio "Auto" [ref=e295] [cursor=pointer]
    - generic [ref=e297]:
      - generic [ref=e298]:
        - text: Setup
        - 'button "Help: Go to positions" [ref=e299] [cursor=pointer]'
      - generic [ref=e302]:
        - textbox "Touch off X · G54" [ref=e303] [cursor=pointer]: "1.111"
        - button "Zero X" [ref=e304] [cursor=pointer]:
          - img [ref=e305]
          - text: X
        - button "Unhome X" [ref=e309] [cursor=pointer]:
          - img [ref=e310]
          - text: X
        - textbox "Touch off Y · G54" [ref=e314] [cursor=pointer]: "2.222"
        - button "Zero Y" [ref=e315] [cursor=pointer]:
          - img [ref=e316]
          - text: "Y"
        - button "Unhome Y" [ref=e320] [cursor=pointer]:
          - img [ref=e321]
          - text: "Y"
        - textbox "Touch off Z · G54" [ref=e325] [cursor=pointer]: "3.333"
        - button "Zero Z" [ref=e326] [cursor=pointer]:
          - img [ref=e327]
          - text: Z
        - button "Unhome Z" [ref=e331] [cursor=pointer]:
          - img [ref=e332]
          - text: Z
        - generic [ref=e336]:
          - button "Zero All" [ref=e337] [cursor=pointer]:
            - img [ref=e338]
            - text: Zero All
          - button "Unhome All" [ref=e342] [cursor=pointer]:
            - img [ref=e343]
            - generic [ref=e348]: Unhome All
          - button "Go to G30" [ref=e349] [cursor=pointer]
          - button "Go to MCS 0" [ref=e350] [cursor=pointer]
          - button "Go to WCS 0" [ref=e351] [cursor=pointer]
      - generic [ref=e354]: WCS
      - toolbar "Work offset" [ref=e356]:
        - radiogroup "Work offset" [ref=e357]:
          - radio "G54" [checked] [ref=e358] [cursor=pointer]
          - radio "G55" [ref=e359] [cursor=pointer]
          - radio "G56" [ref=e360] [cursor=pointer]
          - radio "G57" [ref=e361] [cursor=pointer]
          - radio "G58" [ref=e362] [cursor=pointer]
          - radio "G59" [ref=e363] [cursor=pointer]
          - radio "G59.1" [ref=e364] [cursor=pointer]
          - radio "G59.2" [ref=e365] [cursor=pointer]
          - radio "G59.3" [ref=e366] [cursor=pointer]
    - group [ref=e367]:
      - generic [ref=e368]: Overrides
      - generic [ref=e369]:
        - generic [ref=e370]:
          - generic [ref=e371]: Feed
          - generic [ref=e372]: 100 %
          - slider "Feed override" [disabled] [ref=e373]: "100"
          - button "Reset feed override to 100 %" [ref=e374] [cursor=pointer]: 100 %
        - generic [ref=e375]:
          - generic [ref=e376]: Spindle
          - generic [ref=e377]: 100 %
          - slider "Spindle override" [disabled] [ref=e378]: "100"
          - button "Reset spindle override to 100 %" [ref=e379] [cursor=pointer]: 100 %
        - generic [ref=e380]:
          - generic [ref=e381]: Rapid
          - generic [ref=e382]: 100 %
          - slider "Rapid override" [disabled] [ref=e383]: "100"
          - button "Reset rapid override to 100 %" [ref=e384] [cursor=pointer]: 100 %
    - generic [ref=e385]:
      - generic [ref=e386]: Spindle
      - generic [ref=e387]:
        - generic [ref=e388]:
          - button "Rev" [ref=e389] [cursor=pointer]:
            - generic [ref=e390]:
              - img [ref=e391]
              - text: Rev
          - button "Why is this unavailable? Spindle is already stopped" [ref=e394]:
            - button "Stop" [disabled]:
              - generic:
                - img
                - text: Stop
          - button "Fwd" [ref=e395] [cursor=pointer]:
            - generic [ref=e396]:
              - img [ref=e397]
              - text: Fwd
        - generic [ref=e400]:
          - button "Decrease spindle speed" [ref=e401] [cursor=pointer]:
            - img [ref=e402]
          - textbox "Spindle speed" [ref=e403] [cursor=pointer]: "1000"
          - button "Increase spindle speed" [ref=e404] [cursor=pointer]:
            - img [ref=e405]
      - generic [ref=e407]:
        - generic [ref=e408]: Coolant
        - generic [ref=e409]:
          - generic [ref=e411] [cursor=pointer]:
            - checkbox "Flood" [ref=e412]
            - text: Flood
          - generic [ref=e414] [cursor=pointer]:
            - checkbox "Mist" [ref=e415]
            - text: Mist
    - generic [ref=e417]:
      - generic [ref=e418]: Tool
      - button "Tool Table" [ref=e419] [cursor=pointer]
      - generic [ref=e421]: No tool loaded
```

# Test source

```ts
  136 |   await open(page);
  137 |   await publishFile(FILE, 6401, MISMATCH);
  138 |   await checked(page, 6401);
  139 |   await cardRows(page);
  140 |   await expect.poll(() => toolRows(page), { message: "no header before the text" }).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  141 |   const before = await diag(page);
  142 |   expect(before.text.proven, "the text is not on the page yet").toBeNull();
  143 |   h.release();
  144 |   await expect.poll(() => toolRows(page), { message: "the late text's header joins the card" })
  145 |     .toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875", warn: true }]);
  146 |   const after = await diag(page);
  147 |   expect(after.text.proven).toEqual({ programId: expect.any(String), version: 6401 });
  148 |   expect(after.starts, "no sweep started").toBe(before.starts);
  149 |   expect(after.fired, "no re-check timer fired").toBe(before.fired);
  150 |   expect(after.pending, "none scheduled").toBe(false);
  151 |   expect(after.text.shownCheck, "the same check on the bar").toEqual(before.text.shownCheck);
  152 | });
  153 | 
  154 | // MT461-01: V's card stays on screen while V+1's payload is held; V+1's text
  155 | // (another header) is proven on the page — and never reaches V's card. The
  156 | // same test's end proves the text WOULD hint: V+1's own check shows it.
  157 | test("V → V+1: V+1's text never enriches V's card; V+1's own check shows its header", async ({ page, context }) => {
  158 |   const v1 = text(["(T13 D=2.5 CR=1. - FLAT END MILL)"]);
  159 |   const vText = hold(), v1Preview = hold();
  160 |   await routes(context, { body: preview(), texts: { 6501: MISMATCH, 6502: v1 },
  161 |                           holdText: { 6501: vText }, holdPreview: { 6502: v1Preview } });
  162 |   await open(page);
  163 |   await publishFile(FILE, 6501, MISMATCH);
  164 |   await checked(page, 6501);
  165 |   await cardRows(page);
  166 |   await expect.poll(() => toolRows(page), { message: "V's card before V+1" }).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  167 |   // V+1 of the same load: its text arrives, its payload waits
  168 |   await publishFile(FILE, 6502, v1);
  169 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().proven?.version ?? null),
  170 |     { message: "V+1's text proven on the page" }).toBe(6502);
  171 |   await frames(page);
  172 |   expect(await page.evaluate(() => window.__viewerDiag!.getShownVersion!()), "V's payload still shown").toBe(6501);
  173 |   expect(await page.evaluate(() => window.__viewerDiag!.getCollisionActivity!().result), "V's check still on the bar").toBe(true);
  174 |   expect(await toolRows(page), "V's card: no header from V+1").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  175 |   // V's text was never proven (its fetch ended with V+1's announcement): never V's either
  176 |   vText.release();
  177 |   await frames(page);
  178 |   expect(await toolRows(page), "V's card after V's late text").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  179 |   // the positive control: V+1's payload lands, its check runs, its card names its own header
  180 |   v1Preview.release();
  181 |   await checked(page, 6502);
  182 |   await cardRows(page);
  183 |   await expect.poll(() => toolRows(page), { message: "V+1's card names V+1's header" })
  184 |     .toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 2.5", warn: true }]);
  185 | });
  186 | 
  187 | // A text whose bytes are not its announcement's (no proof) compares nothing;
  188 | // the same bytes WITH the proof hint (the first test).
  189 | test("a text without its proof (other bytes than announced) compares nothing", async ({ page, context }) => {
  190 |   await routes(context, { body: preview(), texts: { 6601: MISMATCH } });
  191 |   await open(page);
  192 |   // announced as parsed from another text: the served bytes do not prove it
  193 |   await publishFile(FILE, 6601, text(["(T13 D=8. CR=0. - FLAT END MILL)"]));
  194 |   await checked(page, 6601);
  195 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().state)).toBe("differs");
  196 |   await cardRows(page);
  197 |   await frames(page);
  198 |   expect(await toolRows(page), "a text without its proof: no header").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  199 | });
  200 | 
  201 | // Codex R463 MT-I34: an M-word is no proof of a neutral effect. Case A — Codex's
  202 | // own browser probe (maschinentag.r463.codex-browser.spec.ts), adopted: M70
  203 | // saves the start's (metric) state, M72 restores it before the move; the
  204 | // lexical G20 turned a matching Ø 8 into "Ø 8. in (203.200 mm)" in warn.
  205 | // Case B: G21, then M98 calls a sub that sets G20 before the move — the
  206 | // header read as mm and "matching". Both: the plain "not compared".
  207 | for (const [name, unit, tail, version] of [
  208 |   ["R463 case A (Codex's probe): M70 / G20 / M72", "M70\nG20\nM72", "", 6701],
  209 |   ["R463 case B: G21, M98 P100 calling a G20 sub", "N15 G21\nM98 P100", "\no100\nG20\nM99", 6702],
  210 | ] as const) {
  211 |   test(`${name}: units not proven — the header named, not compared, no warn`, async ({ page, context }) => {
  212 |     const t = text(["(T13 D=8.)"], unit) + tail;
  213 |     await routes(context, { body: preview(), texts: { [version]: t } });
  214 |     await open(page);
  215 |     await publishFile(FILE, version, t);
  216 |     await checked(page, version);
  217 |     await cardRows(page);
  218 |     await expect.poll(() => toolRows(page), { message: "a call or a modal restore: the units not proven" }).toEqual([
  219 |       { text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 8., units not proven — not compared", warn: false }]);
  220 |   });
  221 | }
  222 | 
  223 | // Codex R466: a Python hot comment is a hidden call before the first move.
  224 | test("R466 Python comment: the card must not claim a proven header unit", async ({ page, context }) => {
  225 |   const version = 6801;
  226 |   const t = text(["(T13 D=8.)"], 'G21\n;py,from interpreter import this; this.execute("G20")');
  227 |   await routes(context, { body: preview(), texts: { [version]: t } });
  228 |   await open(page);
  229 |   await publishFile(FILE, version, t);
  230 |   await checked(page, version);
  231 |   await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().proven?.version),
  232 |     { message: "the proven text of this publication has arrived" }).toBe(version);
  233 |   await cardRows(page);
  234 |   const rows = await toolRows(page);
  235 |   console.log("R466 observed card", JSON.stringify(rows));
> 236 |   expect(rows).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 8., units not proven — not compared", warn: false }]);
      |                ^ Error: expect(received).toEqual(expected) // deep equality
  237 | });
  238 | 
```