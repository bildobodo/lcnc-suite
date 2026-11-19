# Fable · independent view on the strip with more axes · 19 November 2026

Fable got the brief `~/claude-work/stripfit/axes-plan/fable-brief.md` (the operator's question, the measurements, the prototype renders, the rules in CLAUDE.md), read-only, without my recommendation. Its report, verbatim:

---

## The strip with more axes and narrower windows: my view

Read-only: I read the brief, `plan.md`, `shots/axes.jsonl`, about a dozen of the renders, and the strip code in `~/lcnc-suite-isk` (`App.vue`, `style.css`, `ToolStrip.vue`, `SpindleStrip.vue`, `dragScroll.ts`). I did not open the W1 render; what I say about it comes from its CSS.

### Recommended behaviour
Not everything has to be visible, but everything you reach for while the machine moves does. I would make it a ladder of forms, each a pure function of configuration and room:

1. **Full**: as merged.
2. **Tool yields** (M1): fits 4 and 5 axes at 1920 (XYZA, XYZAC: overflow 0, both insets 8).
3. **Right group pinned** (M2: Overrides + Spindle): only if the middle window still holds the widest scrolling section (Jog) whole.
4. **Overrides pinned alone**: where form 3 fails that floor; Spindle scrolls again.
5. **Plain scroll**: below that.

- **The floor matters at 1280.** Computed, not rendered: the middle is about 535–560 px, against Jog at 523.5 (XYZ), 662.5 (XYZAC) and 735.5 (TWP). So 1280 with three axes just holds form 3; with 5 or 6 axes Jog can never be seen whole and form 4 applies (TWP: about 780 px of room).
- **Tool yielding alone does not solve 1280 × 800 with three axes.** `1280-XYZ-M1` still overflows 376 px, with Spindle Stop hidden at start and mid.

### Never behind an edge
In order of priority:

1. **E-Stop**: holds today.
2. **The three overrides**: the only run-time controls; feed is the soft stop.
3. **Spindle Stop**: its gate is closed during a run (the program owns the spindle), so it is the first of the three to give way. That is where I differ from plan rule G1.
4. **Jog Stop**: must be visible whenever any jog button is.
   - `1280-XYZAC-M2-mid` shows A± and C± with Stop under Safety; `jogStop` is false at mid/end in every 1280 M2 case.
   - The floor fixes this only if scroll positions snap to whole sections; otherwise Stop needs to stay with the pad.
5. **"In effect" (G43/G49)**: stays readable beside the spindle; the plan has this right.

### What yields first, and where it goes
- **Tool yields first.** T and "In effect" move into Spindle; pocket, type and description go to the Tools tab.
- **Ø and L** are already in the viewer's tool line (`ThreeViewer.vue` `.hudTool`), but that line can be folded or switched off, so say so to the operator.
- **Tool Table button**: I would make the "Tool T12" row itself the nav button, at full compact height (36 px touch). A 20 px text row must not become a target.
- **Spindle never collapses.**
- **Next to yield** is Setup's second WCS column (the G59.x scratch rows, already dimmed) behind the edge; that is what M2 hides at 1920.

### What decides, and what must not
- **Decides:** the axis set from `viewer_init`, the declared kinematics capability, orientation, the strip's own width, and density.
- **How:** prefer per-density base widths over a live measurement. If measured, measure only while all sections are shown (hidden sections measure 0 while a helper is open) and add a few px of hysteresis.
- **Must not decide:** measured overflow, scroll position, helper open or held, the live kinematics frame or Setup's chip, tool text length, arm/E-Stop/homing state, font load.
- **Timing:** every form change goes through `heldThroughPress` like the helper swap, including the density switch after the first touch.

### What looks wrong or breaks a rule in the renders
- **Rest-taking Spindle moves under a press.** Spindle owns the RPM keypad. The prototype switches the rule off by `:has(.nkStrip, .tkStrip)`, which does not match `.stripHelperPlace`. So when the keypad closes under a press, Spindle would grow from 233 px to the row's rest and push the held place. Tool never had this problem because it owns no field. Key the rule on the held `stripLayout`, not the DOM.
- **XYA-M1 looks unfinished.** Spindle is 441.5 px: the RPM field stretches to about 350 px while Rev/Stop/Fwd stay packed left. Cap the growth or share it across the row.
- **Swipes in the 1280 M2 middle will jog.** `dragScroll` skips `.jogBtn` and inputs, so the window is almost all surface that jogs instead of scrolling, leaving a thin scrollbar. This is the strongest argument for the floor.
- **Tab focus can land under a pinned section.** The strip has no `scroll-padding`; it needs left = Safety and right = the pinned group, per form.
- **The `seen` measure is too lenient.** It tests the centre point only, so a half-covered button passes; the guard should require the whole box.
- **Fades eat the narrow middle.** Two 40 px fades are about 15 % of a 535 px window. The M2 fade hangs over the cut A/B/C buttons in `1920-TWP-M2`, and it must stay `pointer-events: none`.
- **A pin for 28 px is heavy.** XYZABC without kinematics overflows by 28 px after Tool yields; acceptable, but name it to the operator.
- **W1/W2 `justify-content: space-between` breaks the helper rule.** With sections hidden it sends the keypad to the far end instead of directly right of its owner, and the dividers no longer sit mid-gap. If built, it must be off under the held helper layout. W2's picture at least uses the room; it should reuse `ToolPreview`, not a canvas copy.

### Risks I would test
- Form flicker at ±1 px and under 150 % zoom, with fractional widths, in Firefox and Chromium.
- No form change and no growth under a press: keypad closed by pressing Spindle Stop, E-Stop or an override; two pointers.
- Form computed while a helper is open, and on the density switch.
- Every pinned or required control whole and topmost at start, mid and end, per axis set, at 1280, 1600 and 1920.
- Tab through the strip: no focused control under either pinned side.
- Jog Stop visible whenever a jog button is.
- A swipe that starts on a jog button moves nothing sideways and jogs exactly once.
- Sticky-right bleed in the 8 px end padding and radius, in both themes.
- Strip height unchanged across forms, and one width per section in every state for 4–6 axes.
- The 3-axis 1920 references unchanged.
