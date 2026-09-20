# WebUI Review-Welle — Bugs, Design-Regeln, Regressions-Tooling

**Fassung 3 · 20. September 2026 · nach Codex-Review Runde 2 + Nutzer-Nachtrag UI-15
(`docs/reviews/ui-optimierungen.review.md`).** Runde 1: alle 14 IDs übernommen. Runde 2: die
fünf Nachschärfungen (UI-01, 06, 09, 11, 12) sind eingearbeitet und mit `[UI-nn R2]` markiert;
UI-15 (gemeinsame Eingabehilfe) ist als **WP8** aufgenommen und integriert UI-13.

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
