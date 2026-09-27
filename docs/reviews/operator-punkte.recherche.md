Design-system research: series colours, one-of-N selectors, tables, spacing, position teach

[P] = read the primary page/source/manual; [S] = secondary. Not consulted: Beckhoff, B&R, ctrlX, Honeywell/ASM, KUKA; Fluent 2 not covered for B/C. ix.siemens.io returned 404 to the fetcher; iX was read from its docs source on GitHub and its shipped npm CSS/JS.

A. Series colours on dark and light
- Siemens iX: each theme has its own 17-colour chart set. Classic-dark: chart-1…8 = #00ffe7 #94ffc9 #00c2cc #a3eeff #90b4c5 #42c6ff #7aaaff #9ebbff. Classic-light: #008a7c #00572b #00838f #003c61 #61778c #0076a8 #182171 #0041d6… Each has a "-40" (40 % opacity) twin for comparisons. Its accessibility guide says: "Ensure data visualization meets 3:1 contrast with the background." ECharts theme: line width 2 px. [P] https://unpkg.com/@siemens/ix@5.2.1/dist/siemens-ix/theme/classic-dark.css · …/classic-light.css · https://github.com/siemens/ix-docs/blob/main/docs/components/charts-overview/overview.mdx · https://github.com/siemens/ix-docs/blob/main/docs/guidelines/accessibility/overview.md · https://unpkg.com/@siemens/ix-echarts@4.1.1/dist/index.js
- IBM Carbon has 14 categorical colours per theme, and the order is mandatory ("applied in sequence strictly"). Dark: #8a3ffc #33b1ff #007d79 #ff7eb6 #fa4d56 #fff1f1 #6fdc8c #4589ff #d12771 #d2a106 #08bdba #bae6ff #ba4e00 #d4bbff. Light: #6929c4 #1192e8 #005d5d #9f1853 #fa4d56 #570408 #198038 #002d9c #ee538b #b28600 #009d9a #012749 #8a3800 #a56eff. Carbon Charts lines use `stroke-width: 1.5`. UI components need "3:1 against adjacent colors". [P] https://github.com/carbon-design-system/carbon-website/blob/main/src/data/data-visualization/palettes.js · https://unpkg.com/@carbon/charts/dist/styles.css · https://carbondesignsystem.com/guidelines/accessibility/color/
- Atlassian has 8 categorical tokens per theme. Light: #357DE8 #82B536 #BF63F3 #F68909 #1558BC #964AC0 #42B2D7 #BD5B00. Dark: #4688EC #94C748 #C97CF4 #FCA700 #1558BC #964AC0 #42B2D7 #E06C00. The docs say the colours "pass 3:1 contrast ratios against surfaces, they don't against each other. For this reason, apply a space or border (color.border.inverse)". That token is the surface colour, #FFFFFF on light and #18191A on dark, so it works as a halo. Highlight = fade the rest (`chart.neutral` / `opacity.disabled`). [P] https://atlassian.design/foundations/color/data-visualization-color · https://unpkg.com/@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-dark.js
- Fluent 2 charting: the 10 base colours are the same in both themes (#637cef #e3008c #2aa0a4 #9373c0 #13a10e #3a96dd #ca5010 #57811b #b146c2 #ae8c00). "users will be responsible for managing the contrast ratio". [P] https://github.com/microsoft/fluentui/blob/master/packages/charts/react-charts/library/src/utilities/colors.ts
- Apple HIG: don't rely on colour alone ("use different shapes or patterns"), and add "visual separation between contiguous areas of color". [P] https://developer.apple.com/design/human-interface-guidelines/charts
- Do they use cyan or magenta for highlights on dark?
  - iX uses cyan for selection and editing on dark: primary #00bde3, dynamic #00eaff, "ghost-selected" is a 10 % cyan tint, and in the AG Grid theme the editing-cell and range-selection borders use `--theme-color-dynamic`. On light, dynamic turns dark teal (#005e66), so cyan is a dark-theme choice only. Focus stays blue (#199fff) in both themes. [P] https://unpkg.com/@siemens/ix-aggrid@5.1.0/dist/index.js
  - Carbon's dark focus ring is white #ffffff with a #161616 inset, a two-tone ring. [P] https://unpkg.com/@carbon/themes@11.82.0/js/generated/themes/g100.js
  - Magenta is never a reserved highlight (Carbon #ff7eb6, Fluent #e3008c are ordinary slots); no system defines a "selected series" colour — the pattern is fade-the-rest.

B. Segmented control, radio group, button group
- Apple: "no more than about five to seven segments in a wide interface and no more than about five segments on iPhone". iOS/iPadOS controls are 44×44 pt by default and 28×28 pt at minimum. [P] https://developer.apple.com/design/human-interface-guidelines/segmented-controls · …/accessibility
- Material 3: segmented buttons are "being deprecated in the Material 3 expressive" in favour of the connected button group. [P] https://github.com/material-components/material-components-android/blob/master/docs/components/ToggleButtonGroup.md. Older M3 guidance: 2–5 segments, and more than 5 → chips. [S] https://m3.material.io/components/segmented-buttons/guidelines
- Carbon: the content switcher is for views and "should not be used as a binary input control". It comes in 32, 40 and 48 px heights. Radio groups: "When possible, arrange … vertically". [P] https://carbondesignsystem.com/components/content-switcher/usage/ · …/radio-button/usage/
- iX:
  - Radios go horizontal "for short labels with two to three options, and a vertical layout for more options".
  - "Don't use toggle buttons in button groups where only one option can be selected (use normal buttons…)".
  - Control heights are 24, 32 and 40 px. The minimum target is 24×24 px; a clickable chip is at least 32 px.
  - [P] https://github.com/siemens/ix-docs/blob/main/docs/components/radio/guide.md · …/toggle-button/guide.md · https://unpkg.com/@siemens/ix@5.2.1/dist/siemens-ix/siemens-ix-core.css
- Rockwell Process HMI Style Guide: an operating-mode change uses command buttons, "each state should have a separate command button". Configuration choices "shall use radio buttons", with "eight or fewer options". Buttons ≥ 40×40 px, radios 30 px touch height. [P] https://literature.rockwellautomation.com/idc/groups/literature/documents/wp/proces-wp023_-en-p.pdf
- WCAG 2.5.8: "at least 24 by 24 CSS pixels", or undersized targets spaced so that 24 px circles don't intersect. [P] https://www.w3.org/TR/WCAG22/#target-size-minimum
- How CNC controls present jog increments:
  - Sinumerik: a row of fixed keys "[1], [10], ..., [10000]" plus [VAR], a variable increment set through a softkey. [P] https://adegis.com/media/asset/58631e3f1c8f66287f1fde47efb412d0736e355ef5f30656b7ddba5cb6983a92.pdf. The 802D sl instead cycles one `<INCREMENT>` key. [P] https://cache.industry.siemens.com/dl/files/102/28436102/att_41533/v1/802Dsl_BPMMP_0609_en_en-US.pdf
  - Heidenhain TNC 640: a typed infeed ("0.001 mm to 10 mm") plus an INCREMENT ON/OFF soft key. [P] https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-11/einrichten/1261174-22.pdf
  - FANUC handwheel: a rotary switch with "OFF, x1, x10, x100, and x1000". [P] https://www.fanuc.co.jp/en/product/stddoc/pdf/A-45344_InstallationConditionForULRecognition.pdf
  - Haas: dedicated keys .0001/.1, .001/1., .01/10. and .1/100. [S] (haascnc.com returned 403) https://learn.toolingu.com/class/310270

C. Data tables
- Sticky headers appear only as implementation options, not as written guidance:
  - Carbon's `stickyHeader` prop: "keep the header sticky (only data rows will scroll)". [P] https://github.com/carbon-design-system/carbon/blob/main/packages/react/src/components/DataTable/Table.tsx
  - Material has no data table; it is listed under components "we have not built yet". [P] https://github.com/material-components/material-web/blob/main/docs/roadmap.md
  - iX hands tables to AG Grid.
- Selected row = a tint plus an edge:
  - Carbon: `$layer-selected` background plus `$border-subtle-selected` bottom border. [P] https://carbondesignsystem.com/components/data-table/style/
  - iX AG Grid theme: `selectedRowBackgroundColor: var(--theme-color-ghost--selected)` (a tint). [P] https://unpkg.com/@siemens/ix-aggrid@5.1.0/dist/index.js
  - Atlassian: #E9F2FE / #1C2B42; "Never rely on highlighted rows to convey … selection, or focus". [P] https://atlassian.design/components/dynamic-table/usage
- How an edited cell looks:
  - iX: `cellEditingBorderColor: var(--theme-color-dynamic)`, i.e. a border in the interactive colour. [P] (same file)
  - Atlassian: read and edit views should have "identical styling", with save/cancel controls "at the end of the field". For complex tables, use "a modal dialog … instead of input fields that are directly part of the dynamic table". [P] https://atlassian.design/components/inline-edit/usage

D. Spacing
- No system publishes a toolbar-to-search-row token. Carbon puts search inside the toolbar row. The toolbar is 48 px with 16 px margins, or 32 px with 8 px margins in compact tables. [P] https://carbondesignsystem.com/components/data-table/usage/ · …/style/
- Spacing within a group: iX recommends "a gap of 0.5rem between buttons" [P]. Atlassian uses 0–8 px for "repeating elements (ie button groups)" and 12–24 px for less dense UI [P] https://atlassian.design/foundations/spacing. Carbon's scale is 2/4/8/12/16/24 [P] https://carbondesignsystem.com/elements/spacing/overview/. Fluent uses a 4 px base [P] https://fluent2.microsoft.design/layout
- Gap between touch targets:
  - Google: "at least 48x48dp, separated by 8dp of space or more". [P] https://support.google.com/accessibility/android/answer/7101858
  - Rockwell: "10 pixels between command touch objects", 4 px absolute minimum, 2 px for navigation buttons. [P] (Rockwell PDF above)
  - Apple: "about 12 points of padding around elements that include a bezel". [P] https://developer.apple.com/design/human-interface-guidelines/accessibility

E. "Teach current position" vs typed X/Y/Z — every system I checked offers both, and a capture fills the selected field; it does not go straight to the machine
- Sinumerik 802D sl offers "Direct position entry" and "Accepting the current actual position". If no field is selected, the capture fails with "This value cannot be accepted". [P] (802D sl PDF above)
- Heidenhain traverse limits: "Define a value … or Apply the current position by pressing the ACTUAL POSITION CAPTURE soft key". [P] (TNC 640 PDF above)
- ABB IRC5 has two routes. ModPos: jog the robot, then a confirmation asks "Tap Modify to use the new position, Cancel to keep the original". HotEdit: numeric offsets typed on a soft keyboard. [P] https://bpb-us-e1.wpmucdn.com/wp.txstate.edu/dist/3/3147/files/2020/12/ABB-Robot-Operation-Manual.pdf
- Universal Robots' Pose Editor takes typed or ± values and "does not control the Robot Arm directly". A shadow shows the target next to the current pose, and OK then moves the robot. [P] https://www.universal-robots.com/manuals/EN/HTML/SW5_19/Content/prod-usr-man/complianceUR16e/SW_sections/first_program/pose_editor.htm

What this means for us
1. Viewer palette: per-theme palettes, 3:1 on every surface and a background-coloured halo match iX/Carbon/Atlassian. Our 1 px path is thinner than their 1.5–2 px series. Cyan on dark has precedent (iX); magenta as a highlight has none. Emphasise by fading the rest.
2. Jog increments: one horizontal row of ≤ ~5 mutually exclusive buttons (radio semantics) plus one typed "variable" value. Two radio columns are the configuration form, not the operating-step form.
3. Tools/Offsets tables: sticky header; selected row or cell = tint + edge, never colour alone; the edited cell gets an interactive-colour border with visible save/cancel, or a dialog for complex rows.
4. Spacing: Google 8 dp and Rockwell 10 px between touch targets; our `--gap-tight` 4 px floor is only the non-touch minimum. Toolbar and search can share one row (Carbon); stacked, 8 px apart (compact) or 16 px.
5. G30/toolsetter positions: a numeric field per axis plus "Use current" (into the field, then Save), one "capture all", and a confirmation when a capture overwrites a stored value (ABB).
