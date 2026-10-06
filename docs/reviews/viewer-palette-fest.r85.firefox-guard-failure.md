# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sim-panel.viewer.spec.ts >> the summary's "?" answers in its whole hit area, at the right edge of a full line
- Location: e2e/sim-panel.viewer.spec.ts:447:1

# Error details

```
Error: the line is full: its limit text gives way

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: LinuxCNC WebUI (local)
    - generic [ref=e6]:
      - generic [ref=e7]: 16:50:26
      - generic [ref=e10]: WS connected
      - generic [ref=e11]: "LCNC: -"
      - generic [ref=e14]: ARMED
      - generic "Keyboard shortcuts active" [ref=e15]:
        - img [ref=e16]
      - generic [ref=e26]:
        - button "Connection details" [ref=e28] [cursor=pointer]:
          - img [ref=e29]
        - button "Messages (0)" [ref=e31] [cursor=pointer]:
          - img [ref=e32]
        - button "G-code Reference" [ref=e34] [cursor=pointer]:
          - img [ref=e35]
        - button "Settings" [ref=e38] [cursor=pointer]:
          - img [ref=e39]
        - button "Fullscreen" [ref=e42] [cursor=pointer]:
          - img [ref=e43]
        - button "Shut Down" [ref=e52] [cursor=pointer]:
          - img [ref=e53]
          - generic [ref=e58]: Shut Down
  - generic [ref=e61] [cursor=pointer]: MACHINE OFF
  - group [ref=e62]:
    - generic [ref=e65]:
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
      - generic [ref=e69]:
        - button "Reset view" [ref=e70] [cursor=pointer]: Reset
        - button "Clear backplot" [ref=e71] [cursor=pointer]: Clear
        - button "Show camera" [ref=e72] [cursor=pointer]:
          - img [ref=e73]
        - button "3D Viewer settings" [ref=e76] [cursor=pointer]:
          - img [ref=e77]
      - generic:
        - generic:
          - generic:
            - generic "Machine kinematics — jogs move the machine axes": MACHINE · G54
            - generic: 1234567890 limit violations
        - generic [ref=e81]:
          - generic [ref=e82]:
            - generic [ref=e83] [cursor=pointer]:
              - checkbox "Sim" [ref=e84]
              - text: Sim
            - 'button "Help: Sim" [ref=e85] [cursor=pointer]': "?"
          - button "Play the program through the machine model" [ref=e86] [cursor=pointer]:
            - img [ref=e87]
          - generic [ref=e89]:
            - slider "Scrub the program — poses the machine model, nothing moves" [disabled] [ref=e90]: "0"
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
            - generic:
              - generic:
                - img
          - generic [ref=e91]: 00:00/01:56
    - generic [ref=e93]:
      - tablist "Side panel" [ref=e95]:
        - tab "Program" [ref=e96] [cursor=pointer]
        - tab "MDI" [ref=e97] [cursor=pointer]
        - tab "Probing" [ref=e98] [cursor=pointer]
        - tab "Offsets" [ref=e99] [cursor=pointer]
        - tab "Tools" [ref=e100] [cursor=pointer]
        - tab "Macros" [ref=e101] [cursor=pointer]
        - tab "Sim" [active] [selected] [ref=e102] [cursor=pointer]
      - tabpanel "Sim" [ref=e104]:
        - generic [ref=e105]:
          - generic [ref=e106]:
            - generic [ref=e107]: Speed
            - combobox "Playback speed" [ref=e108]:
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
            - generic [ref=e109]: 00:00/01:56
          - generic [ref=e110]:
            - generic [ref=e111]: Collision check
            - progressbar "Collision check progress" [ref=e112]
            - generic [ref=e114]: 100 %
            - 'button "Help: Collision check" [ref=e115] [cursor=pointer]': "?"
          - generic [ref=e116]:
            - generic [ref=e117]:
              - img "12 collisions" [ref=e118]:
                - img [ref=e119]
                - generic [ref=e122]: 12 collisions
              - img "1234567890 limit violations · the first 2 lines listed" [ref=e123]:
                - img [ref=e124]
                - generic [ref=e126]: 1234567890 limit violations · the first 2 lines listed
              - img "2 tool changes" [ref=e127]:
                - img [ref=e128]
                - generic [ref=e130]: 2 tool changes
            - 'button "Help: Summary" [ref=e131] [cursor=pointer]': "?"
          - generic [ref=e132]:
            - combobox "Show on the list" [ref=e133]:
              - option "All (16)" [selected]
              - option "Collisions (12)"
              - option "Limit violations (2)"
              - option "Tool changes (2)"
            - button "Previous on the timeline" [ref=e134] [cursor=pointer]:
              - img [ref=e135]
            - button "Next on the timeline" [ref=e137] [cursor=pointer]:
              - img [ref=e138]
            - 'button "Help: Timeline list" [ref=e140] [cursor=pointer]': "?"
          - table [ref=e142]:
            - rowgroup [ref=e143]:
              - row "Kind Line What Move Time" [ref=e144]:
                - columnheader "Kind" [ref=e145]
                - columnheader "Line" [ref=e146]
                - columnheader "What" [ref=e147]
                - columnheader "Move" [ref=e148]
                - columnheader "Time" [ref=e149]
            - rowgroup [ref=e150]:
              - 'row "Show L5: Tool ↔ Table Tool ↔ Table Feed 00:08" [ref=e151] [cursor=pointer]':
                - cell [ref=e152]:
                  - img [ref=e153]
                - 'cell "Show L5: Tool ↔ Table" [ref=e156]':
                  - 'button "Show L5: Tool ↔ Table" [ref=e157]': L5
                - cell "Tool ↔ Table" [ref=e158]
                - cell "Feed" [ref=e159]
                - cell "00:08" [ref=e160]
              - 'row "Show L6: Tool ↔ Table Tool ↔ Table Feed 00:12" [ref=e161] [cursor=pointer]':
                - cell [ref=e162]:
                  - img [ref=e163]
                - 'cell "Show L6: Tool ↔ Table" [ref=e166]':
                  - 'button "Show L6: Tool ↔ Table" [ref=e167]': L6
                - cell "Tool ↔ Table" [ref=e168]
                - cell "Feed" [ref=e169]
                - cell "00:12" [ref=e170]
              - 'row "Show L7: Tool ↔ Table Tool ↔ Table Feed 00:16" [ref=e171] [cursor=pointer]':
                - cell [ref=e172]:
                  - img [ref=e173]
                - 'cell "Show L7: Tool ↔ Table" [ref=e176]':
                  - 'button "Show L7: Tool ↔ Table" [ref=e177]': L7
                - cell "Tool ↔ Table" [ref=e178]
                - cell "Feed" [ref=e179]
                - cell "00:16" [ref=e180]
              - 'row "Show L8: Tool ↔ Table Tool ↔ Table Feed 00:20" [ref=e181] [cursor=pointer]':
                - cell [ref=e182]:
                  - img [ref=e183]
                - 'cell "Show L8: Tool ↔ Table" [ref=e186]':
                  - 'button "Show L8: Tool ↔ Table" [ref=e187]': L8
                - cell "Tool ↔ Table" [ref=e188]
                - cell "Feed" [ref=e189]
                - cell "00:20" [ref=e190]
              - 'row "Show L10: Tool change → T3 Tool change → T3 00:24" [ref=e191] [cursor=pointer]':
                - cell [ref=e192]:
                  - img [ref=e193]
                - 'cell "Show L10: Tool change → T3" [ref=e195]':
                  - 'button "Show L10: Tool change → T3" [ref=e196]': L10
                - cell "Tool change → T3" [ref=e197]
                - cell [ref=e198]
                - cell "00:24" [ref=e199]
              - 'row "Show L9: Tool ↔ Table Tool ↔ Table Feed 00:24" [ref=e200] [cursor=pointer]':
                - cell [ref=e201]:
                  - img [ref=e202]
                - 'cell "Show L9: Tool ↔ Table" [ref=e205]':
                  - 'button "Show L9: Tool ↔ Table" [ref=e206]': L9
                - cell "Tool ↔ Table" [ref=e207]
                - cell "Feed" [ref=e208]
                - cell "00:24" [ref=e209]
              - 'row "Show L10: Tool ↔ Table Tool ↔ Table Feed 00:28" [ref=e210] [cursor=pointer]':
                - cell [ref=e211]:
                  - img [ref=e212]
                - 'cell "Show L10: Tool ↔ Table" [ref=e215]':
                  - 'button "Show L10: Tool ↔ Table" [ref=e216]': L10
                - cell "Tool ↔ Table" [ref=e217]
                - cell "Feed" [ref=e218]
                - cell "00:28" [ref=e219]
              - 'row "Show L11: Tool ↔ Table Tool ↔ Table Feed 00:32" [ref=e220] [cursor=pointer]':
                - cell [ref=e221]:
                  - img [ref=e222]
                - 'cell "Show L11: Tool ↔ Table" [ref=e225]':
                  - 'button "Show L11: Tool ↔ Table" [ref=e226]': L11
                - cell "Tool ↔ Table" [ref=e227]
                - cell "Feed" [ref=e228]
                - cell "00:32" [ref=e229]
              - 'row "Show L12: Tool ↔ Table Tool ↔ Table Feed 00:36" [ref=e230] [cursor=pointer]':
                - cell [ref=e231]:
                  - img [ref=e232]
                - 'cell "Show L12: Tool ↔ Table" [ref=e235]':
                  - 'button "Show L12: Tool ↔ Table" [ref=e236]': L12
                - cell "Tool ↔ Table" [ref=e237]
                - cell "Feed" [ref=e238]
                - cell "00:36" [ref=e239]
              - 'row "Show L13: Tool ↔ Table Tool ↔ Table Feed 00:40" [ref=e240] [cursor=pointer]':
                - cell [ref=e241]:
                  - img [ref=e242]
                - 'cell "Show L13: Tool ↔ Table" [ref=e245]':
                  - 'button "Show L13: Tool ↔ Table" [ref=e246]': L13
                - cell "Tool ↔ Table" [ref=e247]
                - cell "Feed" [ref=e248]
                - cell "00:40" [ref=e249]
              - 'row "Show L14: Tool ↔ Table Tool ↔ Table Feed 00:44" [ref=e250] [cursor=pointer]':
                - cell [ref=e251]:
                  - img [ref=e252]
                - 'cell "Show L14: Tool ↔ Table" [ref=e255]':
                  - 'button "Show L14: Tool ↔ Table" [ref=e256]': L14
                - cell "Tool ↔ Table" [ref=e257]
                - cell "Feed" [ref=e258]
                - cell "00:44" [ref=e259]
              - 'row "Show L15: Tool ↔ Table Tool ↔ Table Feed 00:48" [ref=e260] [cursor=pointer]':
                - cell [ref=e261]:
                  - img [ref=e262]
                - 'cell "Show L15: Tool ↔ Table" [ref=e265]':
                  - 'button "Show L15: Tool ↔ Table" [ref=e266]': L15
                - cell "Tool ↔ Table" [ref=e267]
                - cell "Feed" [ref=e268]
                - cell "00:48" [ref=e269]
              - 'row "Show L16: Tool ↔ Table Tool ↔ Table Feed 00:52" [ref=e270] [cursor=pointer]':
                - cell [ref=e271]:
                  - img [ref=e272]
                - 'cell "Show L16: Tool ↔ Table" [ref=e275]':
                  - 'button "Show L16: Tool ↔ Table" [ref=e276]': L16
                - cell "Tool ↔ Table" [ref=e277]
                - cell "Feed" [ref=e278]
                - cell "00:52" [ref=e279]
              - 'row "Show L20: Tool change → T5 Tool change → T5 01:04" [ref=e280] [cursor=pointer]':
                - cell [ref=e281]:
                  - img [ref=e282]
                - 'cell "Show L20: Tool change → T5" [ref=e284]':
                  - 'button "Show L20: Tool change → T5" [ref=e285]': L20
                - cell "Tool change → T5" [ref=e286]
                - cell [ref=e287]
                - cell "01:04" [ref=e288]
              - 'row "Show L20: X 110 mm > max 100 mm X 110 mm > max 100 mm 01:04" [ref=e289] [cursor=pointer]':
                - cell [ref=e290]:
                  - img [ref=e291]
                - 'cell "Show L20: X 110 mm > max 100 mm" [ref=e293]':
                  - 'button "Show L20: X 110 mm > max 100 mm" [ref=e294]': L20
                - cell "X 110 mm > max 100 mm" [ref=e295]
                - cell [ref=e296]
                - cell "01:04" [ref=e297]
              - 'row "Show L32: X 120 mm > max 100 mm X 120 mm > max 100 mm 01:52" [ref=e298] [cursor=pointer]':
                - cell [ref=e299]:
                  - img [ref=e300]
                - 'cell "Show L32: X 120 mm > max 100 mm" [ref=e302]':
                  - 'button "Show L32: X 120 mm > max 100 mm" [ref=e303]': L32
                - cell "X 120 mm > max 100 mm" [ref=e304]
                - cell [ref=e305]
                - cell "01:52" [ref=e306]
  - group "Safety Disarm E-Stop E-Stop CLEAR Power OFF Axes HOMED Overrides NONE Mode MANUAL Interp IDLE Motion JOINT Elapsed 00:00 Active codes — open in the G-code reference" [ref=e307]:
    - generic [ref=e309]:
      - generic [ref=e310]: Safety
      - generic [ref=e311]:
        - button "Disarm" [ref=e313] [cursor=pointer]:
          - img [ref=e314]
          - generic [ref=e318]: Disarm
        - button "E-Stop" [ref=e320] [cursor=pointer]:
          - img [ref=e321]
          - generic [ref=e326]: E-Stop
        - group [ref=e327]:
          - button "Power on" [ref=e328] [cursor=pointer]:
            - img [ref=e329]
            - generic [ref=e333]: Power on
      - generic [ref=e334]:
        - generic [ref=e335]:
          - generic [ref=e336]:
            - generic [ref=e337]:
              - generic [ref=e338]: E-Stop
              - generic [ref=e341]: CLEAR
            - generic [ref=e342]:
              - generic [ref=e343]: Power
              - generic [ref=e346]: "OFF"
            - generic [ref=e347]:
              - generic [ref=e348]: Axes
              - generic [ref=e351]: HOMED
            - generic [ref=e352]:
              - generic [ref=e353]: Overrides
              - generic [ref=e356]: NONE
          - generic [ref=e357]:
            - generic [ref=e358]:
              - generic [ref=e359]: Mode
              - generic [ref=e362]: MANUAL
            - generic [ref=e363]:
              - generic [ref=e364]: Interp
              - generic [ref=e367]: IDLE
            - generic [ref=e368]:
              - generic [ref=e369]: Motion
              - generic [ref=e372]: JOINT
            - generic [ref=e373]:
              - generic [ref=e374]: Elapsed
              - generic [ref=e375]: 00:00
        - button "Active codes — open in the G-code reference" [ref=e377] [cursor=pointer]:
          - img [ref=e381]
    - generic [ref=e385]:
      - generic [ref=e386]: Jog
      - generic [ref=e387]:
        - generic [ref=e388]:
          - generic [ref=e390]:
            - button [ref=e391] [cursor=pointer]:
              - generic:
                - img
            - button "Y+" [ref=e392] [cursor=pointer]:
              - generic:
                - img
                - generic: Y+
            - button [ref=e393] [cursor=pointer]:
              - generic:
                - img
            - button "X-" [ref=e394] [cursor=pointer]:
              - generic:
                - img
                - generic: X-
            - button "Stop" [ref=e395] [cursor=pointer]:
              - generic:
                - img
                - generic: Stop
            - button "X+" [ref=e396] [cursor=pointer]:
              - generic:
                - img
                - generic: X+
            - button [ref=e397] [cursor=pointer]:
              - generic:
                - img
            - button "Y-" [ref=e398] [cursor=pointer]:
              - generic:
                - img
                - generic: Y-
            - button [ref=e399] [cursor=pointer]:
              - generic:
                - img
          - generic [ref=e400]:
            - button "Z+" [ref=e401] [cursor=pointer]:
              - generic:
                - img
                - generic: Z+
            - button "Z-" [ref=e402] [cursor=pointer]:
              - generic:
                - img
                - generic: Z-
          - generic [ref=e403]:
            - generic [ref=e404]:
              - button "A+" [ref=e405] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A+
              - button "A-" [ref=e406] [cursor=pointer]:
                - generic:
                  - img
                  - generic: A-
            - generic [ref=e407]:
              - button "C+" [ref=e408] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C+
              - button "C-" [ref=e409] [cursor=pointer]:
                - generic:
                  - img
                  - generic: C-
        - generic [ref=e410]:
          - generic [ref=e411]:
            - generic [ref=e412]: Linear
            - generic [ref=e413]:
              - generic [ref=e414]: "600"
              - generic [ref=e415]: mm/min
            - slider "Linear jog speed" [ref=e416] [cursor=pointer]: "10"
            - button "Reset linear jog speed to 600 mm/min" [ref=e417] [cursor=pointer]: "600"
          - generic [ref=e418]:
            - generic [ref=e419]: Rotary
            - generic [ref=e420]:
              - generic [ref=e421]: "600"
              - generic [ref=e422]: °/min
            - slider "Rotary jog speed" [ref=e423] [cursor=pointer]: "10"
            - button "Reset rotary jog speed to 600 °/min" [ref=e424] [cursor=pointer]: "600"
        - generic [ref=e425]:
          - generic [ref=e426]:
            - generic [ref=e427]: Step (mm / °)
            - radiogroup "Jog step" [ref=e429]:
              - radio "Cont" [checked] [ref=e430] [cursor=pointer]
              - radio ".001" [ref=e431] [cursor=pointer]
              - radio ".01" [ref=e432] [cursor=pointer]
              - radio ".1" [ref=e433] [cursor=pointer]
              - radio "1" [ref=e434] [cursor=pointer]
          - generic [ref=e435]:
            - generic [ref=e436]: Mode
            - toolbar "Task mode" [ref=e437]:
              - radiogroup "Task mode" [ref=e438]:
                - radio "Manual" [checked] [ref=e439] [cursor=pointer]
                - radio "MDI" [ref=e440] [cursor=pointer]
                - radio "Auto" [ref=e441] [cursor=pointer]
          - generic [ref=e442]:
            - generic [ref=e443]:
              - text: Kinematics Frame
              - 'button "Help: Kinematics Frame" [ref=e444] [cursor=pointer]': "?"
            - toolbar "Kinematics frame" [ref=e445]:
              - radiogroup "Kinematics frame" [ref=e446]:
                - radio "Machine" [checked] [ref=e447] [cursor=pointer]
                - radio "TCP" [ref=e448] [cursor=pointer]
    - generic [ref=e449]:
      - generic [ref=e450]:
        - text: Setup
        - 'button "Help: Go to positions" [ref=e451] [cursor=pointer]': "?"
      - generic [ref=e452]:
        - generic [ref=e453]:
          - generic [ref=e454]:
            - generic [ref=e455]:
              - textbox "Touch off X · Machine · G54" [ref=e456] [cursor=pointer]: "1.111"
              - button "Zero X" [ref=e457] [cursor=pointer]:
                - img [ref=e458]
                - text: X
              - button "Unhome X" [ref=e462] [cursor=pointer]:
                - img [ref=e463]
                - text: X
              - textbox "Touch off Y · Machine · G54" [ref=e467] [cursor=pointer]: "2.222"
              - button "Zero Y" [ref=e468] [cursor=pointer]:
                - img [ref=e469]
                - text: "Y"
              - button "Unhome Y" [ref=e473] [cursor=pointer]:
                - img [ref=e474]
                - text: "Y"
              - textbox "Touch off Z · Machine · G54" [ref=e478] [cursor=pointer]: "3.333"
              - button "Zero Z" [ref=e479] [cursor=pointer]:
                - img [ref=e480]
                - text: Z
              - button "Unhome Z" [ref=e484] [cursor=pointer]:
                - img [ref=e485]
                - text: Z
            - generic [ref=e489]:
              - textbox "Touch off A · Machine · G54" [ref=e490] [cursor=pointer]: "4.44"
              - button "Zero A" [ref=e491] [cursor=pointer]:
                - img [ref=e492]
                - text: A
              - button "Unhome A" [ref=e496] [cursor=pointer]:
                - img [ref=e497]
                - text: A
              - textbox "Touch off C · Machine · G54" [ref=e501] [cursor=pointer]: "5.55"
              - button "Zero C" [ref=e502] [cursor=pointer]:
                - img [ref=e503]
                - text: C
              - button "Unhome C" [ref=e507] [cursor=pointer]:
                - img [ref=e508]
                - text: C
          - generic [ref=e512]:
            - button "Zero XYZ" [ref=e513] [cursor=pointer]:
              - img [ref=e514]
              - text: Zero XYZ
            - button "Unhome All" [ref=e518] [cursor=pointer]:
              - img [ref=e519]
              - generic [ref=e524]: Unhome All
          - generic [ref=e525]:
            - button "Go to G30" [ref=e526] [cursor=pointer]
            - button "Go to MCS 0" [ref=e527] [cursor=pointer]
            - button "Go to WCS 0" [ref=e528] [cursor=pointer]
        - generic [ref=e529]:
          - generic [ref=e530]:
            - generic [ref=e531]: WCS
            - generic "Machine kinematics — jogs move the machine axes" [ref=e532]: MACHINE
          - toolbar "Work offset" [ref=e533]:
            - radiogroup "Work offset" [ref=e534]:
              - radio "G54" [checked] [ref=e535] [cursor=pointer]
              - radio "G55" [ref=e536] [cursor=pointer]
              - radio "G56" [ref=e537] [cursor=pointer]
              - radio "G57" [ref=e538] [cursor=pointer]
              - radio "G58" [ref=e539] [cursor=pointer]
              - radio "G59" [ref=e540] [cursor=pointer]
              - radio "G59.1" [ref=e541] [cursor=pointer]
              - radio "G59.2" [ref=e542] [cursor=pointer]
              - radio "G59.3" [ref=e543] [cursor=pointer]
    - group [ref=e544]:
      - generic [ref=e545]: Overrides
      - generic [ref=e546]:
        - generic [ref=e547]:
          - generic [ref=e548]: Feed
          - generic [ref=e549]: 100 %
          - slider "Feed override" [disabled] [ref=e550]: "100"
          - button "Reset feed override to 100 %" [ref=e551] [cursor=pointer]: 100 %
        - generic [ref=e552]:
          - generic [ref=e553]: Spindle
          - generic [ref=e554]: 100 %
          - slider "Spindle override" [disabled] [ref=e555]: "100"
          - button "Reset spindle override to 100 %" [ref=e556] [cursor=pointer]: 100 %
        - generic [ref=e557]:
          - generic [ref=e558]: Rapid
          - generic [ref=e559]: 100 %
          - slider "Rapid override" [disabled] [ref=e560]: "100"
          - button "Reset rapid override to 100 %" [ref=e561] [cursor=pointer]: 100 %
    - generic [ref=e562]:
      - generic [ref=e563]: Spindle
      - group [ref=e564]:
        - generic [ref=e565]:
          - button "Rev" [ref=e566] [cursor=pointer]:
            - generic [ref=e567]:
              - img [ref=e568]
              - text: Rev
          - button "Why is this unavailable? Spindle is already stopped" [ref=e571]:
            - button "Stop" [disabled]:
              - generic:
                - img
                - text: Stop
          - button "Fwd" [ref=e572] [cursor=pointer]:
            - generic [ref=e573]:
              - img [ref=e574]
              - text: Fwd
        - generic [ref=e577]:
          - button [ref=e578] [cursor=pointer]:
            - img [ref=e579]
          - textbox "Spindle speed" [ref=e581] [cursor=pointer]: "1000"
          - button [ref=e582] [cursor=pointer]:
            - img [ref=e583]
      - generic [ref=e587]:
        - generic [ref=e588]: Coolant
        - generic [ref=e589]:
          - generic [ref=e591] [cursor=pointer]:
            - checkbox "Flood" [ref=e592]
            - text: Flood
          - generic [ref=e594] [cursor=pointer]:
            - checkbox "Mist" [ref=e595]
            - text: Mist
    - generic [ref=e597]:
      - generic [ref=e598]: Tool
      - button "Tool Table" [ref=e599] [cursor=pointer]
      - generic [ref=e600]: No tool loaded
```

