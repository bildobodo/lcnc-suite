# Backlog facts (Explore agent, 2026-09-27 evening) — code refs at 089694e, App.vue lines re-checked at c009504 (+2)

1 Tools tab gap: `.actionGroup.toolTabManage` (App.vue:2123) and `.toolSearchRow` (ToolTablePanel.vue:608) meet at 0 px.
  Parent `.toolsTab` (App.vue:2971) is a column flex WITHOUT gap; `.panelHead` gap / `.stack-controls` gap apply only inside.
  Program tab differs: GcodePanel puts .panelHead INSIDE .container.stack-controls (8 px). Files open → FileBrowser first, same 0 px.
  No gate: layout-audit overlap needs dx>1&&dy>1 (touching passes); layout.spec head-order check allows touching; no join check.
2 Tool table header: thead sticky z=1 (--z-raised), th no own background; sticky td.colT/.colAction/.colEdit also z=1 with --panel bg
  → later DOM (tbody sticky cells) paints over th.colT/th.colAction while scrolling. Also `.fade-scroll::before` sticky top, z=2,
  40 px, opaque at the top edge, on under .sf-up (scrollTop>1) → washes the header. OffsetPanel + GcodeReferenceDialog share dataTable+fade-scroll.
  border-collapse:collapse → th border may scroll away (Chromium). No gate scrolls a table (layout.spec:342-364 only opacity at scrollTop 0).
3 G30: ToolsetterSettings.vue:180-192 read-only outputs + "Set Current Position" (type probe, hold:false; handler checks can.ready,
  sends mdi "G30.1" via fire(...,'machineFrame')) + Refresh (GET /g30 reads var file 5181-5183, gateway.py:7082).
  set_probe_vars cannot write 5181-5183 (deny range 5000-99999). No manual entry; twp_buttons_check uses raw `#5181=…`.
4 Offsets edited cell: nothing marks it; td gets data-input-area/editableCell (--hl-surface-info) only; keypad trigger class
  `keypad-active` is applied only by MachineInput. Looks elsewhere: .inputField.keypad-active = 2px --focus-ring outline;
  KeyboardTab .kbKeyCell.listening = --hl-surface-info + 1px --info outline (closest); .selectedRow = info tint-note + outline tint-heavy.
5 Strip radios: JogStrip radioGrid.row-sections: stepCol (label + 5 radio rows) | .modeColSep | modeCol (Mode 3 + Kinematics Frame 2–3).
  NO landscape rule for .strip-radio-options → rows stack at 0 gap; widths from content. SetupStrip .wcsOptions landscape grid
  column flow, 5 rows (G54–58 | G59–59.3), column-gap 8. Budget --strip-section-h 264 (content ≈ 239.5). Touch: radio 18×18,
  .radio-label min-height 28 px, 0 px between rows (36 px compact floor NOT applied). layout.spec: sideways-scroll, footprints,
  shared portrait column; nothing measures radio pitch/hit height or the column split.

# G28/G30 research (agent) — summary
- No LinuxCNC GUI (AXIS, gmoccapy, QtDragon(_hd), probe_basic) puts G28/G30 on its offset page. probe_basic shows G30 read-only,
  set via "SET TOOL TOUCH OFF POS" (G30.1). QtDragon typed fields are the tool SENSOR, change position in INI.
- Industrial (Fanuc params 1240-1243, Haas settings 268-270, Sinumerik MD30600, Mach3 config): typed parameters in machine coords, off the offset page.
- Our offsets rows (G54–59.3 + R, G92, Tool, Comp) cover what other LinuxCNC GUIs show (ABS/G5x row redundant with active-row highlight).
- LinuxCNC: `#5181=…` legal in MDI (not read-only, required → persisted); G10 cannot set them; takes effect immediately; values are
  machine coords in INI units (convert G20/G21!); G30.1 stores all 9 axes (#5184-5186 rotaries; bare G30/M6-at-G30 moves them);
  wrapped rotaries only reduced 0–360 by G30.1; var file saved at Interp::synch() (mode switch, state change, before MDI lines) and exit;
  stat has no G28/G30 → read var file after a synch or echo own write.
