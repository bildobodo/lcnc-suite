# WebUI Review-Welle — Bugs, Design-Regeln, Regressions-Tooling

**Fassung 3 · 20. September 2026 · nach Codex-Review Runde 2 + Nutzer-Nachtrag UI-15
(`docs/reviews/ui-optimierungen.review.md`).** Runde 1: alle 14 IDs übernommen. Runde 2: die
fünf Nachschärfungen (UI-01, 06, 09, 11, 12) sind eingearbeitet und mit `[UI-nn R2]` markiert;
UI-15 (gemeinsame Eingabehilfe) ist als **WP8** aufgenommen und integriert UI-13.

**Fassung 4 · 21. September 2026 · Abschluss nach Codex-Implementierungsrunde 4 + UX-01–13:** die
Restbefunde UI-I10/UI-I11, der Feldvertrag UX-13 und die zwölf UX-Vorschläge mit den drei
Operator-Entscheidungen stehen im Abschnitt [„Fassung 4 — Abschluss“](#fassung-4--abschluss) am
Ende dieser Datei; WP0–WP8 oben sind umgesetzt und bleiben als Referenz der Runden 1–4.

## Kontext

Der Operator meldete vier Defekte (Tool-Edit-Dialog „zusammengeklatscht", Numpad ändert
Strip-Höhe/Viewer wächst, Kamera clipt von schräg unten ins Modell, Offset-Clear wirft Fehler
statt ausgegraut und ohne Hold-Delay) und forderte ein ernsthaftes Review plus **Werkzeuge,
die solche Regressionen erkennen**. Vier Erkundungen haben Ursachen verifiziert und ~40 weitere
Befunde geliefert, darunter Sicherheits-/Datenverlust-Fälle (Leertaste startet Programm bei
fokussiertem Numpad; Editor speichert in die gewechselte Datei; Numpad bestätigt `1.2.3` als 1.2).

**Operator-Entscheidungen (2026-09-19):** Escape bleibt globaler E-Stop, E-Stop-Reset nur noch
per Button; Strip: Scrollbar-Band immer reserviert; Offset Clear + Clear All beide mit Hold
(kein Dialog); Umfang: alles (P0–P3 + Tooling).

**Rahmen:** Feature-Branch von `development` (`feat/ui-review-wave`), Merge nach `development`.
Aktuell läuft eine Suite live (XYZAC-Sim + `hal_watchdog.py`): **keine Builds/Vitest/Playwright,
solange sie läuft** (`pgrep -f hal_watchdog.py`). Vor jedem `.vue`/`.css`-Edit gilt die
Pre-Flight-Checkliste aus CLAUDE.md.

**Prioritäten [Review „Prioritäten im Plan"]:** P0 = unbeabsichtigte Maschinenaktion oder stiller
Datenverlust im Normalbetrieb (Leertaste→Cycle Start, Editor-Fehlspeicherung, Numpad-Fehlwert
an ein Touch-off-Ziel). Fehlende Bestätigungsdialoge ohne Maschinenwirkung sind P1
(„Replace table" ist P1, nicht P0).

---

## Verifizierte Befunde (Kurzfassung, Fundstellen)

### A. Tool-Edit-Dialog — `ToolTablePanel.vue:576-665` (Template), `:873-931` (CSS)
- Nicht teleportiert: liegt im 540 px `.sidePane`. `.dialog.lg` (`style.css:1026`) von scoped
  `.editDialog {min/max-width 420/480px}` überschrieben; eigener `.editBody`/`.editFooter` statt
  `.dialogContent`/`.dialogActions`. **244 px für alle Felder**; Inputs stoßen an die
  `.inset-panel`-Box. Beide `.sub` im selben Grid (kein Abschnittsabstand); tote Regel `:910`.
- `toolPreviewNotice()` (FreeCAD: 140–240 Zeichen) als `<span class="noteWarn">` in der 176-px-
  Spalte umgebrochen. Canvas 160×280 doppelt (`:644`, `:915`). `.errorBanner` randlos.
- Referenz: Import-Dialog (`:668-743`): Teleport nach `#content-dialog-area` (`App.vue:1686`),
  `.dialog.md`, `.dialogHeader/.dialogContent/.dialogActions`. Globales Grid `.paramGrid` /
  `.paramGrid.twoCol` (`style.css:901-915`, Caveat `input {max-width:100px}`).
- Add/Save schließt den Dialog sofort ohne Reply (`:257-263`); nur Renumber wartet. **[UI-12]**
- E2E: `e2e/tool-geometry.spec.ts:40-42` prüft nur `fields.right <= preview.x`.

### B. Strip-Höhe beim Numpad — `App.vue:2320-2336`, `style.css:1190-1197`
- `.strip` `overflow-x: auto`, auto-hoch. Numpad öffnen blendet Sektionen aus (`stripVis`,
  `App.vue:344-361`) → horizontaler Überlauf weg → Band (8–11 px) weg → Strip niedriger →
  `.viewerPane` wächst. `scrollbar-gutter: stable` wirkt nur auf die Block-Achse.
- **Portrait ebenfalls betroffen** (`App.vue:2725-2737`: feste 280-px-Spalte, `overflow-y: auto`):
  dort verschwindet das vertikale Band; Außenmaße bleiben, **innere Breite und Control-Breiten
  ändern sich** — ein Root-Box-Vergleich sieht das nicht. **[UI-08]**
- Tooling: `e2e/layout-audit.ts` (`measureLayout`, `layoutChanges` nur Controls),
  `e2e/layout-fixtures.ts`, `e2e/layout.spec.ts`, `e2e/visual.spec.ts`. Keypad-Trigger:
  `e2e/touchoff.spec.ts:308-338`. Touch-Viewports setzen nur die Klasse `touch-device`, erzeugen
  keine Touch-Ereignisse (`layout-fixtures.ts:85`). **[UI-14]**

### C. Kamera clipt — `ThreeViewer.vue:629-655, :1549-1563, :3359-3376`
- Framing nur aus der Verfahrbox; `modelBounds` (`:1472`) nur fürs Bodengitter. XYZAC: Auge
  ≈ 1,17 m vom Ziel, Modell-BBox `[-770,-790,-905]..[770,1470,1190]` → Auge im Bett bei niedriger
  Elevation. Größere Basis seit 16.09. OrbitControls ohne `minDistance`/Polar-Limits.
  Reset-Tween (`:800`) interpoliert die Position linear — sichere Endpunkte ≠ sicherer Zwischenweg.
- `polygonOffset` (seit 15.09.) unverifiziert → keine Materialänderung in dieser Welle.

### D. Offset-Clear — `OffsetPanel.vue:26-32, 56-63, 72-80`
- `selectedWcs` = `onMounted`-Snapshot von `g5xLabel` (`"-"` truthy) → `Invalid target: -`.
  Rohes `send()`. Katalog-Gate `setup`, Backend `probe`. `clearSelected` liest das Ziel erst beim
  Aufruf; `MachineBtn` (`:134`) prüft beim Timerablauf nur `isDisabled` → ein Statuswechsel
  während der 500 ms lenkt den Hold auf ein anderes System um. **[UI-02]**

### E. Design-Audit
- CSS-Bug `KeyboardTab.vue:216/220` (`--hl-*` im Prozent-Slot). Keine z-index-Skala. Manuelle
  Trennlinien. Formatierer-Duplikate. Overlay-Chrome dreifach. `!important` ×2, statisches
  `style=`, unscoped `<style>`. CLAUDE.md veraltet (localStorage, Toolbar.vue).
- Linter `scripts/audit-scoped-css.py`: `template_range` endet am ERSTEN `</template>`
  (App.vue → `(1577, 1743)` statt bis 2275); CLI scannt nur `src/*.vue`. **[UI-06]**

### F. Funktionaler Bug-Hunt (★ verifiziert)
**P0**
- ★ Leertaste = Cycle Start bei fokussiertem Numpad-Root (`NumberKeypadStrip.vue:27,:106-117`;
  `useKeyboardShortcuts.ts:79-133`; Default `cycle:" "`, `buttonsEnabled:true`). Gleiche Lücke bei
  Dialogen ohne fokussiertes Element und im offenen Editor (Shortcut prüft `editing` nicht).
- ★ Escape wird beim „Taste belegen" geschluckt: `KeyboardTab.vue:68` `stopPropagation()` in
  einem Capture-Listener (`:120`), der E-Stop-Listener ist non-capture
  (`useKeyboardShortcuts.ts:174`). `mapping.estop` ist umbelegbar. **[UI-03]**
- ★ Editor: Browse/Drop beim Editieren aktiv, kein Watcher auf `activeFile`; `saveEdit`
  (`GcodePanel.vue:608-618`) liest `activeFile` vor UND nach dem HTTP-Aufruf → Puffer A nach
  Datei B. **[UI-01]**
- ★ Numpad: `mathEval.ts:13` sammelt beliebig viele Punkte, `parseFloat` nimmt den Präfix:
  `1.2.3 → 1.2`, `1..2+5 → 6`, `0..5 → 0`; `confirm` (`NumberKeypadStrip.vue:85`) reicht das ans
  Ziel (auch Offsets/Touch-off). `MachineInput` rendert Zahlenfelder als `type="text"` ohne
  min/max-Prüfung. Leeres Feld bestätigt als 0 (Kommentar `:86`). **[UI-11]**
- ★ Upload: `gateway.py:6116` publiziert mit `os.replace` — gleichnamige Datei wird ersetzt. **[UI-09]**

**P1**
- ★ „Replace table" ohne Bestätigung (`ToolTablePanel.vue:735-739`). „Discard" ohne Dirty-Check.
- ★ Gate-Mismatches: `set_wcs` (`ready` vs `probe`), `home_all` (`idle` vs `zero`),
  `set_probe_vars` (`setup` vs `ready`). „Reload Data" → `No grid file` (`gateway.py:3439`;
  Reload lädt Punkte UND Grid, `ProbePanel.vue:315`; Auto-Fetch-Watcher `:626`; App hält die
  Antworten `App.vue:1547`). **[UI-10]** `confirm_tool_change` ohne Gate (Feld heißt
  `tool_change_requested`, `App.vue:763`, `status_runtime.py:329`; Backend-Gate `armed`,
  `command_policy.py:668`). **[UI-05]** „Measure Current" mit T0 stumm. `:reason` nirgends.
- ★ Rohes `send()`: `OffsetPanel.vue:51/58/62`, `ToolTablePanel.vue:309`, `App.vue:2160/1770`,
  `useDialogState.ts:83` (Composable läuft im App-Setup → `useFire()` kann dort nicht injizieren).
- ★ Keypad-Lebenszyklus: `useNumberKeypad.ts` hält Trigger/Callback global ohne Besitzer-ID;
  `MachineInput` prüft `isDisabled` nur beim Öffnen, meldet sich beim Unmount nicht ab; Tool-
  Felder ohne `label` → „Enter value"; Placeholder fest „mm" trotz `linearUnit`. **[UI-13]**
- ○ `GcodePanel.vue:449-454` ohne `settingsVersion`-Watcher; `ToolStrip.vue:31-35` ohne
  `cmd`-Guard/`ok:false`; `KeyboardTab.vue:29` mutiert Prop in place — `structuredClone` auf dem
  Vue-Proxy wirft `DataCloneError` (Review-Probe). **[UI-04]**

**P2** — Banner-Aktionen rechts verankert (Abort rutscht); kins-Chip verschiebt WCS-Radios;
Wizard Skip↔Save Profile; Hold-Ablehnung/Busy-Drop nur in der Konsole.
**P3** — WCS-Map dreifach; Achs-Fallbacks in 5 Modulen; Zustands-Labels doppelt.

---

## Arbeitspakete

Reihenfolge **[Review „Reihenfolge"]**: **WP0 (P0-Eingabefehler + Tests) zuerst**, unabhängig von
Tokens/Linter. Danach WP1→WP2 sequenziell (Linter braucht die Tokens), WP3–WP7 unabhängig.

### WP0 — P0: Tastatur, Editor-Sitzung, Numpad-Vertrag, Upload-Vertrag

**Tastatur [UI-03]** — `useKeyboardShortcuts.ts`, `KeyboardTab.vue`, `defaults.ts`
- **Escape ist reserviert**: `estop` ist nicht umbelegbar (Keyboard-Tab zeigt „Esc" fest, ohne
  Belegen-Zelle; `mapping.estop` wird beim Laden auf `"Escape"` normalisiert). Der E-Stop-Pfad
  wird als **eigener Capture-Listener** (`window.addEventListener("keydown", onEstopKey, true)`)
  vor allem anderen registriert; `KeyboardTab.handleCapture` lässt `Escape` unverändert durch
  (kein `stopPropagation` für den reservierten Key) und bricht stattdessen das Belegen ab.
  Der `canResetEstop`-Zweig entfällt (Operator-Entscheidung: Reset nur per Button).
- **Aktivierungstasten** (Space/Enter) gehören dem fokussierten Element, sobald
  `document.activeElement` nicht `body`/`html` ist (deckt den Keypad-Root `tabindex=-1` ab);
  zusätzlich `NumberKeypadStrip.onKeydown`: Space → `preventDefault` + `stopPropagation`.
- **Modal-Guard mit konkreter Quelle**: `useModalRegistry()` (neues `src/modalRegistry.ts`):
  `registerModal(isOpen: Ref<boolean>)` in jeder Komponente mit `.dialogOverlay` (App-Dialoge,
  ToolTablePanel Edit/Import/Delete, GcodePanel RFL/Discard, ProbePanel Reset, SettingsPanel
  Reset/Macro, GamepadTab/Wizard, GcodeReferenceDialog) — `watch(isOpen)` trägt ein/aus,
  `onUnmounted` räumt ab; `modalOpen = computed(() => count > 0 || keypadState.open)`. Solange
  `modalOpen`: nur `estop` passiert (auch `abort`/Backspace nicht — ein Dialog ist kein
  Bedienplatz; Abort bleibt per Button/Banner erreichbar).
- **Cycle-Shortcut**: nur der **Start-Zweig** bekommt Gate `run` und `!editing` (Option
  `editing` aus GcodePanels `editingChange`); Pause/Resume bleiben wie heute.
- **Jog-Keyup** bleibt ungefiltert: ein während eines Jogs geöffnetes Eingabefeld darf
  `keyup → jog_stop` nicht unterdrücken (Guard nur im keydown-Pfad).
- Abgrenzung: Der Guard betrifft **globale Shortcuts**. Native Tastaturaktivierung eines per Tab
  erreichbaren Hintergrund-Buttons bei offenem Dialog bleibt (Fokus-Trap = Folge-Liste); ein
  Test dokumentiert das verbleibende Verhalten (Tab aus dem Dialog erreicht Hintergrund-Button).
- Tests `e2e/keyboard-guards.spec.ts` **[UI-07: Projekt `serial-guards`]**: Escape aus Numpad,
  Editor, jedem Dialog und während „Taste belegen" sendet genau `estop`, nie `estop_reset`;
  wiederholtes Escape sendet kein `estop_reset`; Space/Enter bei Numpad/Dialogen/Editor sendet
  nichts; Pause/Resume per Space unverändert; Jog-Start → Feld öffnen → Taste loslassen →
  `jog_stop` gesendet.

**Editor-Sitzung [UI-01]** — `GcodePanel.vue`
- `enterEdit` hält eine **Sitzung** fest: `{ id, path: props.activeFile, original: text }`.
  `saveEdit` sendet ausschließlich an `session.path`; nach `await saveFile` gilt: Reply gehört zu
  `session.id` — ist inzwischen eine neue Sitzung offen oder `activeFile !== session.path`, wird
  weder der Editor zerstört noch `loadFile` emittiert; stattdessen Meldung „Saved <name>"
  (bzw. Fehler) und die aktuelle Sitzung bleibt unberührt.
- **Externer Wechsel** (`watch(() => props.activeFile)` während `editing`): Puffer bleibt;
  ein `.warnBanner` im Editor zeigt den Konflikt („Program changed to B — you are editing A")
  mit Aktionen **Keep editing** (Sitzung bleibt an A gebunden) / **Discard** (Dirty → Rückfrage).
  Browse/Unload/Drop sind beim Editieren deaktiviert; `selectFile`/`onDrop` haben den
  `editing`-Guard; ein bereits laufender Upload, dessen `loadFile` später eintrifft, läuft in
  denselben Watcher (Konfliktbanner, kein Verlust).
- CodeMirror-Ladephase **[UI-01 R2]**: der asynchrone Import (`:545`) trägt die Sitzungs-ID.
  Nach dem Import wird der View **genau dann** erstellt, wenn `session.id` noch die aktuelle
  Sitzung ist — unabhängig von `props.activeFile`. Der Doc-Inhalt ist `session.original`, nicht
  `props.gcodeContent`. Ein EXTERNER Programmwechsel A→B während des Imports lässt Sitzung A
  gültig: der View entsteht mit A's Text, das Konfliktbanner erscheint, „Keep editing" ist
  bedienbar. Nur eine VERWORFENE oder durch eine neue ID ERSETZTE Sitzung bricht das Erstellen
  ab (der alte Import installiert dann keinen View mehr). Kein leeres Editierfenster als
  Endzustand. Test: Import per Route verzögern, A→B extern wechseln, Import freigeben → Editor
  zeigt A und ist bedienbar; nach Discard installiert der alte Import nichts.
- **Discard** mit Dirty-Check (`doc.toString() !== session.original`) → Bestätigung; sauber → sofort.
- RFL-Settings (`:449-454`): `watch(settingsVersion)`.
- Tests `e2e/editor-guards.spec.ts` (serial-guards): A bearbeiten → extern B laden → A-Puffer
  bleibt, B unverändert, Banner sichtbar; Wechsel während verzögertem Save (Route-Delay) → kein
  `loadFile` für die neue Sitzung; Wechsel während CodeMirror lädt; neue Sitzung vor Abschluss
  eines älteren Save → alte Reply ignoriert; sauberer Discard ohne Nachfrage; Dirty-Discard mit
  Abbruch; Upload mit späterem `loadFile`.

**Numpad-Vertrag [UI-11]** — `mathEval.ts`, `useNumberKeypad.ts`, `NumberKeypadStrip.vue`, `MachineInput.vue`
- Tokenizer: Zahlentoken nur `^(\d+\.?\d*|\.\d+)$`; sonst `null` (kein `parseFloat`-Präfix).
  Unit-Tests `mathEval.test.ts`: `1.2.3`, `0..5`, `1..2+5`, `1/0`, `(1+` → null; `1.2+3` → 4.2.
- **Feldvertrag** reist mit: `openKeypad({ …, constraints: { min?, max?, integer? } })`.
  `MachineInput` liest `min`/`max` aus den Attrs und ein neues explizites Prop `integer`
  (Tool-Nummer, Pocket, Flutes); `step` wird NICHT als Genauigkeit interpretiert; nichts wird
  gekürzt oder begrenzt; negative Werte bleiben erlaubt, wo kein `min ≥ 0` gesetzt ist (Z-Offset).
- **Eine zentrale Zulässigkeitsprüfung [UI-11 R2]**: `validateEntry(expr, constraints, owner)`
  → `{ value: number | null, reason?: string }` (gültiger Ausdruck, Min/Max/Ganzzahligkeit,
  gültiger Besitzer). Sie speist DREI Stellen: das Readout (Grund sichtbar), den OK-Button
  (`:disabled`) und `confirm()` selbst — `confirm()` ruft sie erneut auf und kehrt bei
  ungültigem Wert ohne Callback und ohne Schließen zurück, die Eingabe bleibt erhalten. Der
  physische Enter-Handler (`NumberKeypadStrip.vue:108`) ruft dasselbe `confirm()`; ein
  deaktivierter OK-Button ist damit nie die einzige Sperre. Besitzerverlust → Cancel-Pfad.
  Tests: Feld `min=1`, Eingabe `0` bzw. leer → Enter und Touch-OK senden nichts; Bruchteil im
  Integer-Feld ebenso; gültige Zahl geht über beide Wege.
- **Leeres Feld = 0 bleibt** (bewusst, nach „C"), wird aber sichtbar: leerer Ausdruck zeigt
  „= 0" im Readout; verletzt 0 eine Constraint (z. B. `min 1`), ist Confirm deaktiviert.
- Tests (Unit + `e2e/touchoff.spec.ts`): ungültige Ausdrücke sind nicht bestätigbar und lösen
  keinen Befehl aus; Tool-Nummer bleibt ganzzahlig/im Bereich; leeres Feld → 0 sichtbar.

**Upload-Vertrag [UI-09]** — `gateway.py`, `lcncApi.ts`, `GcodePanel.vue`
- `POST /upload?overwrite=0|1` (Default 0). Ohne Freigabe publiziert `_atomic_stream_write` per
  `os.link(tmp, dest)` (tmp liegt per `mkstemp(dir=dest_dir)` bereits im Zielverzeichnis, also
  auf demselben Dateisystem) — `FileExistsError` → HTTP 409 `{"error":"exists","filename"}`;
  atomar auch bei konkurrierenden gleichnamigen Uploads (genau einer gewinnt); danach `unlink(tmp)`.
  Mit `overwrite=1` bleibt `os.replace`. `PUT /save` (bestehende Datei) unverändert.
- **Kein Kopier-Fallback [UI-09 R2]**: unterstützt das Dateisystem `os.link` nicht (`OSError`
  mit EPERM/ENOTSUP/EXDEV/EMLINK), wird der Upload **abgelehnt** (HTTP 500 „filesystem does not
  support atomic no-replace publish"), die temporäre Datei bereinigt, `_trace.emit(
  "upload.no_replace_unsupported")`; der Zielpfad existiert zu keinem Zeitpunkt teilweise. Der
  bestehende Vertrag „LinuxCNC sieht nie eine Teil-Datei" (`gateway.py:6075`) bleibt auf beiden
  Wegen erhalten.
- Client: 409 → Dialog **Cancel / Rename / Replace** (`.dialog` + `.dialogTitle.danger`);
  Rename schickt erneut mit neuem Namen, Replace mit `overwrite=1`.
- Backend-Tests (`lcnc-gateway/test_upload_conflict.py`, neben `test_command_dispatch.py:465`):
  gleicher Name ohne Flag → 409 und Original unverändert; mit Flag → ersetzt; zwei parallele
  gleichnamige Uploads → ein 200, ein 409, Datei konsistent; **concurrent Reader** sieht vor der
  Veröffentlichung kein Ziel und danach nur den vollständigen Inhalt; `os.link` gepatcht auf
  ENOTSUP → 500, kein Ziel, kein `.part`-Rest; Fehler/Abbruch mid-write → kein Ziel. Bestehende
  Upload-/Save-Regressionen bleiben. E2E: Dialogfluss für alle drei Entscheidungen.

### WP1 — Fundament: Tokens, globale Muster, Design-Schulden (E)
Neue **globale Muster** in `style.css` (in CLAUDE.md dokumentieren): z-index-Skala
`--z-base/raised/fade/pane-overlay/float/banner/modal/modal-top` (0/1/2/5/10/11/1000/1010) mit
Ersetzung aller Literale; `.dialog.md.wide {width:760px; max-width:calc(100% - 2*var(--gap-panel))}`
(ersetzt scoped `.importDialog`-Breite, Klasse bleibt als Selektor); `.overlay-card.warn`;
`--viewcube-size: 140px` (ViewCube + `.viewerQuickGrid top: calc(gap-section + viewcube-size +
gap-tight)`); `.w-full`. Mechanisch: `KeyboardTab.vue:216/220` → `var(--hl-surface)` /
`var(--hl-surface-info)`; Trennlinien `DebugTab` → `.sep`, Zeilen-Underlines `audit-ok`;
Formatierer → `format.ts`; `!important` ×2 auflösen; unscoped Block scoped; `wcs.ts`
(`G5X_LABELS`, `g5xLabel(idx)`, `RESERVED_WCS`); `DEFAULT_AXES` in `useAxes.ts`; CLAUDE.md
(localStorage-Regel, Toolbar.vue-Zeile, neue Tiers/Tokens).

### WP2 — Linter-Härtung [UI-06] — `scripts/audit-scoped-css.py`
- **SFC-Grenzen**: `template_range` wird verschachtelungsbewusst (Zähler über `<template` /
  `</template>`, Ende beim Rückgang auf 0) — App.vue muss `(1577, 2275)` liefern.
- **`HLPCT` als Argument-Parser**, nicht Regex: `color-mix(` finden, Argumente an Kommas auf
  Klammertiefe 1 splitten, je Argument Tokens bilden; Treffer, wenn nach einem Farb-Token ein
  `var(--hl-…)` an der Prozent-Position steht. `var(--hl-*)` als Farbe (erstes Token) bleibt gültig.
- Neue Kategorien `ZINDEX`, `IMPORTANT`, `INLINE` (statisches `style="`), `TOFIXED`
  (nur `<template>`, mit korrekter Range), alle mit `audit-ok`.
- **Dauerhafte Gegenproben**: CLI-Parameter `--paths <files…>`; Fixtures unter
  `scripts/test_fixtures/audit_css/*.vue` (die zwei realen KeyboardTab-Regeln, eine gültige
  `--hl-*`-Farbnutzung, ein `toFixed` NACH einem verschachtelten `</template>`, jede Kategorie
  mit und ohne `audit-ok`); `scripts/test_audit_scoped_css.py` (pytest) asserted Treffer/
  Nicht-Treffer je Fixture und zusätzlich, dass der Scan des Produktquellcodes grün ist.
- **Im Offline-Gate verankert [UI-06 R2]**: pytest im Backend-Lauf startet in `lcnc-gateway`
  mit `testpaths = ["."]` (`pyproject.toml:9`) und entdeckt `scripts/` NICHT. Deshalb bekommt
  `scripts/test_suite.py` `offline_commands()` einen eigenen Eintrag
  `("audit-css", [python(), "-m", "pytest", str(ROOT / "scripts/test_audit_scoped_css.py")], ROOT)`
  im Backend-Komponentenlauf (Teil von WP2, keine Annahme über Discovery). Abnahme: der
  Report des gewöhnlichen `test_suite.py offline` listet `audit-css`; eine absichtlich falsche
  Fixture-Erwartung macht den Lauf rot, nach Rücknahme grün. `docs/testing.md` nennt den Eintrag.

### WP3 — Tool-Edit-Dialog (A) + Save-Ablauf [UI-12]
Template/CSS wie Fassung 1: Teleport nach `#content-dialog-area`, `.dialog.md.wide`,
`.dialogHeader` / `.dialogContent.stack-sections` / `<Gate class="dialogActions">`; zwei Spalten
(`.editFields.stack-sections` mit zwei `.stack-controls`-Abschnitten auf `.paramGrid` bzw.
`.paramGrid.twoCol`; `.editPreviewCol` mit `--preview-w` aus `PREVIEW_W`); Hinweis als volle
Zeile; `editNotice` computed. Scoped nur Layout: `.editColumns{flex-wrap:wrap}`,
`.editFields{flex:1 1 360px;min-width:0}`, `.editPreviewCol{flex:0 0 calc(var(--preview-w) +
2*var(--gap-controls))}`, `.editGrid > .full{max-width:none}`, `.editGrid > .spanRest{grid-column:2/-1}`.
**[UI-13]** Jedes Zahlenfeld bekommt `label` (Feldname) und der Dialog reicht `context`
(„T12 · Diameter · mm/in" aus `linearUnit`) durch; Placeholder „mm" → `linearUnit`.
**[UI-12] Ein Ablauf für Add/Save/Renumber mit echter Antwort-Zuordnung [UI-12 R2]**:
- **Request-ID auf dem Draht**: der Client sendet mit jedem Befehl, dessen Antwort er zuordnen
  muss, ein `req_id` (monoton, pro Tab; `send()`/`fire()` erzeugen und liefern es zurück). Das
  Gateway **echot** `req_id` auf JEDEM Antwortpfad: Erfolg/Fehler im Dispatcher
  (`gateway.py:7009`: `{"type":"reply","cmd":…, "req_id": msg.get("req_id"), **reply}`), sowie
  „Superseded by abort" / „Preempted by …" / Handler-Exception (`:7664`, `:7689`, die
  `_wcmd`-Stellen tragen das `req_id` des verdrängten Befehls) **und die Queue-Ablehnung vor dem
  Worker** („Command queue full", `:7971`, aus `msg.get("req_id")`) [R3]. `lcncWs` übernimmt es
  unverändert in `lastReply`. Backend-Test (`test_command_dispatch.py`): Echo auf ok, ok:false,
  superseded, preempted **und queue-full**; Befehle ohne `req_id` antworten ohne
  (abwärtskompatibel). **Rückgabetyp** [R3]: `send()`/`fire()` liefern `req_id: string | null`
  — `null` genau dann, wenn nichts gesendet wurde (Gate zu, Busy-Latch, verweigert); ein `null`
  erzeugt nie ein Pending. Das gilt für WP3 (Save/Delete/Renumber) und WP6 (`confirmSent`).
- Dialog: `saveSession = { id: req_id, cmd }`; `saving=true` (Buttons disabled, Felder bleiben)
  nur nach tatsächlichem Versand; Zuordnung ausschließlich `lastReply.req_id === saveSession.id`
  — `cmd` allein genügt nicht. Ein Reply mit fremdem `req_id` (Sitzung A, verzögert, während
  Sitzung B offen ist oder selbst sendet) wird ignoriert und schließt nichts. `ok` schließt und
  lädt die Tabelle; `ok:false` zeigt den Grund im Dialog, Entwurf bleibt. Solange `saving`
  gesetzt ist, ist ein zweiter Versand gesperrt (Belt-and-braces). Disconnect während `saving`
  → `saving=false`, Hinweis „outcome unknown — table reloaded", Tabelle neu laden, **kein**
  blinder Resend. Delete/Renumber identisch. Test: zwei Sitzungen, gleicher `cmd`, altes `ok`
  trifft ein, während B offen bzw. in Bearbeitung ist → B bleibt offen/pending; B's eigenes
  Reply schließt.
Tests: `tool-geometry.spec.ts` verschärfen (Gap ≥ 12 px horizontal; **gestapelte Vorschau →
vertikales Kriterium**; Notice unter beiden Spalten, ≥ 0,9 × Content-Breite; Dialog über dem
Content-Bereich); `measureLayout('.editDialog')` + `assertLayout` in **allen vier Viewports**
(Labels/Inputs/Footer ohne Clipping, erreichbar) **[Review „Tool-Dialog"]**;
`expectDialogUncovered` nach `layout-audit.ts`; Save-Ablauf: `ok:false` behält Felder,
verzögertes `ok`, Doppel-Save sendet einmal, Disconnect/verspätete Reply nach Neuöffnen;
bestehende Renumber-Tests bleiben. Visuelle Referenz `tool-edit-<viewport>.png` mit maskiertem
Canvas (Linux, nach Sichtprüfung). Manuell: Teleport + Strip-Keypad bedienen, Gate-Wechsel bei
offenem Dialog.

### WP4 — Strip invariant + Layout-Zustands-Gate (B) [UI-08]
- Landscape `.strip`: `overflow-x: scroll` (Kommentar wie Fassung 1). Portrait `.wrap > .strip`:
  `scrollbar-gutter: stable`.
- `e2e/layout-audit.ts`: `measureFrame(page)` liefert je `.strip`/`.viewerPane`/`.content` die
  Bounding-Box **und** `clientWidth`/`clientHeight` (innere nutzbare Fläche); `frameChanges`
  vergleicht beides. Zusätzlich je Keypad-Zustand `layoutChanges` auf **dauerhaft sichtbaren
  Referenzcontrols**: `.safetyStrip` (immer sichtbar) und die Besitzer-Sektion (`keypad-setup`
  → `[data-strip="setup"]`); bei `keypad-panel` nur `.safetyStrip`.
- `e2e/layout-fixtures.ts`: `StripState` (`keypad-setup | keypad-panel | gcode-keypad |
  macro-bar | banner-estop | banner-unhomed | banner-message | kins-chip`) mit
  `enterStripState`/`leaveStripState`. Makro-Bar-Ausnahme nur für `viewer.height`,
  `content.height`, `strip.y`.
- **Zwei Negativkontrollen**: Landscape `.strip{overflow-x:auto !important}` (Skip auf darwin,
  vorher `scrollWidth > clientWidth`); **Portrait** `.wrap > .strip{scrollbar-gutter:auto
  !important}` + erzwungener Überlaufwechsel (Keypad öffnen) → `clientWidth`-Änderung und
  `layoutChanges` auf `.safetyStrip` erwartet.
- Portrait-Visual-Referenzen nach Sichtprüfung erneuern.

### WP5 — Kamera-Framing (C) — Zusage begrenzt auf das Default-Framing [Review „Kamera"]
- `viewer/cameraFraming.ts` (rein): `frameDistance(maxDim, modelRadius, near) =
  max(2.345·maxDim, 1.05·modelRadius + near)`, `frameNearFar`, `minOrbitDistance(near)=near·20`;
  Unit-Tests (envelope-/modell-dominiert, monoton).
- `ThreeViewer.vue`: `_modelRadiusAbout(center)` über Nicht-Stock-Meshes **nach
  `scene.updateMatrixWorld(true)`**; `_framePose(box)` für `frameToBounds` und
  `tweenFrameToBounds` (normierte Richtung, beide Projektionen); `controls.minDistance`.
  Polarwinkel frei; `polygonOffset` unverändert.
- **Ehrliche Zusage**: Der Default-Frame (Build, erster Status, Reset-Endpunkt) startet außerhalb
  jeder Nicht-Stock-AABB für jede Orbit-Richtung bei unveränderter Distanz. Dolly, Pan, spätere
  Maschinenbewegung und der lineare Reset-Tween sind **nicht** abgedeckt — kein
  Kamerakollisionsschutz. Doku (`docs/testing.md`) sagt das so.
- Gate in `e2e/viewer.spec.ts` (serial-viewer): Bett/Säule-Fixture wie Fassung 1; Assertions
  für Default-Framing (Auge außerhalb, `|pos−target| = 1.05·R + near ± 1`, Ziel = Box-Zentrum),
  26 ViewCube-Richtungen, Presets + Reset-Endpunkt, **beide Projektionen** (`switchProjection`),
  Negativkontrolle (Distanz 1173 → innerhalb). Manuell auf dem XYZAC-Sim: Orbit von unten,
  Reset beobachten, eine zweite Maschinenpose (Tisch verfahren) → Reset erneut.

### WP6 — Offset-Clear, Gates, Hold, funktionale Bugs (D + F)
**OffsetPanel** — Selektion `pinned`/`g5xLabel`-computed (Fassung 1); Katalog `wcsClear`
/`wcsClearAll` (`probe`, `hold`); Gate `probe`; `val-slot`-Label; `useFire()` für `clear_wcs`
und `set_wcs`.
**Hold-Ziel absichern [UI-02]** — `MachineBtn` bekommt Prop `holdKey?: string`; ändert sich
`holdKey` während eines laufenden Holds → `cancelHold("target changed")` (neuer vollständiger
Hold nötig); ändert sich `isDisabled` auf `true` während des Holds → sofort abbrechen, auch wenn
es vor Ablauf wieder öffnet (Watcher, nicht nur die Prüfung beim Timerablauf). OffsetPanel setzt
`:hold-key="selectedWcs"`; Zero/Home-Buttons `:hold-key` auf ihr Ziel (Achse/WCS), wo sinnvoll.
Tests (`touchoff.spec.ts`): G54→G55 während Hold sendet nichts; Auswahl verschwindet → nichts;
Gate schließt/öffnet im Hold → nichts; Pointercancel; normaler Hold → genau ein Befehl.
**Hold verständlich [Review]** — kurzer Tap auf einen Hold-Button zeigt für ~1,5 s den
`.btnTip`-Mechanismus mit „Hold to activate"; ein Busy-Latch-Drop in `fire()` zeigt denselben
transienten Hinweis am Button („Busy — try again") statt nur `console.warn`.
**Tastatur-Config [UI-04]** — `KeyboardTab`: lokale Kopie `{ ...cfg, mapping: { ...cfg.mapping } }`
im Watcher (immediate), kein `structuredClone`; Test: Tab öffnet ohne `pageerror`, lokale
Änderung verändert die Prop nicht vor dem Emit, Server-Änderung aktualisiert die Kopie.
**Tool-Change-Bestätigung [UI-05]** — Button `:disabled="!toolChangeRequested || confirmSent"`;
`confirmSent` wird erst nach tatsächlichem Senden gesetzt (`fire()` liefert `req_id | null`; nur
eine `req_id` setzt Pending, das zugehörige Reply wird über sie zugeordnet) [R3], zurück-
gesetzt bei `tool_change_requested → false`, bei `ok:false`-Reply und bei Disconnect; Gate
`armed` (Backend), **nicht** idle/ready. Tests: echter Request bestätigt einmal; kein Request
sendet nichts; zweiter Tap bei verzögertem Status sendet nichts; Fehler erlaubt Wiederholung.
**Surface-Daten [UI-10]** — Besitzer App führt `surfaceState: { points: S, grid: S }` mit
`S = 'unknown'|'loading'|'empty'|'ready'|'error'`; `No grid file` → `grid: 'empty'`;
Transport-/Parsefehler → `'error'` mit Grund; beides wird an ProbePanel gereicht. „Reload Data"
bleibt aktiv (lädt Punkte unabhängig vom Grid), zeigt `loading`; `empty` als `.emptyState`
(„No surface map recorded yet"), `error` als `.noteWarn` mit Retry. Auto-Fetch (View-Wechsel,
`compGridVersion`, Reconnect) setzt dieselben Zustände. Tests: Erstbesuch ohne Daten → Leer-
zustand ohne Toast; erster Scan → ready; Grid fehlt, später vorhanden; beschädigte Datei →
Fehler sichtbar; Retry nach Fehler; fehlendes Grid blockiert das Nachladen der Punkte nicht.
**Numpad-Besitzer [UI-13]** — `openKeypad({ ownerId, context, canConfirm })`; `MachineInput`
generiert eine `ownerId`, meldet sich in `onUnmounted` ab (`closeKeypadIf(ownerId)` — ein für
ein anderes Feld geöffnetes Keypad bleibt), `canConfirm = () => !isDisabled.value` wird vor
`onConfirm` geprüft (sonst Cancel + Hinweis); Gate-Wechsel während der Eingabe schließt über
denselben Weg; nach Confirm/Cancel Fokus zurück an den Trigger, falls noch verbunden und
bedienbar, sonst an den Strip. Readout zeigt `context` („T12 · Diameter · mm"). Tests: Dialog
schließen bei offenem Keypad; Gate-Wechsel; zwei Felder/zwei Dialogsitzungen; Tab-Wechsel mit
verborgenem Ziel; mm/inch; kein Confirm auf ein entferntes Ziel.
**Gate-Mismatches** — `bannerHome` → `zero` und `fire(home*, 'zero')`; `set_probe_vars` →
`ready`; „Measure Current" `:disabled="!st.tool_number" reason="No tool loaded"`, stumme
`return`s → `pushMessage`; `:reason` **ergänzen, `:title` behalten** (aktive Controls behalten
ihren Aktionshinweis, `reason` gilt nur deaktiviert) an `SetupStrip.vue:206-222`,
`GcodePanel.vue:659/662`, `SpindleStrip.vue:41` **[Review „title/reason"]**.
**Rohes `send()`** — OffsetPanel/ToolTablePanel → `useFire()`; `App.vue:2160/1770` → `fire(…)`
mit `idle`/`probe`; **`useDialogState` erhält `fire` als Option** (Composable läuft im
App-Setup, `useFire()` kann dort nicht injizieren) **[Review „useDialogState"]**; Delete-Dialog
wartet auf das korrelierte `delete_tool`-Reply — Zuordnung über `req_id` wie in WP3, nicht
über `lastReply.cmd` allein [R3].
**Bestätigungen (P1)** — „Replace table"; GamepadTab „Remove Profile" (teleportiert, `dialogTarget`
von SettingsPanel); Wizard „Restart".
**ToolStrip** — `cmd`-Guard + `ok:false` → sichtbarer Fehlerzustand statt `---`.
**Layout-Stabilität (P2)** — Banner: Abort immer letztes Element; kins-Chip fester Slot;
Wizard-Buttons feste Slots (Restart immer gerendert, disabled bei 0).

### WP8 — Gemeinsame Eingabehilfe [UI-15, integriert UI-13]

**Ist-Zustand (verifiziert):** drei konkurrierende Wahrheiten — `mdiKeypadActive` (Fokus/Blur des
MDI-Felds, `App.vue:1777` + Outside-Pointer-Handler `:363`), `gcodeEditActive` × sichtbarer Tab
(`:328`), `keypadState.open` (global, `useNumberKeypad.ts:13`). Template `App.vue:2201`: ein
offenes Numpad verdrängt die G-code-Tastatur auch bei aktivem Textziel. Textzweig von
`MachineInput.vue:79` ruft keine Bildschirmtastatur (Suchfelder Tools/Referenz/Halshow,
Beschreibung, Material, Halter, Settings-Textfelder). `GcodeKeypadStrip.vue:23` bietet nur
`G M T F S` + Achsen + `I J K P R Q`, Ziffern, `.`, `-`, Space — kein `;`, `( )`, `#`, `[ ]`,
`< >`, `=`, `+ * /`, `_`, `{ }`, keine `H D L N O`. Im Touchbetrieb ist die native Tastatur bei
MDI (`App.vue:1783`) und CodeMirror (`GcodePanel.vue:565`) unterdrückt. Portrait-Strip-Spalte
außen 280 px (`App.vue:2708`).

**Sitzungsvertrag — `src/inputSession.ts` (ersetzt `useNumberKeypad.ts`; `keypadState` bleibt
als Fassade für den Zahlenteil):** genau EINE aktive Sitzung
```ts
{ ownerId, kind: 'number' | 'code' | 'text', context: string,   // „T12 · Diameter · mm"
  constraints?, page: 'code'|'abc'|'123'|'sym', shift: boolean,
  target: { insert(text), backspace(), enter(), moveCursor(±1)?, undo()?, redo()?, tab()?,
            canConfirm(): boolean, onConfirm?(v: number), onCancel?() },
  drafts: Map<ownerId, string> }   // unbestätigte Zahlenentwürfe je Besitzer, kurzlebig
```
Regeln (Review-Tabelle, alle übernommen): Feld auswählen → passendes Layout, Feldname + Einheit
sichtbar, dieses Feld ist Besitzer. Text↔Zahl → Besitzer und Layout wechseln direkt, kein alter
Modus bleibt im Hintergrund. Zahl A → Zahl B → A wird nicht übernommen, sein Entwurf bleibt bei
A (`drafts`), B startet mit eigenem Vertrag; Rückkehr zu A nimmt den Entwurf sichtbar als
Entwurf wieder auf (Readout-Präfix „draft"). Tastatur bedienen (Fokus auf ihren Tasten) ist kein
Verlassen (`pointerdown.prevent` wie heute). Verlassen (Pointerdown außerhalb von Feld + Hilfe;
der MDI-Outside-Handler wird generalisiert) oder „Schließen" → ausblenden, nichts übernehmen,
kein MDI-Send, kein Save; bloßes DOM-`blur` ist kein Schließkriterium. Besitzer entfernt
(`onUnmounted`) / Gate ungültig / Kontext ungültig → Sitzung beenden bzw. sperren, alter
Callback nie für ein neues Ziel. **Verborgenes, noch gemountetes Ziel** (Tab-Wechsel): Sitzung
wird gesperrt (Hilfe ausgeblendet, Entwurf bleibt), nicht beendet — `onUnmounted` allein genügt
nicht (Codex R2 zu UI-13); Sichtbarkeit des Ziels wird über den aktiven Tab / `v-show`-Ahnen
per `IntersectionObserver`-freiem Check (`el.offsetParent !== null`) am Besitzer geprüft, wenn
die Sitzung fortgesetzt werden soll. Bestätigungen bleiben zielabhängig: Zahl → **Übernehmen**/
gültiges Enter; MDI → **Senden**/zugeordnetes Enter; Editor → Enter = Zeilenumbruch, **Speichern**
sichert; Suchfeld → Enter löst nie MDI/Maschinenaktion aus. Escape bleibt E-Stop.
`stripVis()` und die Strip-Darstellung werden NUR aus der Sitzung abgeleitet;
`mdiKeypadActive`/`gcodeEditActive`/`keypadState.open` als getrennte Wahrheiten entfallen.
Fokus-Rückgabe nach Confirm/Cancel nur an den Besitzer, wenn er noch verbunden, sichtbar und
bedienbar ist — und nie, wenn inzwischen ein anderer Besitzer die Sitzung hat. Da Öffnen NIE an
`focus` gebunden ist (siehe Fokusbereich unten), kann eine programmatische Fokus-Rückgabe die
gerade geschlossene Hilfe nicht erneut öffnen [UI-15a].

**Fokusbereich [UI-15a]:** Feld + Aufruf-Glyph + Hilfe-Sektion bilden EINEN logischen
Eingabebereich (`data-input-area="<ownerId>"` am Feld-Wrapper und an der Hilfe-Sektion).
- **Öffnen** nur durch bewusste Handlung: `pointerup`/`click` auf das Feld (Touch: auch bei
  bereits fokussiertem Feld — der Tap nach einem Schließen öffnet wieder), `Enter`/`Space` auf dem
  Zahlenfeld (wie heute), oder das Tastatur-Glyph (ohne Touch). `focus` allein öffnet nie.
- **Fokuswechsel innerhalb** des Bereichs (Feld ↔ Hilfetasten, Tab durch die Tasten) erhält die
  Sitzung. Die Hilfetasten bleiben `pointerdown.prevent`, damit ein Tap den Feld-Fokus nicht
  nimmt; per Tab erreichte Tasten sind regulär fokussierbar.
- **Verlassen**: `focusout` am Bereich mit `relatedTarget` außerhalb (physisches Tab nach
  außen, Klick auf ein anderes fokussierbares Element) ODER `pointerdown` außerhalb (Tap auf
  nicht fokussierbare Fläche — der bisherige MDI-Outside-Handler, generalisiert) → Hilfe
  ausblenden ohne Bestätigung; Entwurf bleibt beim Besitzer. Kein pauschales `blur → close`:
  ein `focusout` mit `relatedTarget` INNERHALB des Bereichs oder `null` bei gleichzeitigem
  `pointerdown` innerhalb ist kein Verlassen.
- **Nach Confirm/Cancel/Schließen** wird der Fokus an den Besitzer zurückgegeben (falls
  zulässig) und ein Merker `session.closedByUser = ownerId` gesetzt; er hat keine Wirkung auf
  das Öffnen (das ohnehin nicht an Fokus hängt) und dient nur dem Test, dass kein Auto-Reopen
  stattfindet.
- Tests (input-session.spec): Tab nach außen blendet aus, nichts wird bestätigt; Schließen und
  dasselbe Feld erneut antippen öffnet wieder; Confirm → Fokus auf dem Trigger, Hilfe bleibt zu;
  Tab innerhalb der Hilfe (Taste → Taste → Feld) erhält die Sitzung.

**Feldinventar (Besitzer):** `MachineInput` Zahl (kind number) und Text (kind text); MDI-Feld
(kind code, Enter = Send); CodeMirror-Editor (kind code, Enter = newline, Tab, Undo/Redo,
← →); die Suchfelder in `ToolTablePanel.vue:528`, `GcodeReferenceDialog.vue:55`,
`HalshowTab.vue:134` sind bereits `MachineInput type="text"` (Gate `search`) und erhalten nur
die Besitzer-/Tastaturanbindung (kind text; Berechtigung unverändert = keine MDI-/
Maschinenfreigabe nötig) [R3]; Makrovorlage/Settings-Textfelder (kind text).
Öffnen: auf Touch-Geräten beim bewussten Tap auf das Feld (`pointerup`, nicht `focus`; native
Tastatur per `inputmode="none"` nur dort unterdrückt, wo die eigene Hilfe verfügbar ist); ohne
Touch **explizit** über ein Tastatur-Glyph am fokussierten Textfeld (**neues globales Muster**
`.inputWithAction` in `style.css`: `.inputField`-Wrapper mit nachgestelltem Icon-Button, lucide
`Keyboard`, `aria-label="Open keyboard"`). Mischbetrieb: physische Tastatur bleibt parallel
nutzbar; nie zwei Bildschirmtastaturen gleichzeitig. Der vollständige Öffnen/Schließen-Vertrag
steht unter „Fokusbereich" [UI-15a].

**Zeichenvertrag (prüfbar):** alle 95 druckbaren ASCII-Zeichen inkl. Leerzeichen für Code und
technische Textfelder; Textfelder zusätzlich `ä ö ü ß Ä Ö Ü`. Seiten (alle Ziele außer Zahl):
- **Code** (Startseite für MDI/Editor) [UI-15b]: `0–9 . -` (12) + `G M T F S` (5) +
  Achsbuchstaben aus `viewer_init.axes` (≤ 9) = ≤ 26 Zellen + `; ( ) #` = ≤ 30. Bei weniger
  als 9 Achsen füllen weitere häufige Codebuchstaben in dieser Reihenfolge die freien Zellen:
  `I J K P R Q H D L N O E`. Die Zeile `G1 X20 Y10 F1000` ist damit ohne Seitenwechsel
  eingebbar (Abnahmefall); Kommentare und Ausdrücke bleiben über 123/Sym/ABC vollständig
  erreichbar. Belegung ist eine Vorgabe der Zeichenmenge, nicht der exakten Reihenfolge.
- **ABC**: `A–Z` + `ä ö ü ß` = 30 Zellen; ⇧ (Aktionsreihe) schaltet Groß/Klein (`Ä Ö Ü`, ß bleibt).
- **123**: `0–9` + `. - + * / = ( ) [ ] < > #` = 23 Zellen.
- **Sym**: `! " $ % & ' , : ; ? @ \ ^ _ \` { | } ~` = 19 Zellen (mit 123 zusammen alle 32
  ASCII-Satzzeichen; Code dupliziert `; ( ) #` zur Bequemlichkeit). Unit-Test: Vereinigung
  aller Seiten (mit ⇧) ⊇ 95 druckbare ASCII ∪ `ä ö ü ß Ä Ö Ü`.
- **Zahl** (kind number): unverändert das Rechner-Layout mit Feldvertrag (eigenes Readout,
  passt heute in 264 px).
**Beschriftungsvertrag für 44-px-Zellen [UI-15c]** (jede Taste mit `aria-label` + `title`):
Seitenschalter `Code` · `ABC` · `123` · `#+=` (Sym; 3 Zeichen) · lucide `X` (Schließen,
`aria-label="Close keyboard"`). Aktionsreihe: lucide `ArrowBigUp` (⇧, `aria-pressed`), `Space`
(2 Zellen = 92 px), lucide `Delete` (⌫, wie heute), Enter-Taste zielabhängig: lucide
`CornerDownLeft` (Editor, „Newline"), Text `Send` (MDI), Text `OK` (Zahl). Navigationsreihe
(nur Code/Text): lucide `ArrowLeft`/`ArrowRight`, `Undo2`/`Redo2`, Text `Tab` (Editor) bzw.
`Clr` (MDI, „Clear line"). Text-Labels ≤ 4 Zeichen bei `--fs-sm` passen nachweislich in 44 px
(`Code` ≈ 28 px); längere Wörter (`Cancel`) erscheinen nur in Zellen ≥ 2 Spalten oder im
Landscape-Rail (`--key-action-w` 70 px). Cursor setzen und Auswahl ersetzen laufen über die
nativen Touch-Gesten des Ziels (CodeMirror/Input) plus `← →`; Undo/Redo aus
`@codemirror/commands` für den Editor.

**Portrait-Belegung (konkret, kleinstes unterstütztes Format = Fixture touch-portrait 900×1200,
Strip-Spalte 280 px):** innen 280 − 2×8 (Padding) − ~11 (reservierter Gutter, WP4) ≈ **253 px**.
`--key-size` 44 px + `--gap-tight` 4 px → **5 Spalten** = 236 px (6 Spalten = 284 px passen
nicht; `--touch-target-compact` 36 px gäbe 6 Spalten à 36 px, wird für Wörter NICHT gewählt).
Inhaltsseiten werden auf **immer 6 Zeilen** aufgefüllt (leere Zellen), damit Seitenwechsel die
Sektionshöhe nicht ändern: ABC 30 Zellen = 6×5 exakt; Code ≤ 30; 123 = 23; Sym = 19.
**Höhenvertrag [UI-15c]** — die Text-/Code-Hilfe hat KEINE Readout-Zeile (das Originalfeld —
MDI-Zeile, Editor, Suchfeld — bleibt sichtbar und IST das Readout; nur die Zahl-Hilfe behält
ihr Display). Portrait-Reihenfolge von oben: `.sub`-Titel (Feldname · Einheit) → Seitenschalter
→ Aktionsreihe → Navigationsreihe (Code/Text) → 6 Inhaltszeilen. Damit liegen Seitenwechsel
und Bestätigen in den ersten drei Zeilen unter dem Titel, nie hinter den Buchstaben.
Sektionshöhe Portrait = 16,5 (Titel) + 8 + 9 × 44 + 8 × 4 = **452,5 px** (Text/Code),
8 Zeilen = 404,5 px (ohne Navigationsreihe; 16,5 + 8 + 8 × 44 + 7 × 4, Codex R4). Ob die Hilfe im kleinsten Format (900 × 1200)
unter dem sticky SafetyStrip und — bei einem Zahlenfeld aus einer Strip-Sektion — der
sichtbaren Besitzer-Sektion **ohne Scrollen** erreichbar ist, wird NICHT behauptet, sondern im
`hasTouch`-Test gemessen (`bottom(.tkStrip) ≤ innerHeight` bei 100 % und beim vereinbarten Zoom
150 %); schlägt das fehl, ist die Belegung nicht abgenommen und wird überarbeitet (Kandidat:
Navigationsreihe in die Aktionsreihe falten), nie durch eine größere Strip-Breite oder eine
stillschweigende WP4-Ausnahme gelöst. Safety-Controls, aktives Feld (im Content-Bereich
rechts der Spalte) und Cursor bleiben sichtbar. Buchstabenseiten ersetzen die Tastenfläche,
nichts wird über den Zahlenblock gestapelt. Kein Umbruch per `flex-wrap`, keine kleinere
Schrift: explizites 5-Spalten-Grid (`grid-template-columns: repeat(5, var(--key-size))`, wie
`.nkGrid` im Portrait heute).
**Landscape [UI-15c]:** Budget `--strip-section-h` 264 px = Titel 16,5 + 8 + 5 × 44 + 4 × 4 =
260,5 px (Herleitung `style.css:134`) — **keine Readout-Zeile, kein zusätzlicher Kopf**. Inhalt
fließt spaltenweise in 5 Zeilen (`grid-auto-flow: column`, 30 Zellen = 6 Spalten); rechts
Aktionsrail (⇧ · ⌫ · Enter/Send über 2 Zeilen · Space; Breite `--key-action-w`), daneben
Navigationsrail (← → ↶ ↷ Tab/Clr, 5 Zeilen) und Seitenrail (Code · ABC · 123 · #+= · ✕, 5 Zeilen
à 44 px). Alles liegt innerhalb der 5 Zeilen; Breite ändert nur die Scrollweite des Strips, nie
dessen Höhe (WP4). Seitenwechsel in BEIDEN Ausrichtungen werden gegen das volle Budget geprüft
(`measureLayout('.tkStrip')`: keine `clipped-control`/`outside-panel`-Befunde je Seite).

**Komponenten:** `TextKeypadStrip.vue` (aus `GcodeKeypadStrip.vue` entwickelt; Seiten, Shift,
Aktions-/Navigations-/Seitenrails) + unverändertes `NumberKeypadStrip.vue`; beide lesen die
Sitzung. `App.vue` rendert genau eine Hilfe nach `session.kind`.

**Tests:** `e2e/input-session.spec.ts` (serial-guards): MDI/Text → Zahl → MDI/Text mit genau
einem Layout, nie ein altes Numpad vor dem Textziel; Zahl A → Zahl B (A nicht übernommen,
nicht übertragen; Rückkehr zeigt Entwurf); Tap/Tab außerhalb und Schließen ohne Maschinen-/
Save-/MDI-Aktion; Bedienung der Tasten schließt nicht; Editor → Zahl → Editor mit erhaltenem
Puffer; Wechsel + Confirm gibt Fokus nicht ans alte Ziel; entfernte Besitzer/ungültige Gates
gesperrt; verborgenes gemountetes Ziel gesperrt, nicht beendet; Suche im Dialog bedient die
Hilfe ohne Outside-Close; Eingabe von `; ( ... )`, `#<tiefe> = [1 + 2]`, `G0 Z{depth} F{feed}`
und einer Beschreibung mit Umlaut **nur per Touch** (Fixture-Text, kein Programmlauf), danach
Korrektur mitten im Text; Zeichenvertrag als Unit-Test über die Seitendefinitionen (Menge
der erreichbaren Zeichen ⊇ druckbares ASCII + Umlaute); Seitenwechsel bei markierter Auswahl
erhält sie; Portrait-Seiten mit `hasTouch` (Tastenmaß ≥ 44, kein horizontaler Überlauf, kein
abgeschnittenes Zeichen — `measureLayout` auf `.stripSection.tkStrip`), beide Themes, Zoom;
WP4 misst weiterhin innere Breiten/Referenzcontrols bei jedem Seitenwechsel; Escape und
Jog-Keyup wie vereinbart.

### WP7 — Touch-Interaktionstest [UI-14] + Doku
- `e2e/touch-hold.spec.ts` (serial-guards) mit `browser.newContext({ hasTouch: true })`,
  Ereignisse über `page.touchscreen.tap` und CDP `Input.dispatchTouchEvent` (touchStart/Move/
  End/Cancel): kurzer Tap → kein Befehl (+ Hinweis sichtbar); vollständiger Hold → genau ein
  Befehl; Wegziehen > Slop / Scrollbeginn / `pointercancel` → Abbruch; erneuter Hold beginnt bei
  null; Fokus-/Sichtbarkeitsverlust während eines Holds (`visibilitychange`) → kein
  nachgeholter Timer; im teleportierten Tool-Dialog: Formular scrollen, Zahlenfeld öffnen,
  Strip-Numpad bestätigen, Save/Cancel erreichbar. Keine Verdopplung der Layout-Matrix.
- Physische Touchscreen-Abnahme bleibt gesondert (gate-t `main`, nicht diese Welle).
- `docs/testing.md`: Abschnitte „Frame/strip states", „Guard specs", „Touch hold", „Camera gate
  (Default-Framing only)". `docs/decisions.md` 2026-09-20: Escape reserviert + Reset nur per
  Button; Strip-Band reserviert; Kamera-Kugelregel (Scope); Clear-Hold mit Zielbindung;
  Upload-Nicht-Ersetzen-Vertrag; Numpad-Feldvertrag; leer = 0 sichtbar.

---

## Playwright-Projektkette [UI-07]
Neues Projekt `serial-guards` mit EINEM gemeinsamen Filter für alle vier Guard-Specs [UI-15d]:
`const guardSpecs = /(keyboard-guards|editor-guards|touch-hold|input-session)\.spec\.ts/;`
→ `testMatch: guardSpecs`, `fullyParallel: false`, `workers: 1`, `dependencies:
["serial-touchoff"]`; `serial-layout` hängt danach an `serial-guards`; dieselbe Konstante
`guardSpecs` steht im `testIgnore` des `chromium`-Projekts (Muster `toolSpecs`). Abnahme:
`npx playwright test --list` zeigt jede der vier Dateien genau einmal und nur unter `serial-guards`.
Jeder Fall setzt seine Vorbedingungen explizit (`ctl reset` + eigener Status-Envelope). Abnahme:
Specs bestehen einzeln UND im vollständigen `npm run test:e2e` (ein grüner Einzellauf belegt
keine Isolation).

## Reihenfolge & Verifikation

| Schritt | Umfang | Verifikation |
|---|---|---|
| 0 | WP0 (Tastatur, Editor, Numpad, Upload) | `npm run build`, `npm run lint`, `npx vitest run` (mathEval), `npx playwright test --project=serial-guards`, `cd lcnc-gateway && pytest test_upload_conflict.py` |
| 1 | WP1 Tokens/Muster/Schulden | build, lint, vitest |
| 2 | WP2 Linter + Fixtures | `pytest scripts/test_audit_scoped_css.py`, `npm run lint:css` grün |
| 3 | WP3 Dialog + Save-Ablauf | build, `--project=serial-tools`, `npm run test:visual` (neue Refs nach Sichtprüfung) |
| 4 | WP4 Strip + Envelope-Gate | `npm run test:layout` (Block + beide Negativkontrollen), `npm run test:visual` (Portrait-Refs) |
| 5 | WP5 Kamera | vitest `cameraFraming`, `npx playwright test e2e/viewer.spec.ts` |
| 6 | WP6 Offsets/Hold/Gates/Surface/Keypad | `--project=serial-touchoff`, `--project=serial-tools` |
| 7 | WP7 Touch + Doku | `--project=serial-guards` |
| 8 | WP8 Eingabehilfe (nach WP0 und WP6 „Numpad-Besitzer") | build, vitest (Zeichenvertrag), `--project=serial-guards` (input-session), `npm run test:layout` (Seitenwechsel), `npm run test:visual` (neue Refs Portrait-Seiten nach Sichtprüfung) |
| final | alles | `npm run build && npm run lint && npm run lint:css && npx vitest run && npm run test:e2e`; `python3 scripts/test_suite.py offline` (Report enthält `audit-css`) |

`input-session.spec.ts` läuft unter `serial-guards` (Filter `guardSpecs`, siehe Projektkette).

Alle schweren Gates erst nach Suite-Stopp. Danach Live-Sichtprüfung auf dem XYZAC-Sim (Kamera
von unten + Reset + zweite Pose; Numpad; Tool-Dialog mit FreeCAD-Tool inkl. Keypad; Offset-Clear
per Hold mit WCS-Wechsel währenddessen; Leertaste/Escape bei offenem Numpad) und
**Stichproben [Review]**: Dark-/High-Contrast-Darstellung, lange Werkzeugbeschreibung, Browser-
Zoom 150 %; Dialogöffnung/Scrollen/Kamera-Reset vorher/nachher unter derselben Last — ohne neue
Millisekunden-Grenzen.

## Risiken
- Escape als Capture-Listener: er muss vor dem KeyboardTab-Capture-Listener registriert sein
  (App-Setup vor Kind-Mount — gegeben) und darf nichts außer `estop` tun.
- Modal-Registry: eine vergessene Registrierung = Guard-Lücke → der Guard-Spec listet jeden
  `.dialogOverlay` per DOM-Scan und vergleicht mit der Registry-Zählung (Selbsttest).
- `os.link` setzt ein Dateisystem mit Hardlinks voraus (ext4/xfs ja; FAT/manche NFS nein) →
  **kein** Kopier-Fallback (er würde eine Teil-Datei sichtbar machen): Upload wird abgelehnt,
  Temp bereinigt, Trace-Event; Test deckt den Ablehnungspfad.
- WP8 ist die größte Einzeländerung der Welle (Sitzungsmodell + neue Tastatur + Feldinventar).
  Sie läuft NACH WP0/WP6, damit Feldvertrag und Besitzerregeln stehen. Die Portrait-Belegung ist
  vor der Implementierung als Maßskizze im Plan (oben) und wird per `hasTouch`-Test und
  Sichtprüfung im kleinsten Format abgenommen — „passt“ wird nicht aus `flex-wrap` gefolgert.
- `holdKey` auf Zero/Home: Ziel ändert sich dort praktisch nie während 500 ms; harmlos.
- Kamera: Zusage ausdrücklich nur Default-Framing.
- Teleport/Keypad/Gate-Kaskade und E2E-Selektoren wie Fassung 1.

## Folge-Liste (bewusst nicht in dieser Welle)
- Fokus-Trap/Autofokus in Dialogen (Escape bleibt E-Stop, kein Escape-Close).
- Größen-Token-Skala (85 Magic-px); `color-mix()`-Prozent-Sprawl.
- Hold-Buttons per Tastatur (bewusst tot, dokumentiert).
- Physische Touchscreen-Abnahme (gate-t `main`).

---

<a id="fassung-4--abschluss"></a>

## Fassung 4 — Abschluss · 21. September 2026 (Codex-Implementierungsrunde 4 + UX-01–13)

**21. September 2026 · Branch `feat/ui-review-wave` (Basis `development`, Merge nach `development`,
nie `main`).** Fassung 3 (WP0–WP8) ist umgesetzt und in drei Codex-Runden geprüft; Stand
`9b368f7`: 9 von 11 technischen Befunden geschlossen. Diese Fassung schließt den Rest.

### Kontext

Codex-Implementierungsrunde 4 (`docs/reviews/ui-optimierungen.implementation-review.md`,
Abschnitt „Codex · Implementierungsrunde 4“) lässt zwei technische Befunde offen und der
UX-Nachtrag (`docs/reviews/ui-optimierungen.review.md`, UX-01–UX-13 mit „Konkrete
Codex-Empfehlungen“) wartet auf Operator-Entscheidungen:

- **UI-I10 (P1, Rest):** Text-Tastatur-X per Tab + Enter/Space schließt korrekt, aber der
  fokussierte Button wird entfernt, Fokus fällt auf `body`, der Modal-Guard fällt mit der
  Sitzung → nächstes Space sendet `cycle_start` (6/6 Proben). Ursache: `closeTextSession()`
  (`inputSession.ts:171`) hat keine Fokusbehandlung; die Textsitzung kennt kein Zielelement
  (`TextTarget` = nur Funktionen), also kann sie `returnFocusTo` nicht aufrufen. Zusatzfalle: das
  MDI-Feld sendet auf `@keyup.enter` (`App.vue:1873`) — ein Enter-Keydown auf dem X würde nach
  einer Fokus-Rückgabe als Keyup im Feld landen und `mdi` senden.
- **UI-I11 (P2, neu):** Physisches Tippen ins MDI-Feld wird Zeichen für Zeichen gelöscht (3/3).
  Ursache: MDI ist der einzige Textaufrufer mit `:value="mdiText"` + `@input` statt `v-model`
  (`App.vue:1869`), während `MachineInput`s Textzweig (`MachineInput.vue:223-238`) zusätzlich
  `v-model="model"` trägt — zwei Schreiber auf ein Feld: `useModel` läuft lokal (Emit geht ins
  Leere), `vModelText.mounted` setzt `el.value = ""`, `patchProps` setzt `value` aus den Attrs bei
  jedem Patch neu. Der Zahlenzweig ist bewusst ein-schreibig (`:value="keypadDisplayValue"`).
- **UX-13:** MDI wird vom Operator als Passwortfeld wahrgenommen (Firefox auf dem Mac, Apple-
  Passwortmanager). Kein Textfeld setzt `autocomplete`/`spellcheck`/`autocapitalize`/`name`;
  1 von 14 Textfeldern hat eine verdrahtete Beschriftung, 0 von 14 ein `aria-label`.
- **UX-01–12:** Aktions-/Beschriftungsvertrag; Codex hat je Punkt eine konkrete Empfehlung.

**Operator-Entscheidungen (21.09.2026):** alles in einer Welle · Numpad bekommt **X + Discard**
(Codex UX-01) · Arm/Power zeigen die **nächste Aktion** (UX-10) · UX-13-Abnahme in **Firefox/macOS
mit dem Apple-Passwortmanager (iCloud-Passwörter-Erweiterung)**.

**Rahmen (unverändert):** Suite darf nicht live sein für Build/Vitest/Playwright — prüfen mit
`pgrep -af "[h]al_watchdog"` (nie plain `pgrep -f`). Playwright bedient den **gebauten** dist
(`npm run build` vor e2e), nie zwei Playwright-Läufe parallel. Pre-Flight-Checkliste aus CLAUDE.md
für jede `.vue`/`.css`-Änderung (Tokens, keine `:deep()`-Visuals, MachineBtn-Katalog,
Single-Root). Commits enden mit `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Arbeitspakete (Reihenfolge = Commit-Reihenfolge, je WP ein Commit + Gates)

#### WP-A — Technische Restbefunde: UI-I10-Rest, UI-I11, UX-13-Feldvertrag

**A1 · UI-I10: Explizites Schließen der Text-Hilfe gibt den Fokus geschützt zurück**
(`lcnc-webui/src/inputSession.ts`, `TextKeypadStrip.vue`, `MachineInput.vue`, `App.vue`,
`GcodePanel.vue`, `useMdiHistory.ts`)

- Die Elementquelle gehört auf den **Besitzervertrag**: `TextTarget` (`inputSession.ts:37-53`,
  neben `isVisible()`/`canConfirm()`) bekommt `focusEl?(): HTMLElement | null` — kein neues
  Sitzungsfeld. Besitzer liefern sie: `MachineInput.textTarget()` → `() => textEl.value`;
  MDI (`App.vue` `mdiTarget()`) → `_mdiInputEl`; Editor (`GcodePanel.vue` `editorTarget()`)
  → `() => _editorView?.contentDOM ?? null` (das `contenteditable`, das `EditorView.focus()`
  selbst fokussiert; in-flow, also `offsetParent` gesetzt, `:disabled` trifft nie).
- Neue Funktion `closeTextSessionByOperator(reason)`: `el = inputSession.target?.focusEl?.()`
  VOR `endText()` sichern (das nullt `target`), `closedByUser` setzen wie
  `closeTextSession(reason, true)`, dann `returnFocusTo(el)` (bestehender bewachter Übergang:
  fokussiert sofort, `focusReturn.pending` hält `helperOpen`/`modalOpen`, rAF-Polling,
  `.strip`-Fallback, 2 s Backstop). Einziger Aufrufer: das X der Text-Tastatur
  (`TextKeypadStrip.vue:101`). Der Enter=„Done“-Pfad von `MachineInput.enter()` (`:127`, heute
  unbewachtes `textEl.focus()`) wird lokal `const el = textEl.value; if (closeTextSessionIf(ownerId,
  'done')) returnFocusTo(el);` — `returnFocusTo` ist bereits exportiert.
  Beim Pointer-Schließen liegt der Fokus bereits auf dem Feld (`pointerdown.prevent`) →
  `target.focus()` auf dem aktiven Element ist ein No-op, der erste rAF-Tick beendet `pending`;
  die 300-ms-Wartezeit in `input-session.spec.ts:298-300` deckt den einen Frame ab. Das
  synchrone `focusin` erreicht `onDocFocusIn` erst nach `endText()` (kind = null) → No-op.
- Verlassen-Pfade bleiben ohne Refokus (Outside-Pointerdown `:258`, Focusin außerhalb `:268`,
  Besitzerwechsel `:158`, Numpad übernimmt `:195`, Gate-Ende/Unmount `closeTextSessionIf`) —
  ein pauschales Refokussieren würde bewusst gewählten Fokus zurückstehlen (Codex).
- **Enter-Keyup-Falle (zwingend, nicht optional):** MDI sendet künftig auf **Keydown**
  (`onMdiKeydown` in `useMdiHistory.ts:69`: `if (e.key === "Enter") { if (e.repeat ||
  e.isComposing || e.keyCode === 229) return; e.preventDefault(); handleMdiSend(); return; }`);
  `@keyup.enter` (`App.vue:1873`) entfällt. Der IME-Guard ist der einzige plausible Grund, warum
  Send bisher auf Keyup lag (ein IME-Enter bestätigt die Komposition auf Keydown). Enter-Keydown
  auf dem X löst dessen `click` aus (Button-Aktivierung auf Keydown), das Keyup landet danach im
  MDI-Feld ohne Handler; Space aktiviert auf Keyup und hat kein Folgeereignis. Andere
  `@keyup`-Listener gibt es in `src/` nicht (nur das Jog-Keyup am Window). Ohne diesen Schritt
  würde der bestehende Fall `keyboard-guards.spec.ts:212-219` (Enter auf „Close keyboard“ →
  `expectNoMachineAction`, `mdi` zählt als Maschinenbefehl) nach A1 rot — er besteht heute nur,
  weil der Fokus auf `body` fällt. Ein „ein Keyup schlucken“ im globalen Listener ist verworfen.

**A2 · UI-I11: Das MDI-Feld hat genau einen Schreiber** (`App.vue`, `MachineInput.vue`)

- `App.vue:1864-1876`: MDI-`MachineInput` auf `v-model="mdiText"` (der Vertrag jedes anderen
  Textaufrufers); `:value`/`@input` entfallen, `@keydown="onMdiKeydown"` bleibt. `mdiTarget()`
  (Insert/Backspace/Clear mit Caret-Restore) und die Verlaufsnavigation schreiben weiter direkt
  in `mdiText` — mit `v-model` ist das der eine Weg ins DOM.
- Härtung in `MachineInput` (die Falle darf nicht wiederkommen): der Textzweig wird
  **attrs-first, ein Schreiber** wie der Zahlenzweig — `v-model="model"` entfällt,
  `:value="textValue"` mit `textValue = attrs.value !== undefined ? attrs.value : (model.value ?? '')`
  (dasselbe Muster wie `keypadDisplayValue`), `@input="onNativeInput"` setzt `model.value =
  el.value` (emittiert `update:modelValue` für `v-model`-Aufrufer; ein `:value`+`@input`-Aufrufer
  bekommt sein `attrs.onInput` weiterhin nativ über `v-bind="attrs"` — `mergeProps` reiht beide
  Handler). `fireInput()` (Bildschirmtasten) bleibt. `v-model`-Aufrufer (`modelValue` → `model` →
  `textValue`; native Eingabe → `model.value = …` → `update:modelValue`) brechen nicht; kein
  Textaufrufer nutzt `.trim`/`.lazy`. Caret: `patchDOMProp` schreibt `el.value` nur bei
  Abweichung — der Aufrufer spiegelt denselben String, also keine Zuweisung, kein Caret-Sprung.
  IME/Composition: Write-through ohne Composing-Flag — `model` wird bei jedem `input`-Ereignis
  aktualisiert (auch während der Komposition), damit ist `:value` stets gleich `el.value`; ein
  Guard, der Model-Schreibvorgänge während der Komposition ÜBERSPRINGT, wäre schlechter (das
  Modell veraltet, ein fremder Patch überschreibt die Komposition).
- Commit-Text nennt die **Topologie** (zwei Schreiber: lokales `model` via `vModelText` und
  `attrs.value` via `patchProps`), nicht eine bestimmte Verschachtelung — die verlierende
  Reihenfolge ließ sich statisch nicht festnageln; der neue Regressionstest ist der Schiedsrichter.

**A3 · UX-13: Feldvertrag für Textfelder** (`MachineInput.vue`, 14 Aufrufstellen)

- `MachineInput` Textzweig setzt Vorgaben, die ein Aufrufer per Attribut überschreiben kann:
  `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`
  (alle 14 Felder sind technisch: G-code, HAL-Pfade, Dateinamen, Suchbegriffe, kurze
  Werkzeug-/Makro-Bezeichner — keine Prosa-Ausnahme nötig), `:name="attrs.name ?? gate"` (stabile
  fachliche Kennung = INPUT_DEFS-Schlüssel, z. B. `mdiText`, `search`, `toolEdit`),
  `:aria-label="attrs['aria-label'] ?? label"` (der `label`-Prop erreicht heute nur das
  Helfer-Heading, nie das DOM).
- Beschriftungen verdrahten (Hausmuster `ToolTablePanel.vue:702-703` `for`/`id`): Werkzeug-
  Editor Description/Material/Holder, Makro-Editor Name/Command/Param-Label/-Default (`<span
  class="inputLabel">` → `<label for>`), Makro-Ausführung (`App.vue:2126`). Ohne sichtbares Label
  (MDI, drei Suchfelder, Spindle-Load-Pin) trägt der `label`-Prop den Namen („MDI command“,
  „Search G-code reference“, „Search tools“, „Search HAL“, „Spindle load HAL pin“).
- Kein erweiterungsspezifisches Attribut (`data-1p-ignore` gilt nur für 1Password). Die
  Passwort-Erkennung ist damit nicht bewiesen beseitigt: **Abnahme durch den Operator** in
  Firefox/macOS mit der iCloud-Passwörter-Erweiterung an und aus sowie in einem frischen
  Profil (MDI, Suchen, Werkzeug-/Makro-Felder: kein Vorschlag/Speicherangebot, physisches Tippen
  und Bildschirmtasten, kein Maschinenbefehl durch Auswahl/Ausblenden eines Vorschlags).

**Tests A** (regulär, `serial-guards`; Tasten immer per echtem `click`/`tap`/Tastendruck):

- `e2e/keyboard-guards.spec.ts` (neuer Fall nach Zeile 220): MDI + `G1` per Bildschirmtasten →
  X fokussieren wie die bestehenden Fälle (`tk.getByRole(… 'Close keyboard').focus()`, Zeilen
  212/283 — oder erste Hilfetaste fokussieren und per Tab zum X wie Codex' Probe; ein echtes Tab
  aus dem FELD landet auf dem Send-Button außerhalb des Bereichs und schließt die Sitzung als
  Verlassen) → **Enter** bzw. **Space** → Hilfe weg, Wert `G1`, **MDI fokussiert**,
  `expect.poll(__modalRegistry.open)` false, kein `mdi`/`cycle_start`; nächstes Space tippt
  (`G1 `). Dasselbe für die „Done“-Taste der Referenzsuche und das X im Editor (Fokus auf
  `.cm-content`, Puffer intakt, kein Start).
- `e2e/input-session.spec.ts`: **physisches** `page.keyboard.type("G1 X7")` ins MDI-Feld mit
  offener Hilfe → erhalten; `Close keyboard` per Klick → weiterhin `G1 X7`, fokussiert; ` F1`
  tippen; Enter → genau ein `mdi` mit `text: "G1 X7 F1"` (`sentCmds()`), Feld leer; ArrowUp holt
  es zurück; Hilfe wieder öffnen, Bildschirmtasten hängen an. Bestehende Pointer-/Tap-Schließfälle
  (`:292-301`, `:513/607/679`) bleiben grün (Fokus-No-op); der bestehende Enter-auf-Close-Fall
  (`keyboard-guards.spec.ts:157-220`) besteht nur mit A1 **und** dem Keydown-Umbau zusammen.
- Feldvertrag: ein Fall scannt in MDI-Tab, Referenzdialog, Werkzeug-Editor, Makro-Editor jedes
  sichtbare `input.inputField:not([readonly])`: `autocomplete=off`, `spellcheck=false`,
  `autocapitalize=off`, `name` nicht leer, `toHaveAccessibleName(/\S/)`.
- Kein Komponententest: `@vue/test-utils`/jsdom fehlen (`vitest.config.ts` ist `environment:
  "node"`, kein `src/*.test.ts` mountet eine Komponente) — e2e-only; eine DOM-Umgebung für Vitest
  ist eine eigene Entscheidung (Folge-Liste).

---

#### WP-B — Aktionsvertrag (UX-01–UX-06)

**B1 · Numpad und Text-Tastatur: Schließen ≠ Verwerfen** (`NumberKeypadStrip.vue`,
`TextKeypadStrip.vue`, `machineControls.ts`)

- Numpad bekommt **X „Close keyboard“** (lucide `X`, wie die Text-Tastatur): `closeKeypad(true)`
  (Entwurf bleibt, `useNumberKeypad.ts:112`) + `returnFocusTo(trigger)`. **`Cancel` → `Discard`**
  (Entwurf verwerfen + schließen + Fokus zurück = heutiges `cancel()`).
  Layout ohne neue Zeile (264-px-Budget, Reserve ≈ 12 px): Landscape Spalte 6 = X · Discard ·
  ═ · Apply (Apply 1 Zeile statt 2); Portrait Zeile 5 = X (1) · Discard (2) · ═ (1) · Apply (1).
  `.nkKey` bekommt wie `.tkKey` `padding-left/right: 0` (sonst bleiben in 44 px nur 16 px Text).
- **UX-04 Bestätigen nach Wirkung:** Numpad `OK` → **`Apply`** (13 px ≈ 37 px, passt in 44 px);
  Textfeld-Enter sichtbar **`Done`** (aria/title sagen es schon, `input-session.spec.ts:326`
  bedient „Done“); MDI `Send` / Editor ↵ „New line“ unverändert.
- **UX-03 gleiche Symbole, Namen, Farben:** Numpad `⌫` → lucide `Delete` + „Backspace“; `C` →
  **`Clr`** neutral (Katalog `numClr` Variante `default`; das Leeren des unbestätigten Ausdrucks
  ist keine Gefahr) + aria „Clear entry“; alle Numpad-Tasten bekommen `aria-label`/`title`
  („Divide“, „Multiply“, „Minus“, „Plus“, „Negate“, „Evaluate“, „Open/Close parenthesis“; Ziffern
  bleiben ihr Zeichen). Text-Tastatur: `Clr` behält aria „Clear line“ (Label-in-Name erfüllt).
- Tests: `keyboard-guards.spec.ts:125,168`, `touch-hold.spec.ts:147-148`, `layout-fixtures.ts:135`
  (`Cancel` → `Discard`); `keyboard-guards` ×2, `touchoff` ×2, `touch-hold` ×1 (`OK` → `Apply`);
  `touchoff.spec.ts:566,604,610` (`C` → `Clr`). Neue Fälle: Numpad X per Tap und per Tab+Enter →
  Hilfe zu, Entwurf beim Wiederöffnen markiert, Fokus am Feld, kein Befehl; Discard → kein
  Entwurf. Layout-Gate (`layoutChanges`/`clipped-label`) für beide Ausrichtungen.

**B2 · UX-05 Schließen als benanntes Control** (17 `type="close"`-Stellen in 11 Dateien)

- Jede Stelle: lucide `X` statt `&times;` und ein **kontextbezogenes `aria-label`** („Close program
  stats“, „Close settings“, „Close messages“, „Close reference“, „Close run-from-line“, „Close
  tool editor“, „Close import preview“, „Dismiss upload error“, „Dismiss import result“, „Close
  tab“ (TabPanel), „Close camera“); `title` gleichlautend.
- **Dauerhafte Prüfung:** `scripts/audit-scoped-css.py` bekommt die Template-Kategorie `CLOSE`
  (ein `<MachineBtn type="close"` ohne `aria-label`), Fixture unter
  `scripts/test_fixtures/audit_css/`, Fall in `scripts/test_audit_scoped_css.py` → läuft im
  Offline-Gate (`audit-css`).
- `e2e/keyboard-guards.spec.ts:294` (`/^(Cancel|×)$/`) → `/^(Cancel|Close .*)$/`. Visuelle
  Referenzen: nur `tool-edit-*.png` (4) enthalten ein X → nach Sichtprüfung erneuern.

**B3 · UX-02 X nur zum Schließen**

- `KeyboardTab.vue:169/181/202`: Belegung entfernen = lucide `Trash2`, aria/title „Remove binding
  for <Aktion>“ (Katalogtyp `listAction`), Wirkung unverändert (sofort + speichern).
- `SettingsPanel.vue:624`: Sonderfarbe zurücksetzen = lucide `RotateCcw` (bereits importiert in
  SpindleStrip), aria/title „Reset color for <Teil>“.
- `ToolTablePanel.vue:654/757`: Header-X und Footer-Cancel laufen über **eine** Prüfung: unverändert
  → schließen; geändert (Snapshot beim Öffnen vs. `editForm`) → Dialog „Discard changes?“ mit
  **Keep editing / Discard** (Muster `GcodePanel.vue:957-967`, `registerModal`). Import-Vorschau-X
  und RFL-Dialog-X haben keinen Entwurf → direkt.
- Tests: `tool-geometry`/`example-tool-library`-Specs mit Cancel bleiben; neu: Feld ändern → X →
  Dialog, Keep editing behält Werte; unverändert → X schließt direkt.

**B4 · UX-06 Ziel von Reset/Clear nennen**

- `ThreeViewer.vue:3946-3947`: sichtbar `Reset`/`Clear` (68-px-Zellen), aria/title **„Reset
  view“** / **„Clear backplot“**. `OverridesStrip.vue:42/48/54`: sichtbar **`100 %`**, aria
  „Reset feed/spindle/rapid override to 100 %“. `App.vue:1879` MDI-Verlauf: aria „Clear MDI
  history“, Katalogtyp `inlineMd` statt `dialogCancel`. `SafetyStrip.vue:115`: im Reset-Zustand
  aria/title „Reset E-Stop“ (sichtbar bleibt `Reset`, Breite unverändert). Settings-Resets sind
  bereits benannt.

---

#### WP-C — Zustand und Speichern (UX-08, UX-10)

**C1 · UX-10 Arm und Machine Power beschriften die nächste Aktion** (`SafetyStrip.vue`)

- Arm: `stable-width`-Paar **`Arm` / `Disarm`** (statt `Armed`/`Arm`); der Trip-Fall wird
  `reason="Acknowledge the safety trip first"` statt `title`. Power: **`Power on` / `Power off`**
  (statt `On`/`Off`). Zustand bleibt sichtbar: grüne Variante, Header-Pill `armed/disarmed`,
  Statuszeilen (Enabled TRUE/FALSE). E-Stop/Reset ist bereits dieses Muster.
- `e2e/smoke.spec.ts:26` → `getByRole("button", { name: "Arm", exact: true })`.
  Breite neu messen: `input-session` Portrait (`.safetyBtns button` im Viewport bei 100 % und
  150 %), `layout.spec` Frame-Zustände, `clipped-label` auf `.safetyBtn`. Safety ist in den
  visuellen Referenzen maskiert (0 PNGs). Fallback bei Überlauf: `Power` mit aria „Power off“.

**C2 · UX-08 Speichern pro Bereich erklären** (`SettingsPanel.vue`, `defaults.ts`, `lcncWs.ts`)

- Kopfzeile: „Settings are saved automatically…“ → „Changes save automatically“ + **Speicherstatus**;
  Makro-Editor bekommt eigenen Hinweis „Unsaved edit — Save or Cancel“; der Gamepad-Wizard hat
  bereits `Save Profile`.
- Ehrlicher Status statt fire-and-forget: `defaults.ts` führt `saveStatus` (`idle | pending |
  saving | saved | error | blocked`); `saveSection` setzt `pending`; der Saver liefert das `req_id`
  von `send()` zurück (`lcncWs.saveSettings`), `lastReply` mit passendem `req_id` → `saved` /
  `error` (Grund); `!serverSettingsReady` → `blocked` „Not saved — waiting for server settings“
  (heute stiller Drop, verletzt „no silent fallbacks“); `send() === null` → `error` „Not connected“.
  Anzeige im Settings-Kopf als Text (`--ok`/`--danger` über bestehende Farbtokens; **neues
  globales Muster `.saveStatus` in `style.css`**, in CLAUDE.md dokumentieren).
- Tests: Vitest für den Zustandsautomaten (pur); e2e: Viewer-Einstellung ändern → „Saving…“ →
  Mock-Reply ok → „Saved“; Reply `ok:false` → „Save failed: …“; vor `settings_init` → blocked-Text.

---

#### WP-D — Erklärungen erreichbar (UX-09, UX-11)

**D1 · UX-09 Sperrgrund für alle Controls** (`permissions.ts`, `MachineBtn.vue`, `MachineToggle.vue`,
`MachineRadio.vue`, `MachineInput.vue`, `MachineSelect.vue`, `MachineSlider.vue`, `JogStrip.vue`,
`SetupStrip.vue`)

- `useGateExplain(gate, disabled, reason?)` in `permissions.ts`: die Logik aus `MachineBtn.vue:63-90`
  (Grund aus `usePermissionReasons()` bzw. Prop, nur wenn armed, `explain()` → Message-Center,
  `explainLabel`, `explainKeydown`) als Composable; `MachineBtn` nutzt es ohne Verhaltensänderung.
- Label-verwurzelte Controls (`MachineToggle` und das Plane-Radio-Label in `JogStrip` — **Korrektur
  nach Codex-Runde 5, 22.09.2026:** `MachineRadio` selbst ist ein Input-Root, siehe nächster Punkt): während
  gesperrt + Grund + armed trägt das Wurzel-`<label>` `title`, `tabindex="0"`, `role="button"`, `aria-label="Why is this
  unavailable? …"`, Click/Keydown → `explain` (genau das, was `JogStrip.vue:473-475` und
  `SetupStrip.vue:238` heute von Hand tun → durch das Composable ersetzen).
- Input-verwurzelte Controls (`MachineInput`, `MachineSelect`, `MachineSlider`, `MachineRadio`) **bleiben
  Single-Root** (ein Wrapper zöge `.mdiInput`/`input.setupInput` aufs Span): sie tragen `title`
  und `@pointerdown="explain"` — Chromium ≥ 116 und Firefox ≥ 105 stellen Pointer-Ereignisse an
  gesperrten Controls zu (die beiden Operator-Browser; Safari im Test-Doku als ungeprüft
  vermerkt). Ein gesperrtes Feld ist per Tastatur nicht erreichbar; das ist die dokumentierte
  Grenze (der Abschnitts-Gate und die Buttons erklären denselben Grund). **UX-09 ist damit teilweise
  erfüllt** (Codex-Runde 5): Touch und Tastatur für Buttons und Label-Roots, nur Pointer + Titel für
  gesperrte Input-Roots; das ursprünglich empfohlene fokussierbare Info-Control direkt am gesperrten
  Feld ist nicht umgesetzt (Folge-Liste).
- Tests: MDI-Feld gesperrt (`ready:false`, armed) → Tap zeigt den Grund im Message-Center;
  gesperrter Toggle per Tab erreichbar → Enter zeigt den Grund, Zustand unverändert; Space
  erreicht nie `cycle_start` (`explainKeydown` stoppt die Propagation).

**D2 · UX-11 Eine antippbare Hilfe** (`HelpIcon.vue`, `JogStrip.vue`, `SetupStrip.vue`)

- `HelpIcon` bekommt `label` (aria-label „Help: <Thema>“, Default „Show help“). `JogStrip`: ein
  HelpIcon am Label „Kinematics frame“ mit den drei Erklärungen (Machine/TCP/Plane); die Radios
  behalten Einzeiler-`title`; `planeTitle` wird getrennt in Sperrgrund (D1) und Hilfetext.
  `SetupStrip`: ein HelpIcon am Bewegungs-Block mit den drei langen → Zero/→ Home/→ G30-Texten;
  die Hold-Buttons behalten kurze `title`. Banner-`title`s in `App.vue` sind keine Controls und
  bleiben. Escape bei offenem Popover = E-Stop (Capture-Listener) und schließt das Popover —
  erwartet, in `docs/testing.md` festgehalten.
- Tests: Hilfe-Button hat den Namen „Help: Kinematics frame“, Klick öffnet das Popover mit „TCP“;
  Tab → Enter öffnet; Space auf dem fokussierten Button sendet nie `cycle_start`.

---

#### WP-E — Bestätigungen nach Wirkung (UX-12)

- `MachineBtn.vue`: **jeder** abgebrochene Hold sagt es am Control (`showHint`): Slide-off „Hold
  to activate — keep the finger on it“, Gate zu „Unavailable — <Grund>“, Ziel gewechselt
  „Selection changed — hold again“ (heute nur Konsole; `touch-hold.spec.ts` behauptet mehr, als es
  prüft). Hold-Buttons ohne eigenes `title` bekommen `title="Hold to activate"` (Hover-Vorab-
  hinweis). **Neues globales Muster** für den Touch-Vorabhinweis: `.b.holdable` mit 2-px-Spur am
  unteren Rand (`--hl-active`, `--opacity-subtle`) in `style.css` — sichtbar, bevor je gehalten
  wurde; die bestehende Hold-Füllung (`Btn.vue` `.holding::after`) bleibt.
- `GamepadMapWizard.vue:190/252`: „Press again to restart (3 s)“ mit sekündlichem Countdown
  (`aria-live="polite"`), Rückfall nach 0 s.
- `OffsetPanel.vue:118-125`: `Clear G54` title/aria „Hold to clear G54“; `Clear All` title/aria
  „Hold to clear all fixture offsets (G54–G59.3)“ (Hold bleibt, Operator-Entscheidung 2026-09-19).
  `ToolTablePanel.vue:631`: Dialogtitel „Delete T12?“ (Ziel im Titel). Makro-/Reset-Dialoge sind
  lokal und bleiben.
- Tests: `touch-hold.spec.ts` prüft den Hinweistext auch bei Slide-off und Gate-Schließung; Wizard-
  Countdown-Text; `clipped-label` unverändert (keine Label-Verlängerung).

---

#### Doku, Review-Antworten, Commits

- `docs/reviews/ui-optimierungen.plan.md` → **Fassung 4**: Abschnitt „WP9 — Aktions- und
  Feldvertrag (UX-01–13)“ + WP0/WP8-Nachträge (UI-I10-Schließpfad, UI-I11) mit den drei
  Operator-Entscheidungen; SHA-256 in `review.md` aktualisieren (Plan-Revision R4).
- `docs/reviews/ui-optimierungen.implementation-review.md`: „Antworten Runde 4 · Claude“ je ID
  (UI-I10, UI-I11, UX-13, UX-01–12 → WP9-Stand) + „Gate-Läufe Runde 4“; `review.md` Statuszeile;
  Codex' r4-Dateien (`…r4.evidence.txt`, `…r4.probes.spec.ts`, `…r4-editor-150.png`) committen wie
  geliefert.
- `docs/decisions.md` (Eintrag 2026-09-21/22: Ein-Schreiber-Regel für Textfelder, Fokus-Rückgabe
  bei explizitem Schließen, Feldvertrag, Aktionsvertrag, Arm/Power-Labels, Speicherstatus),
  `CLAUDE.md` (Bullets `inputSession.ts`, `MachineInput.vue`, `MachineBtn.vue`/`type="close"`,
  `permissions.ts` `useGateExplain`, `SafetyStrip.vue`, `HelpIcon.vue`), `docs/testing.md`
  (Zeilen keyboard-guards / input-session / touch-hold / smoke; Safari-Grenze von D1).
- Commits: WP-A · WP-B · WP-C · WP-D · WP-E je ein Commit, danach ein Doku-Commit mit
  Gate-Ergebnissen. **Codex-Runde 5 nach WP-A** (die zwei P-Befunde), **Runde 6 nach WP-E**.

### Reihenfolge & Verifikation

| Schritt | Umfang | Gates (Suite nicht live) |
|---|---|---|
| A | UI-I10-Rest, UI-I11, UX-13 | `npm run build`, `npm run lint`, `npx vitest run`, `npx playwright test --project=serial-guards --no-deps --workers=1`, danach `python3 scripts/test_suite.py offline` (Report `status: pass`, `commit` = WP-A-Hash) |
| B | Aktionsvertrag | build, lint, `audit-css` (neue Kategorie CLOSE rot/grün-Probe), `serial-guards`, `serial-touchoff`, `serial-tools`, `npm run test:layout`, `npm run test:visual` (4 tool-edit-Refs nach Sichtprüfung) |
| C | Arm/Power, Speicherstatus | build, lint, vitest (Statusautomat), `serial-guards` (Portrait-Budget 100/150 %), `npm run test:layout`, smoke |
| D | Sperrgründe, Hilfe | build, lint, `serial-guards`, `serial-touchoff` (JogStrip/SetupStrip-Fälle) |
| E | Bestätigungen | build, lint, `serial-guards` (touch-hold), `npm run test:layout` |
| final | alles | `python3 scripts/test_suite.py offline` PASS auf dem letzten Produkt-Commit; Live-Sichtprüfung am XYZAC-Sim (Plan-Tabelle Fassung 3 + Numpad X/Discard, Arm/Power, Speicherstatus, Sperrgrund per Tap, Hilfe-Popover); **UX-13-Abnahme in Firefox/macOS mit iCloud-Passwörtern an/aus + frisches Profil**; physische Touchscreen-Abnahme bleibt gesondert |

### Risiken

- Label-Breiten in 44-px-Zellen (`Apply`, `Discard`, `Clr`, `Power off`) — das Layout-Gate
  (`clipped-label`) und die Portrait-Messung bei 150 % entscheiden; Fallbacks stehen bei B1/C1.
- `returnFocusTo` beim Pointer-Schließen ist ein No-op-Übergang — ein bewusst gewählter anderer
  Fokus (Operator klickt sofort woanders hin) wird vom bestehenden „moved on“-Zweig respektiert.
- MDI-Enter auf Keydown: Auto-Repeat wird per `e.repeat` verworfen; die Bildschirmtaste `Send`
  ruft weiterhin `handleMdiSend()` direkt.
- Ein-Schreiber-Umbau des Textzweigs betrifft alle 14 Textfelder — der Feldvertrag-Scan und die
  bestehenden Text-Fälle (`input-session`, `tool-*`) sind die Regression; ein `:value`-Aufrufer
  ohne `@input` würde künftig ehrlich nicht tippbar sein (wie ein natives kontrolliertes Feld).
- Firefox/iCloud-Passwörter: `autocomplete="off"` ist keine Garantie gegen jeden Passwortmanager
  — die Abnahme ist manuell und steht in der Verifikationstabelle, nicht als Zusage.
- Gesperrte Inputs erklären sich nur per Pointer (Chromium ≥ 116, Firefox ≥ 105); Safari und
  Tastatur sind die dokumentierte Grenze.

### Folge-Liste (bewusst nicht in dieser Welle)

- Fokus-Trap/Autofokus in Dialogen; Größen-Token-Skala; Hold-Buttons per Tastatur (bewusst tot).
- Prosa-Ausnahme im Feldvertrag (Spellcheck für Beschreibungen), falls der Operator sie wünscht.
- DOM-Umgebung für Vitest (`@vue/test-utils` + jsdom/happy-dom), damit Katalog-Komponenten wie
  `MachineInput` auch als Unit-Test prüfbar sind — heute nur e2e.
- Physische Touchscreen-Abnahme (gate-t `main`).
- UX-09-Rest (Codex-Runde 5): ein fokussierbares Info-/Sperr-Control direkt an gesperrten Input-Roots
  (`MachineInput`, `MachineSelect`, `MachineSlider`, `MachineRadio`) — heute erklären sie per Pointer
  und Titel; Tastatur und Safari sind die dokumentierte Grenze.