# Test source

```ts
  353 |   await expect(page.locator('.simPanel tr[data-sim-row="L57"]')).toHaveCount(1, { timeout: 15_000 });
  354 |   await settleLayout(page);
  355 |   await page.locator('.simPanel tr[data-sim-row="L8"]').click();
  356 |   await expect(page.locator(".simBanner")).toBeVisible();
  357 |   await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
  358 |     el.value = String(Number(el.max) * 0.15);
  359 |     el.dispatchEvent(new Event("input", { bubbles: true }));
  360 |   });
  361 |   await page.locator('.simPanel select[name="simSpeed"]').selectOption("100");
  362 |   await page.locator('.scrubBar [title="Play the program through the machine model"]').click();
  363 |   const samples: { key: string | null; inView: boolean; below: number }[] = [];
  364 |   for (let i = 0; i < 40; i++) {
  365 |     await page.waitForTimeout(50);
  366 |     samples.push(await page.evaluate(() => {
  367 |       const sc = document.querySelector(".simPanel .simTable") as HTMLElement;
  368 |       const tr = sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow");
  369 |       const head = sc.querySelector("thead")!.getBoundingClientRect(), b = sc.getBoundingClientRect();
  370 |       const r = tr?.getBoundingClientRect();
  371 |       return { key: tr?.dataset.simRow ?? null, inView: !!r && r.top >= head.bottom - 1 && r.bottom <= b.bottom + 1,
  372 |         below: r ? Math.round(r.bottom - b.bottom) : 0 };
  373 |     }));
  374 |   }
  375 |   const marked = samples.filter(s => s.key);
  376 |   expect(new Set(marked.map(s => s.key)).size, "the playback moved through many rows").toBeGreaterThan(5);
  377 |   expect(marked.filter(s => !s.inView), "every sample: the marked row wholly in the list's view").toEqual([]);
  378 | });
  379 | 
  380 | // Operator 2026-10-06 (live): the collision verdict came in with the
  381 | // check's result — and left with every re-check — and the filter and the
  382 | // steps under it jumped. ONE summary line is always there: × the check's
  383 | // verdict, ▲ the program's limit records, ● the tool changes.
  384 | test("the summary line is always there: a re-check moves nothing under it", async ({ page, context }) => {
  385 |   await prepare(page, context);
  386 |   // Every frame: where the list head sits, and whether a verdict shows.
  387 |   await page.evaluate(() => {
  388 |     const w = window as unknown as { __sumFrames: { y: number; verdict: boolean }[] };
  389 |     w.__sumFrames = [];
  390 |     const tick = () => {
  391 |       const head = document.querySelector(".simPanel .listHead"), panel = document.querySelector(".simPanel");
  392 |       if (head && panel) w.__sumFrames.push({ y: Math.round((head.getBoundingClientRect().top - panel.getBoundingClientRect().top) * 10) / 10,
  393 |         verdict: !!document.querySelector(".simPanel .checkVerdict") });
  394 |       requestAnimationFrame(tick);
  395 |     };
  396 |     requestAnimationFrame(tick);
  397 |   });
  398 |   await page.waitForTimeout(300);
  399 |   // A new version of the program clears the check's result; the check starts
  400 |   // again once the payload is decoded: no verdict for a while, then back.
  401 |   await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5101, file: "/sim.ngc" } });
  402 |   await expect.poll(() => page.evaluate(() => (window as unknown as { __sumFrames: { verdict: boolean }[] }).__sumFrames.some(f => !f.verdict)),
  403 |     { message: "the re-check cleared the verdict for a while", timeout: 15_000 }).toBe(true);
  404 |   await expect(page.locator(".simPanel .checkVerdict")).toHaveCount(1, { timeout: 30_000 });
  405 |   await page.waitForTimeout(300);
  406 |   const ys = await page.evaluate(() => [...new Set((window as unknown as { __sumFrames: { y: number }[] }).__sumFrames.map(f => f.y))]);
  407 |   expect(ys, "the filter and the steps never moved, in any frame").toHaveLength(1);
  408 | });
  409 | 
  410 | test("the summary names each kind: words in the wide pane, the glyph and the number narrow; a capped list says so", async ({ page, context }) => {
  411 |   await prepare(page, context);
  412 |   const items = page.locator(".simPanel .simSummary [role=img]");
  413 |   await expect(items).toHaveCount(3);
  414 |   expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label")))).toEqual(["2 collisions", "2 limit violations", "2 tool changes"]);
  415 |   await expect(page.locator(".simPanel .simSummary .sumWide").first()).toBeVisible();
  416 |   await expect(page.locator(".simPanel .simSummary .sumShort").first()).toBeHidden();
  417 |   await ctl({ op: "reset" });
  418 |   // The gateway's list holds its first 200 records; the summary says the total.
  419 |   await prepare(page, context, "touch-portrait", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: 9000 })));
  420 |   await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  421 |   await settleLayout(page);
  422 |   await expect(page.locator(".sidePane.narrow"), "150 % portrait: the narrow pane").toHaveCount(1);
  423 |   expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label"))))
  424 |     .toEqual(["2 collisions", "9000 limit violations · the first 2 lines listed", "2 tool changes"]);
  425 |   const shorts = page.locator(".simPanel .simSummary .sumShort");
  426 |   expect(await shorts.allInnerTexts(), "narrow: the number").toEqual(["2", "9000", "2"]);
  427 |   for (let i = 0; i < 3; i++) await expect(shorts.nth(i), "narrow: each number shows").toBeVisible();
  428 |   await expect(page.locator(".simPanel .simSummary .sumWide").first()).toBeHidden();
  429 |   const box = await page.locator(".simPanel .simSummary").evaluate(el => ({ w: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 0 }));
  430 |   expect(box.w, "narrow: the whole line fits").toBeLessThanOrEqual(box.cw);
  431 |   // Codex R82 VP-I42: narrow, the cap was said only in a name and a mouse
  432 |   // tooltip. The line's own "?" says it — by keyboard and by a tap.
  433 |   const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  434 |   const said = /^9000 limit violations, a line and an axis each\. The parse sends the first 2; the list shows their 2 lines\.$/;
  435 |   await help.focus();
  436 |   await page.keyboard.press("Enter");
  437 |   await expect(page.locator(".helpPopover:popover-open"), "keyboard: the cap in words").toHaveText(said);
  438 |   await page.keyboard.press("Enter");
  439 |   await expect(page.locator(".helpPopover:popover-open")).toHaveCount(0);
  440 |   await help.click();
  441 |   await expect(page.locator(".helpPopover:popover-open"), "a tap: the cap in words").toHaveText(said);
  442 | });
  443 | 
  444 | // Codex R83 VP-I43: with a full summary line the "?" sat at the tab
  445 | // content's clipping edge and the outer 4 px of its 24 px hit area were cut
  446 | // off — a tap there landed on the side pane. The row keeps the reach.
  447 | test("the summary's \"?\" answers in its whole hit area, at the right edge of a full line", async ({ page, context }) => {
  448 |   // A FULL line (Codex's case: 1600 × 1000): twelve collisions and a
  449 |   // ten-digit total — the limit text gives way, the "?" ends the line.
  450 |   await prepare(page, context, "desktop", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: 1234567890 })));
  451 |   await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(Array.from({ length: 12 }, (_, i) => ({ line: 5 + i, frac: (2 + i) / 29 }))));
  452 |   await settleLayout(page);
> 453 |   expect(await page.locator(".simPanel .sumLimit .sumWide").evaluate(el => el.scrollWidth > el.clientWidth), "the line is full: its limit text gives way").toBe(true);
      |                                                                                                                                                            ^ Error: the line is full: its limit text gives way
  454 |   const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  455 |   const g = await help.evaluate(el => {
  456 |     const r = el.getBoundingClientRect(), tab = el.closest(".tab-content")!.getBoundingClientRect();
  457 |     const z = r.width / (el as HTMLElement).offsetWidth;
  458 |     const hit = parseFloat(getComputedStyle(el, "::before").width);
  459 |     return { right: r.right, cy: (r.top + r.bottom) / 2, reach: (hit * z - r.width) / 2, tabRight: tab.right };
  460 |   });
  461 |   expect(g.reach, "the hit area reaches past the glyph").toBeGreaterThan(1);
  462 |   expect(g.tabRight - g.right, "the \"?\" ends the full line, its reach inside the tab").toBeLessThanOrEqual(g.reach + 1);
  463 |   await page.mouse.click(g.right + g.reach - 1, g.cy);
  464 |   await expect(page.locator(".helpPopover:popover-open"), "a tap at the hit area's outer edge").toHaveCount(1);
  465 | });
  466 | 
```