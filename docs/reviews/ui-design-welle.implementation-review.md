# WebUI Design-Welle — Umsetzung und Implementierungsreview

Branch `feat/ui-design-wave` aus `development` (`0019da5`). Plan: [Fassung 3](ui-design-welle.plan.md)
mit Plan-Agreement ([Planreview Runde 3](ui-design-welle.review.md#codex-runde-3)). Dieses Dokument
hält je Arbeitspaket den Umsetzungsstand, Abweichungen und Gate-Läufe fest; die
Codex-Implementierungsreviews folgen nach den Paketgruppen DR + D0–D2, D3–D6 und D7–D10.

---

## Umsetzung · Claude

### WP-D0 — Begriffe, Einheiten, Platzhalter · `7ce9ee1` · 24. September 2026

- **Glossar** `docs/ui-glossary.md` (in CLAUDE.md verlinkt): Begriffe, Schreibweise, Zustandswörter,
  Platzhalter, Einheiten.
- **`format.ts`:** `NO_VALUE` („—“) ist der eine Anzeige-Platzhalter. Er wird von `fmtCoord`,
  `fmtNum`, `fmtCell`, `fmtRpm`, `fmtOffset`, `g5xLabel`, `toolTypeLabel`, im HUD und in den
  Leisten verwendet, nie als Eingabewert (`fmtAxisValue` bleibt `""`). Neu sind `fmtPct` (Anteil →
  „120 %“), `fmtMs`, `fmtQty` („12.0000 mm“) und `fmtUnit`.
- **Einheiten nach Quelle (N02–N04):**
  - Jog-Geschwindigkeit: mm/min bzw. °/min unter dem Wert, in einer Zelle. Das
    Hochformat-Raster behält vier Zellen je Zeile.
  - Jog-Schritt: „Step (mm / °)“. Ein Inkrement gilt für jede Achse, linear in mm (in),
    rotatorisch in °.
  - ToolStrip: Ø und Länge.
  - Kompensationsdialog: mit Einheit.
  - Scrub-Distanz: in der Preview-Einheit.
  - Prozent über `fmtPct`: Overrides, Kamera, Gamepad, Donut, HUD-Last.
  - `ms` mit Leerzeichen.
- **Zustandswörter (N06):** E-Stop ACTIVE/CLEAR, Power ON/OFF, Axes HOMED/UNHOMED, Overrides
  ACTIVE/NONE. „NOT HOMED“ hätte die Spalte umgebrochen, deshalb „Axes · UNHOMED“.
- **Begriffe (N07–N16):**
  - Work Offsets (Titel, Clear-All-Name).
  - No program loaded.
  - Rapid als Viewer-Farbe; „Fast Feed“ bleibt der Probe-Vorschub.
  - Probing und Toolsetter mit gleichen, ausgeschriebenen Parameternamen (Fast/Slow/Traverse
    Feed, Max X/Y/Z Travel, Retract Distance, Spindle Zero Height, Offset Direction, Calibration
    Offset, …).
  - Oberflächenscan X/Y Min/Max wie im Hilfetext.
  - None für unbelegte Tasten; totes `ACTION_LABELS` entfernt.
  - Reiter „HAL“.
  - Run-from-line-Voreinstellung Rev · Off · Fwd.
  - Collision und Limit Violation in ScrubBar und HUD.
  - Statuswörter in Satzform („No collision so far“, „Clear“); das zieht N102 aus D9 vor.
  - Überall „…“; Title Case für Kurzbeschriftungen.
- **CSS-Audit:** Die Template-Kategorien `ELLIPSIS` und `UNIT_LITERAL` haben Fixtures und Tests.
  CSS-Längen in `:style` sind ausgenommen.
- **Abweichung:** Die **Feldeinheiten der Probe- und Toolsetter-Formulare** (N02) kommen mit dem
  Einheiten-Platz von `FormField` in WP-D4 — ein Label-Zusatz jetzt hätte D4 nur wieder
  umgebaut.
- **Neuer Befund UI-N96:** Die zweite Spalte der Safety-Statusdetails ist im Touch-Hochformat
  abgeschnitten („MANUA“, „IDL“, „JOIN“, „00:0“). Das war schon vor D0 so (Vergleichsaufnahme
  mit dem alten TRUE/FALSE-Stand) und wird in WP-D6 behoben.
- **Gates:** build, lint (inkl. CSS-Audit, 14 Audit-Tests), vitest **1 597 / 1 597**, Playwright
  **157 / 157**. 17 Referenzbilder nach Sichtprüfung erneuert: 14 Jog-Bilder (Einheiten,
  Schritt) und 3 Werkzeugeditor-Bilder (Platzhalter „…“). Das 3-Achs-Desktop-Jogbild lag
  innerhalb der 0,2-%-Toleranz und wurde ausdrücklich neu geschrieben, damit die Referenz nicht
  veraltet.

### WP-DR — Referenzgeometrie · 24. September 2026

**Messung** im Produkt am echten Seitenpanel (5-Achs-Profil, Mock-Gateway, Probing aktiv).
Gemessen wurden die Innenmaße des Panels und die Typografie der vorhandenen Reiter (11 px,
Innenabstand 2 × 10 px). Die Textbreiten stammen aus der gerenderten Schrift. Alle Maße in
Layout-px; CSS-Zoom ist die Emulation der Tests.

| Zustand | Panel innen | Hauptreiter: Spalte / nötig | 4×2-Raster: Spalte / nötig (einzeilig · zweizeilig) | heute: Reiter + Unterreiter |
|---|---|---|---|---|
| Desktop 1600×1000 | 522 × 569 | 101 / 66 | 128 / 97 · 82 | 25 + 54 |
| Touch quer 1280×800 | 522 × 367 | 101 / 66 | 128 / 97 · 82 | 36 + 76 |
| Touch hoch 900×1200 | 570 × 506 | 111 / 66 | 140 / 97 · 82 | 36 + 76 |
| Touch hoch 150 % | **271 × 289** | **51 / 66** | **65 / 97 · 82** | 76 + 116 |
| Touch hoch 200 % | 120 × 170 | — | — | ausgegrenzt |
| Touch quer 150 % | 523 × 66 | — | — | ausgegrenzt |

Textbreiten bei 11 px:
- **Hauptreiter:** Program 46, Probing 41, Offsets 39, Tools 27, MDI 21.
- **Verfahren:** Toolsetter 62, Calibrate 56, Outside 48, Surface 47, Pocket 42, Ridge/ 39,
  Inside 38, Valley 38, Angle 35, Boss/ 33.

**Festlegungen:**

- **Hauptreiter:** fünf gleich breite Spalten, 32 px Desktop bzw. 44 px Touch, volle Namen. Das
  passt ab 5 × 66 + 4 × 4 = 346 px Panelbreite.
- **Probing-Raster 4×2:** 32/44 px je Zeile, einzeilige Namen. Das passt ab 4 × 97 + 3 × 4 =
  400 px — genau die Schwelle des Schmal-Modus. Zweizeilig am „/“ wird damit nicht gebraucht.
- **Fester Kopf = Hauptreiter + Raster.** Steuerleiste (Auto Zero / Set Rotation / Status / Abort)
  und Beschreibungszeile **scrollen mit dem Inhalt**.
  - **Touch quer 1280×800:** 367 − 44 − 8 − 92 − 8 = 215 px, rund 3 Formularzeilen. Mit fester
    Steuerleiste wären es 123 px, also 1 Zeile — weniger als heute.
- **Schmal-Modus unter 400 px Panelbreite** (Operator-Entscheidung 24.09., gemessen bei 150 %
  Hochformat): Bereich und Verfahren werden **zwei beschriftete Auswahllisten in einer Zeile**
  („Probing ▾“ · „Outside ▾“), 44 px fest, volle Namen.
  - Inhalt: 289 − 44 − 8 = 237 px, rund 3 Formularzeilen.
  - Bei festen Reitern plus Raster blieben 137 px (< 2 Zeilen), und „Toolsetter“ (62 px) passt
    nicht sinnvoll in 65 px.
  - Bei normaler Breite bleiben es fünf Reiter und das feste 4×2-Raster (Entscheidung 1).
- **Pfeiltasten im Raster:** Links/Rechts linear in Leserichtung durch alle acht, Home/End an die
  Enden, Hoch/Runter wechseln die Rasterzeile, alle lokal abgefangen, Auswahl mit Enter/Leertaste
  (Plan WP-DR).
- **Ausgangsgrenzen** bleiben benannt, nicht behoben: 200 % Hochformat (120 px Panelbreite) und
  150 % Querformat (66 px Panelhöhe) brauchen eine Änderung der Gesamtaufteilung (Folge-Liste).
- **Wächter (mit D3):** `layout.spec` prüft für die vier Zustände, dass kein Reitername
  abgeschnitten ist, dass das Raster bzw. unter 400 px die Auswahllisten erscheinen und dass die
  scrollende Inhaltsfläche mindestens drei Formularzeilen hoch ist.

### WP-D1 — Rückmeldekanäle · 24. September 2026

**Kanalregel** (CLAUDE.md „Feedback channels“, `docs/decisions.md`): Was eine Berührung auslöst,
antwortet **am Control**. Das Ergebnis eines Vorgangs steht **inline**, wo er begann. Maschinen- und
Systemzustand gehören ins **Banner**. Die Meldungsliste ist das **Protokoll**.

- **Sperrgrund (N20, N21, UI-D08):**
  - `explain(at)` zeigt den Grund als Blase am Control (`btnHint`). Der geplante stille
    Protokolleintrag entfiel nach der Live-Sichtprüfung (siehe unten).
  - Die WCS-Radios der Setup-Leiste laufen über `explainAt(at, reason)`. Das ist derselbe Weg; ein
    Composable kann nicht je `v-for`-Eintrag laufen, deshalb nicht `useGateExplain` wie im Plan.
    Es gilt dieselbe Regel (nur scharf geschaltet, am Control, still).
  - Die Blase wird **nach dem Rendern gemessen** und mit `placePopover(…, "above")` platziert:
    oberhalb, sonst unterhalb, an allen Rändern begrenzt, maximale Breite aus dem Viewport.
    `cssZoomOf` teilt sie sich jetzt mit HelpIcon.
  - Anzeigedauer nach Textlänge (`hintDuration`, nach der Live-Sichtprüfung 1,5–4 s). Sie schließt
    bei jedem Scrollen und wenn ihr Control das Dokument verlässt.
  - **Befund beim Testen:** Schloss sich ein Gate unter dem Finger, verpackte `MachineBtn` den Button
    im selben Durchgang in `.btnTip`. Der beim Anzeigen festgehaltene Anker war beim Platzieren
    nicht mehr im Dokument, und „Unavailable — …“ verschwand sofort (Touch-Hold-e2e rot). Jetzt ist
    der Anker eine Funktion, die erst beim Platzieren aufgelöst wird.
- **Meldungsmodi** `notify` (gezählt, Statuszeile 5 s), `status` (Statuszeile, ungezählt:
  Run-from-line-Fortschritt), `log` (still).
  - **Verfeinerung von N22:** Maschinenmeldungen (`(MSG, …)`, NML-Fehler) übernehmen die
    Statuszeile weiterhin. Sie sind Maschinenzustand; nur die stillen UI-Einträge bleiben draußen.
- **Banner (N23–N27):**
  - Eine berechnete `bannerLine` mit zwei Stufen: `bannerError` für Sicherheit, Maschine und
    Verbindung, `bannerWarn` für Programm, Vorschau und Konfiguration.
  - Jede Zeile nennt den Zustand und ein Wiederherstellungsverb. Neu sind der Button „Reload
    program“ beim Vorschau-Ladefehler und bei Refresh der Grund „LinuxCNC is back — refresh the
    page“.
  - Das „Warum“ (bisher nur `title`) steht oben in der Meldungsliste, die ein Tipp aufs Banner
    öffnet.
  - `bannerAck` und `bannerReload` gehören zur `banner*`-Familie.
  - `openMessages()`/`closeMessages()` sind die einzigen Wege, auch für das Kopfsymbol. Der
    Hintergrund markiert jetzt ebenfalls als gelesen.
- **Inline-Meldungen (N28–N31):**
  - `.statusNote` (error/warn/ok) ersetzt `.errorBanner`, `.warnBanner`, `.importBanner`,
    `importWarn` und die Block-Verwendungen von `.noteWarn`. Das betrifft 19 Stellen: Programm,
    Editor, Run-from-line, Werkzeugtabelle und -editor, Import, Dateibrowser, Tool-Leiste,
    Oberflächenkarte und Kompensation. `.noteWarn` bleibt Inline-Text in Tabellenzeilen.
  - Retry nur für wiederholbare Lesefehler, einheitlich mit dem ungegateten Typ `retry`:
    - Der Dateibrowser behält `browseFailure` (400 ohne Retry, die Liste bleibt).
    - Werkzeugtabelle und Oberflächenkarte haben keine dauerhafte Klasse.
    - Die Tool-Leiste bekommt das Retry, das ihr fehlte.
  - Speicherfehler eines verwaisten Editor-Speicherns sind `OPERATOR_ERROR`, sein Erfolg ein stiller
    Eintrag.
  - „Discard“ in der Inline-Notiz ist `inlineDanger`.
- **Hilfe (N32–N34):**
  - Alle 74 HelpIcons tragen einen Namen, auch das von `MachineToggle`.
  - `.settingDesc` ist global.
  - Unter allen fünf Probe-Rastern steht eine sichtbare Beschreibungszeile. Ein Tipp auf eine
    Halten-Zelle zeigt sie und löst nichts aus.
  - Stats-Zeilen, HUD-Warnungen und das Kollisionsurteil erklären sich über HelpIcons. Das HUD
    lässt nur die Icons anklickbar.
  - Lange Titel wurden gekürzt (Go-to-Buttons, Kinematik-Radios, ScrubBar).
  - Neue Audit-Kategorie `LONG_TITLE` (> 90 Zeichen, statisch oder als längstes Literal eines
    gebundenen Titels) mit Fixture und Test.
- **Wächter:** `e2e/feedback-channels.spec.ts` (unter `serial-guards`):
  - **Durchlauf über alle erreichbaren gesperrten Buttons** im Querformat 1280×800 und im
    Hochformat 900×1200 bei 150 %. Geprüft wird:
    - Die Blase liegt ganz im Fenster, direkt über oder unter ihrem Control und überlappt es
      waagrecht.
    - Alle vier Ränder werden erreicht.
    - Die Statuszeile bleibt unverändert, es entsteht genau ein stiller Eintrag je Erklärung, der
      Zähler steigt nicht, keine Maschinenaktion.
  - **Tastatur, Input, Dialog:** Enter und Leertaste, das gesperrte MDI-Feld als Anker, ein
    gesperrter Reset im Settings-Dialog (Blase über der Dialogebene).
  - **Banner:** Maschinenmeldung mit Zähler; der Hintergrund markiert als gelesen; error- und
    warn-Stufe; Tipp → Detail; Acknowledge.
  - **Lesefehler:** 400 ohne Retry mit erhaltener Liste, 503 mit erfolgreichem Retry.
  - **Gegenprobe:** Eine unbegrenzte Platzierung macht den Durchlauf rot („covers its control“).
  - Dazu Vitest `hintDuration` und die Platzierung „above“.
  - Angepasst wurde der Touch-off-Test „reason on hover and on tap“: Der Zähler bleibt, die Blase
    zeigt den Grund.

#### Nachbesserung nach der Live-Sichtprüfung · 24. September 2026

Der Operator sah D1 am laufenden XYZAC-Sim, noch vor dem Commit. Befunde und Umsetzung:

| Befund | Ursache | Umsetzung | Wächter |
|---|---|---|---|
| Probe-Zellen im TCP-Modus verzogen und kleiner | Das Gate `machineFrame` schließt; der gesperrte Button wird in `.btnTip` verpackt. Die Klasse `gridCell` trug **Inneres** (4 px Innenabstand, Flex-Zentrierung) und landete auf dem Rahmen. Latent seit U-06 (14.09.). | Regel: Eine Klasse an einem `MachineBtn` beschreibt nur den **Platz**. Das Innere kommt aus dem Katalog: neuer Typ `probeCell` mit Btn-Größe `cell`; `gridCell` behält nur `aspect-ratio`. | Seitenpanel-Durchlauf in `layout.spec`: alle Hauptreiter und Probing-Unterreiter × alle Maschinenzustände einschließlich TCP/Plane, jedes Control gesperrt gegen offen. Vorher rot (90 → 84,7 × 76,7 px), jetzt grün. |
| „Start“ gesperrt 9 px schmaler | Flexbox: Bei `flex: 1` geht jeder Button mit Innenabstand plus Rand (26 px) als Sockel in die Verteilung, der Rahmen ohne. | Die Programmleiste ist ein Raster mit gleichen Spalten (`minmax(max-content, 1fr)`). | wie oben |
| Edge Width liegt auf der Trennlinie | Die D1-Beschreibungszeile sprengte `.gridSection { height: 360px }`; im Scrollbereich wurde die Sektion zusätzlich gestaucht. | Mindesthöhe statt fester Höhe, `flex: none`. D3 ordnet das Panel neu. | Neue Audit-Arten `overflowing-box` und `crosses-separator`, mit Fixture. |
| Hinweis bleibt Sekunden stehen und verdeckt Buttons | nur Zeit und Scrollen schlossen ihn | Schließt beim nächsten `pointerdown` oder Tastendruck irgendwo (Capture, eine neue Frage zeigt ihren eigenen), höchstens 1,5–4 s | e2e: Klick daneben und Taste schließen |
| Zwei Erscheinungsbilder (Fragezeichen vs. Blase) | Die Blase nutzte die Viewer-Chrome `.overlay-card`. | Eine Karte `.helpPopover, .btnHint` | e2e vergleicht die berechneten Stile beider Karten. |
| Eine endlose Zeile mit Scrollen zur Seite | Das Popover erbt `white-space: nowrap` über das DOM, auch im Top-Layer (HUD-Zeile, Stats-Label). | `white-space: normal`, `overflow-wrap: anywhere`, `overflow-x: hidden` | e2e öffnet jedes HelpIcon in allen Reitern, Unterreitern und Settings-Reitern (über 40); CSS-Vertrag in einem `nowrap`-Elternteil |
| Gründe zu lang und unpräzise | Gateway-Regeln mit Erklärungen bis 190 Zeichen | Alle Gründe „warum — was tun“ in höchstens 60 Zeichen, im Gateway und im Client. Touch-off nennt jetzt den genauen Fall statt einer Sammelzeile. | `TestReasonLength` (20 000 zufällige Zustände), `CLIENT_REASONS`-Test, Audit `LONG_REASON` |
| Protokoll wird zugespammt | geplanter stiller Eintrag je Erklärung | **Operator-Entscheidung:** kein Eintrag. Die Meldungsliste bleibt Maschineninformationen vorbehalten. | e2e: null Einträge |

- Die Gateway-Texte sind zugleich die Antwort auf einen abgelehnten Befehl. Sie werden erst nach
  einem Neustart der Suite sichtbar. `require_armed` nutzt jetzt denselben Text (`NOT_ARMED`), und
  der Dispatch-Test liest seine Ablehnungsliste aus den Regeln statt aus kopierten Wörtern.
- Außerhalb dieses Schritts: Der lange Titel des Kinematik-Chips im HUD (`twpPose.ts`, nur Hover)
  gehört zu D9.
- **Gates (D1 samt Nachbesserung):**
  - Build und Lint mit CSS-Audit: 16 Audit-Tests, darunter die neuen `LONG_TITLE` und
    `LONG_REASON`.
  - Vitest **1 600 / 1 600**, Gateway-pytest **965 / 965**, Playwright **176 / 176**. Neu sind
    6 Rückmeldekanal-Tests, 12 Seitenpanel-Durchläufe und 1 Audit-Fixture.
  - Keine Referenzbilder erneuert: Die Jog-, Setup- und Werkzeugeditor-Bilder zeigen keinen
    D1-Text.
  - Die Gateway-Texte sind erst nach einem Neustart der Suite live.
