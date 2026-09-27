# WebUI Design-Welle — Umsetzung und Implementierungsreview

Branch `feat/ui-design-wave` aus `development` (`0019da5`). Plan: [Fassung 3](ui-design-welle.plan.md)
mit Plan-Agreement ([Planreview Runde 3](ui-design-welle.review.md#codex-runde-3)). Dieses Dokument
hält je Arbeitspaket den Umsetzungsstand, Abweichungen und Gate-Läufe fest; die
Codex-Implementierungsreviews folgen nach den Paketgruppen DR + D0–D2, D3–D6 und D7–D10.

**Aktueller Reviewstand · Codex Runde 9 · 27. September 2026 · `0418850`:
UI-DI17 ist geschlossen. UI-DI16 bleibt als P2 offen: Bei ausgeblendeter HUD-Ebene
werden Höhenlimit und schmale Bannerdarstellung nicht aktualisiert; nach einer
Größenänderung verdeckt „More“ die Simulationserläuterung.
D7–D10 noch ohne Implementierungs-Agreement.**
[Nachprüfung, Nachweise und Prüfgrenzen](#codex-implementierungsreview-runde-9).
UI-DI12–15 bleiben geschlossen.
Das [Agreement aus Runde 5 für D3–D6](#codex-implementierungsreview-runde-5) bleibt gültig;
UI-DI05–11 bleiben geschlossen.
Das [Agreement aus Runde 3 für DR + D0–D2](#codex-implementierungsreview-runde-3)
bleibt gültig; UI-DI01–04 bleiben geschlossen. Die Gesamtabnahme steht weiter aus.
Die früheren Runden unten sind historische Prüfstände.

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

#### Zweite Live-Sichtprüfung · 25. September 2026

| Befund | Ursache | Umsetzung | Wächter |
|---|---|---|---|
| Jog-Geschwindigkeit und Einheit nicht über dem Slider zentriert | Die Zahl stand rechtsbündig in ihrem festen Slot, die Einheitenzeile linksbündig. | Beide zentriert; der feste Slot bleibt und hält die Nachbarn ruhig. | `layout.spec`: Wert und Einheit höchstens 1 px neben der Slider-Mitte (vorher 9,6 px). |
| „?“ klebt teils direkt am Label | Drei Abstände: 0 px (kein Abstand im Container), 4 px (Flex-Gap), 8 px (Flex-Gap der Toggle-Zeile). | Das Icon bringt seinen eigenen `--gap-tight` mit; Container rücken es nie ab. Text und Icon eines Toggles sind ein Flex-Element. | Durchlauf „one look“: Abstand nach dem letzten sichtbaren Zeichen. |
| „?“ teils gedämpft, obwohl klickbar | Labels, `.sub`, `.label-muted` und die Kalibrier-Labels dämpften mit `opacity`; die multipliziert sich in jedes Kind. | Gedämpfter **Text** in einem Kasten mit „?“ ist eine Farbe (`--mix-muted`, gleicher Anteil). Ein **gesperrtes** Label bleibt bei Opazität, weil sie sich mit seiner eigenen Farbe verbinden muss (der Plane-Radio „stale“ ist Warnfarbe und gedämpft; eine Farbregel unterlag im ersten Versuch `.val-status.warn`, die Referenzbilder zeigten es). Deshalb steht das „?“ eines Toggles neben dem Label statt darin. | Durchlauf „one look“: wirksame Opazität, Farbe, Rahmen jedes „?“ in allen Reitern und Settings. |
| (gefunden) „?“ in einem gesperrten Bereich tot und gedämpft | Ein `<button>` im gesperrten Gate-Fieldset ist gesperrt. | HelpIcon ist ein `span role="button"` mit eigenem Umschalten; Lesen ist keine Maschinenaktion. | Gesperrter Durchlauf (disarmed): gleiches Aussehen, Popover öffnet. Rot mit dem alten Button. |
| (gefunden) Tippen auf einen gesperrten Toggle erklärt nichts | `label:has(input.toggle:disabled)` hatte `pointer-events: none`. | Entfernt; das Label bleibt antippbar. | wie oben |
| Beschreibungszeile unter dem Raster unnötig, Angle springt | Die Zeile vergrößerte die Sektion; Edge Width schob die Parameter 29 px nach unten. | **Operator-Entscheidung:** Zeile entfernt, die Symbole erklären sich selbst. Sektion wieder fest 360 px, `flex: none`. | `layout.spec`: Die Parameter beginnen in jedem Raster-Unterreiter auf derselben Höhe. |
| Hilfetexte zu lang („niemand liest ein Abstract“) | 71 von 80 Texten über 100 Zeichen, der längste 704. | Alle neu: was der Wert ist und die eine Regel, höchstens 120 Zeichen. Touch Z war sachlich falsch (Oberfläche in G53, meist negativ, keine Anfahrhöhe). | Audit `LONG_HELP` (120, mit Fixture); Popover-Durchlauf: gerenderter Text höchstens 140. |
| Limit-Hilfe im HUD, Kollisions-Hilfe in der Sim-Leiste | Zwei Orte für zwei Befunde derselben Art. | Beide Befunde erklären sich dort, wo man sie ansteuert: Das „?“ der Limits sitzt jetzt in der Sim-Leiste neben ihrer Navigation. | — |
| „MACHINE · off datum“ ohne Erklärung | Die Erklärung stand nur in einem Titel von 400 Zeichen. | `kinsModeChip` liefert für Warnzustände eine kurze `help`, als „?“ am Chip (Setup-Leiste und HUD); der Titel ist nur noch ein Name. | Vitest: jede Chip-Hilfe höchstens 120 Zeichen, keine an den Normalzuständen. |
| „Not in TCP — select Machine or Plane“ unklar | Liest sich als Aussage über den aktuellen Modus. | Modus-Einschränkungen positiv: „Machine frame and Plane only“, ebenso Machine-frame- und Rotations-Touch-off-Gründe. | Policy- und Dispatch-Tests auf den genauen Text. |
| Portrait: Safety-Bereich 1 px seitlich scrollbar | zunächst nicht nachgestellt — die Sonde suchte nur 1–6 px; siehe Nachtrag | siehe Nachtrag | Neue Audit-Art `sliver-scroll` in allen Layout-Durchläufen. |
| (gefunden) Portrait: das „?“ am Chip schob die WCS-Radios auf zwei pro Zeile (+32 px) | Im Portrait ist die WCS-Gruppe eine Zeile: „WCS“, Chip mit „?“, Radios. | „WCS“ steht über dem Chip in einer Kopfzelle: Die Sektion ist gleich hoch oder niedriger, drei Radios pro Zeile. | Referenzbilder (fünf Setup-Bilder nach Sichtprüfung erneuert) |
| (gefunden) Offsets-Tabelle 4 px seitlich scrollbar | Beim 5-Achs-Profil ist die Mindestbreite 60 + 6 × 76 = 516 px, der Bereich 512 px. | Namensspalte 56 px (das breiteste Label „G59.3“ braucht 36 px plus Innenabstand). | `sliver-scroll` im Seitenpanel-Durchlauf, erster voller Lauf rot |
| „?“ am off-datum-Chip nicht auf der Zeile des Textes | `vertical-align: middle` zentriert auf die x-Höhe: 1,25 px unter Großbuchstaben (Firefox). Ein Inline-Kasten ist eine Umbruchstelle: Ein schmaler Chip kann das „?“ allein in die nächste Zeile setzen. | Text und „?“ bilden eine zentrierte Flex-Zeile: Chip, HUD-Zeilen, Stats-Labels, Inline-Probe-Labels, `.textWithHelp`. | Look-Durchlauf misst jetzt auch Chip und HUD im off-datum-Zustand und die Mitte des „?“ gegen die Textmitte; Firefox-Messung am Live-UI: 0 px. |

Nachtrag nach dem Neustart (25.09.): kein Scrollbalken mehr zu sehen, aber im Portrait ein großer Abstand links vor dem Safety-Bereich.

| Befund | Ursache | Umsetzung | Wächter |
|---|---|---|---|
| Portrait: Safety-Inhalt 8 px weiter eingerückt als Jog | Die Portrait-Regeln für `.safetyStrip` standen in `style.css` vor den Basisregeln; gleiche Spezifität, die spätere gewinnt. Seit `7621cb7` (7. August) wirkungslos. | Der Portrait-Block steht jetzt hinter den Basisregeln, mit Kommentar. | Audit `MEDIA_SHADOW` (8 Treffer auf der alten Reihenfolge, scannt auch `style.css`); `layout.spec`: alle Sektionen eine Inhaltsspalte (vorher 25..269 gegen 17..269). |
| (gefunden) Portrait: Scroll-Blende unter dem angehefteten Safety-Bereich fehlte | Derselbe tote Block: die Blende behielt die Querformat-Geometrie rechts außerhalb. Seit `19f4147` (8. August). | Mit dem Block verschoben; hängt jetzt unter dem Bereich (Sichtprüfung gescrollt). | `layout.spec`: Blende so breit wie der Bereich, unten angehängt. |
| Safety-Status seitlich scrollbar (war der gemeldete 1 px) | Die zwei Statusspalten brauchen in der Testschrift 255,8 px: im Querformat 0,2 px Reserve, im Portrait 10–20 px zu wenig. Overlay-Scrollbars (macOS, GTK) zeigen den Balken erst beim Scrollen; eine schmalere Schrift macht aus 10 px einen. | Trenner und Mindestabstand Label–Wert auf `--gap-tight`, Innenrand der Statusbox im Portrait `--gap-tight`: 240 px Bedarf, 4 px Reserve am Tablet. Spalten stapeln wurde gemessen und verworfen: der angeheftete Bereich wüchse von 25 auf 35 % der Leiste, bei 150 % von 45 auf 60 % (erst als „540 von 603 px“ notiert — Einheiten gemischt). | Layout-Audit `sideways-scroll` (jeder seitliche Überlauf in der Leiste; 12 px auf dem alten Stand); `layout.spec`: Spalten nebeneinander, Reserve ≥ 2 px, angehefteter Bereich ≤ 30 % der Leiste, bei 150 % ≤ 55 %. |

- Schrift (Operator-Entscheidung 25.09.): Die Frage nach den gerenderten Schriftnamen war unnötig und ist
  zurückgezogen. Die Oberfläche liefert jetzt Inter selbst mit (lokal, SIL OFL); Tests und Referenzbilder
  messen genau diese Schrift. Dabei gefunden: Die 3D-Beschriftungen luden ihre Schrift zur Laufzeit von
  cdn.jsdelivr.net — ohne Internet fehlten sie. Wächter: Viewer-Spec ohne fremde Hosts, Quelltext-Scan
  jeder `new Text()`. Die Code-Flächen liefern ebenso JetBrains Mono mit (Operator-Ja am selben Abend).
- Operator-Entscheidung 25.09.: Start, Resume, Step und Run from line lösen in D6 per Halten aus (Plan, D6).

- Zwei Harness-Fallen: Die seriellen Playwright-Projekte hängen voneinander ab; ein einzelner Spec
  startet sonst alle vorgelagerten Projekte (`--no-deps`). Specs zweier serieller Projekte mit
  `--no-deps` zusammen laufen parallel gegen denselben Mock und stören sich.
- Empfehlung für D6: Start, Resume, Step und der Run-from-line-Button werden Hold-to-fire wie die
  Makros; Pause und Abort bleiben ein Tipp. Operator-Frage vom 25.09.

### WP-D2 — Dialogvertrag · 26. September 2026

**Ein Rahmen:** `DialogFrame.vue` ist jedes Overlay (22 Stück, vorher 22 Schließwege). Er übernimmt Rolle
und Namen, Stufe, Registry und Stapel, Initialfokus laut Anhang B, die bewachte Fokusrückgabe und eine
Schließregel je Art (info, confirm, form, host, flow, dazu `busy`).

- **Fokusbereich (UI-D01):** Tab erreicht nur den obersten Dialog, seine eigene Eingabehilfe, die
  Safety-Leiste sowie Abort und Acknowledge im Banner. Kein `inert`, kein natives `<dialog>`.
- **Pause statt Kontextende (UI-D06):** Öffnet sich ein Dialog über einem Feld mit offenem Zahlenfeld,
  wird dessen Eingabe als Entwurf abgelegt und kommt danach exakt zurück; `closeKeypadIf` bleibt dem
  echten Kontextende vorbehalten.
- **Regeln N40–N49** beim Umzug angewandt: Werkzeugwechsel Abort links; Formulare und Maschinenabläufe
  ignorieren den Hintergrund; destruktiv = danger unter dem bisherigen Gate, Cancel außerhalb (vorher
  ließen sich Upload-Konflikt, Probe-Reset, Run from line und Werkzeug-Löschen bei geschlossenem Gate
  nicht abbrechen); Titel als Frage mit Objekt; Verb auf dem Button, „This cannot be undone.“;
  Formulare auf `md`; alles teleportiert; Clear All fragt; „Keep editing“.
- **Gefunden:** Der Löschen-Knopf eines Makros hieß nur „Delete“ — er nennt jetzt sein Makro.
- **Wächter:** Dialog-Scan (23 Dialoge + UI-D01 + UI-D06) und Audit `DIALOG_FRAME` (22 Treffer auf dem
  alten Stand).
- Enter im Makroparameterfeld führt bis D6 weiter aus.

### WP-D3 — Reiter und Fokusanzeige · 26. September 2026

**Ein Baustein:** `TabNav.vue` ist jede Reiterleiste: `tablist`/`tab`, ein Tab-Stopp (der ausgewählte
Reiter), manuelle Aktivierung.
- **Tasten:** Links/Rechts in Leserichtung mit Umbruch, Home/End, Hoch/Runter wechseln die Rasterzeile.
- **Kein Jog:** Alle sechs Tasten werden in der Leiste abgefangen. Die globale Tastenbelegung hört auf
  `window` und ignoriert abgefangene Tasten; mit der Standardbelegung joggen die Pfeile.
  Gegenprobe: Ohne das Abfangen sendete ein fokussierter Reiter 16 Jog-Befehle.
- **Panels:** `tabpanel`, benannt über den Reiter.
- **Auswahl ist eine Form, kein Farbton:**
  - Hauptreiter oben gerundet, der gewählte offen zum Inhalt.
  - Unterreiter mit 2-px-Strich.
  - Fokus ist der globale `:focus-visible`-Ring (auch für Slider und Auswahllisten). Beides teilt nie
    ein Signal.
- **Höhe:** `--control-h`, 32 px Desktop bzw. 44 px Touch. Das Token ist aus D4 vorgezogen.

**Migration:**
- **Seitenpanel:** fünf gleich breite Hauptreiter.
- **Probing:** festes 4 × 2-Raster, Reihenfolge Outside · Inside · Angle · Boss/Pocket /
  Ridge/Valley · Surface · Calibrate · Toolsetter.
- **Settings:** acht Unterreiter.
- **HAL:** Pins/Signals/Params als Unterreiter, mit Anzahl im Namen (N51).
- **Run from line:** Die Spindelvorwahl ist eine Optionsgruppe Rev · Stop · Fwd (N50/N14).

**Schmal-Modus** (DR-Entscheidung, Seitenpanel unter 400 px Inhaltsbreite):
- Bereich und Verfahren werden zwei Auswahllisten in einer Zeile. Messung per `ResizeObserver` auf dem
  Seitenpanel (`clientWidth`, Layout-px).
- Der Probing-Zustand liegt jetzt in App (`v-model:view`), damit Raster und Auswahlliste denselben Wert
  zeigen.

**Tabwechsel:** Er sendet nichts. Ein noch laufender Jog (Taste gehalten, Zeiger) stoppt beim Wechsel;
nur dann, weil `stopAllJog` sonst je Achse einen Stopp sendet.

**Neumessung mit Inter** (Codex Runde 1: die DR-Zahlen stammen aus DejaVu). Textbreite + 22 px
Innenabstand:

| Name | Breite |
|---|---|
| Hauptreiter, breitester (Program) | 45 px |
| Verfahren, breitester (Boss/Pocket) | 71 px |

- **Hauptreiter:** passen ab 5 × 67 + 4 × 4 = **351 px**.
- **Raster:** passt ab 4 × 93 + 3 × 4 = **384 px**. Die Schwelle 400 px bleibt mit Reserve.

| Zustand | Panel innen | Navigation | Probing-Inhalt |
|---|---|---|---|
| Desktop 1600×1000 | 522 × 568 | Reiter + Raster | 460 px |
| Touch quer 1280×800 | 522 × 366 | Reiter + Raster | 222 px (DR-Ansatz 215) |
| Touch hoch 900×1200 | 570 × 506 | Reiter + Raster | 362 px |
| Touch hoch 150 % | 271 × 289 | zwei Auswahllisten | 249 px (DR-Ansatz 237) |

**Wächter:**
- `e2e/tabs.spec.ts` (serial-guards, 7 Tests):
  - Rollen und ein Tab-Stopp.
  - Pfeile ohne Auswahl und ohne Jog, jeweils mit Kontrollfall am unfokussierten Dokument.
  - Rasterzeilen.
  - Tabwechsel ohne Befehl, laufender Jog stoppt.
  - Verborgene Panels nicht fokussierbar.
  - Spindelvorwahl.
  - Schmal-Modus.
- `layout.spec`, vier DR-Zustände:
  - Reiter oder Auswahllisten wie erwartet.
  - Kein abgeschnittener Name.
  - Höhe = `--control-h`.
  - Probing-Inhalt ≥ 3 × 70 px.

**Gefunden:** Die 3D-Beschriftungen riefen `sync()` ohne Rückruf auf. Der Viewer zeichnet nur bei
Bedarf neu, deshalb erschienen ihre Glyphen erst mit dem nächsten fremden Bild, etwa einer
Kameradrehung. Der Offline-Test des Viewers fiel dadurch etwa jedes vierte Mal aus. Jetzt fordert
jede Beschriftung beim Abschluss ein Bild an (`93387e9`); danach 12/12 grün.

**Gates:**
- `npm run build` und `npm run lint` (inkl. CSS-Audit): grün.
- Vitest: **1623/1623**.
- Playwright, alle Projekte einzeln: **228/228** nach der Beschriftungskorrektur. `serial-guards` 98,
  `serial-layout` 55; die Referenzbilder sind unverändert, 10/10.

### WP-D4a — Kontrollhöhe, FormField, Probing- und Toolsetter-Formulare · 26. September 2026

**Eine Höhe je Dichte (K03):**
- `--control-h` gilt für Felder (`.inputField`: Eingabe und Auswahlliste), Reiter und die mittleren
  Text-Buttons im Seitenpanel und in Dialogen: 32 px am Desktop, 44 px auf Touch.
  - **Ausnahme Icon-Buttons:** Das X im Dialogkopf behält seine Größe. Mit 32 px wuchs jeder
    Dialogkopf um 4 px, und Settings blieben bei 1280×720 nur 67 px Inhalt; die Dialogstapel-Tests
    erreichten „Add Macro“ nicht mehr.
- Die 44 px auf Touch hat der Operator am 26.09. mit den gemessenen Kosten entschieden:
  - Der Werkzeug-Dateibrowser zeigt bei 1280×800 4,11 statt 4,83 Zeilen; die Untergrenze in
    `layout.spec` ist jetzt vier Zeilen.
  - Der Probing-Rasterbereich ist auf Touch 368 px hoch; das Maßfeld unter dem Angle-Raster braucht
    367 px.
- **Kompakt (28/36 px) wählt ein Bereich:** `.strip` und `.dataTable` setzen `--control-h` auf den
  kompakten Wert, alle Controls darin folgen.
- Die Größenstufen des Katalogs (`INPUT_SIZE_STYLES`, Inline-Paddings) sind entfernt.
  - Das DRO-Feld der Setup-Leiste ist `density: 'compact'`; seine Referenzbilder sind pixelgleich.
  - Die eigenen Button-Größen der Leiste bleiben bis D6.
  - Das Drehzahlfeld der Spindelleiste ist jetzt 32 statt 36 px hoch, gleich hoch wie seine
    +/−-Buttons.

**`FormField.vue` + `.formGrid` (K04/K10):**
- **Label über dem Feld**, verknüpft über `for`/`id`. Ein Tipp aufs Label ist ein Tipp aufs Feld;
  ein Zahlenfeld öffnet sein Keypad.
- **Das „?“ steht neben dem Label, nie darin.** In einem `<label for>` würde ein role=button zum
  Feldnamen gehören. Die alten Probing-Labels enthielten sogar den Hilfetext selbst.
- **Einheit:** rechtsbündig in der Kopfzeile über dem rechtsbündigen Wert. Einheit und Fehler sind die
  Beschreibung des Felds (`aria-describedby`); das Keypad zeigt „Slow Feed · mm/min“.
- **Inline-Variante:** Label, „?“, Feld und Einheit in einer Zeile. Nur wo ein fester Bereich eine
  Zeile hat: die Richtmaße unter dem Probing-Raster (Feldbreite 72 px, damit drei Felder auf Touch
  in 522 px passen: 513 px).
- **Zwei gleich breite Spalten, solange jede `--form-col-min` behält, sonst eine.** Gemessen mit
  Inter: der breiteste Kopf ist „Spindle Zero Height ? mm“ mit 149 px (Desktop) bzw. 156 px (Touch),
  also 160 px. Zwei Spalten bei 522/570 px, eine bei 150 % Hochformat (271 px).

**Probing und Toolsetter als Daten** (`probeFields.ts`):
- Die gemeinsamen Parameter standen doppelt im Code; jetzt eine Tabelle.
- **Einheiten** (aus D0 hierher verschoben): Längen und Vorschübe aus der Linear-Einheit der
  Maschine, ein Anteil in %, Zähler und Werkzeugnummern ohne Einheit.
- Werkzeugnummer, Messpunktzahl und Wiederholungen nehmen nur ganze Zahlen an (das Keypad lehnt 2,5
  ab).

**Weitere Namen (K10):**
- Jog- und Override-Regler, mit Wert und Einheit als `aria-valuetext`.
- Das Drehzahlfeld.
- Die Typ- bzw. Gruppenfilter von Werkzeugtabelle und G-Code-Referenz standen als namenlose,
  16 px hohe Auswahlliste mit `outline: none` im Tabellenkopf. Sie stehen jetzt in der Suchzeile
  (K07-Teil aus D5 vorgezogen).

**Wächter:**
- `e2e/forms.spec.ts` (serial-guards), Desktop und Touch:
  - Jedes sichtbare Feld hat einen Namen, jedes sichtbare Label benennt ein Control.
  - Eine Höhe je Dichte.
  - Die Einheit steht in Beschreibung und Keypad-Anzeige und wechselt mit der Maschine von mm zu in.
  - Ein Zähler lehnt 2,5 ab.
- Gegenproben, alle rot: Label ohne `for`, Feld ohne Mindesthöhe, namenloser Regler, Einheit nicht
  beschrieben.
- `src/probeFields.test.ts`: Hilfetexte ≤ 120 Zeichen, eindeutige Labels, die Einheitenregel, die
  Vorschubnamen des Glossars in beiden Formularen.

**Gates:**
- `npm run build` und `npm run lint` (inkl. CSS-Audit): grün. Vitest: **1627/1627**.
- Playwright, alle Projekte einzeln: **231/231**.
  - `serial-guards` 101 (davon `forms` 3); `serial-layout` 55.
  - Dialoge, Forms, Layout und Referenzbilder liefen nach der Icon-Korrektur erneut. Die übrigen
    Projekte liefen davor; die Korrektur macht nur Icon-Buttons wieder so groß wie vor D4a.
- **Referenzbilder:** Die 4 Werkzeugeditor-Bilder wurden nach Sichtprüfung erneuert: Felder und
  Buttons 28 → 32 px bzw. auf Touch 36 → 44 px, sonst unverändert. Die Leisten-Bilder sind
  pixelgleich.

### WP-D4b — die übrigen Formulare auf FormField · 26. September 2026

**Werkzeugeditor (K04):**
- Ein `.formGrid` für beide Abschnitte, dieselben Spaltenachsen.
- Das sichtbare Label ist der zugängliche Name, ausgeschrieben („Flute Length“, „Length Below
  Holder“).
- Einheiten stehen fest im Feldkopf statt als Platzhalter („mm“, „°“).
- Typ, Beschreibung und Halter gehen über beide Spalten.
- Die Importart im Import-Dialog ist ein FormField. Bisher umschloss ein Label die Auswahlliste, dadurch
  gehörte der gewählte Eintrag zum Namen.

**Settings:**
- **Kamera-Overlay:** Radius, Rasterabstand, Deckkraft und Farbe sind Formularfelder. Der Kopf eines
  Reglers zeigt seinen Wert dort, wo ein Feld seine Einheit zeigt.
- **Farbwähler:** Jeder ist über sein Label benannt. Der Zurücksetzen-Button einer Maschinenfarbe bleibt
  außerhalb des Labels, sonst gehörte er zum Namen des Wählers.
- **Run from line:**
  - Die Warnung ist eine `.statusNote.warn` (N66).
  - Die Vorwahl ist eine benannte Gruppe, die Drehzahl ein Feld mit RPM.
  - Das Wort ist „Stop“ wie im Dialog und in der Leiste.
- **Makro-Editor:** Name und Befehl sind FormFields.
- **Gamepad:** Die Totzone ist ein Formularfeld; die Auswahllisten der Zuordnungstabelle heißen
  „<Taste> action“.

**Dialoge:** Makro-Parameter, Umbenennen beim Upload und die Drehzahl im Run-from-line-Dialog sind
FormFields. Enter in einem Makro-Parameter führt bis D6 weiter aus.

**Entfernt:**
- `.paramGrid`: nicht mehr benutzt.
- `.sliderVal`.
- Die scoped Regeln `.inputLabel`, `.camOverlay*`, `.rfl*` und `.macroParamLabel`.

**Tests:** Die e2e-Selektoren, die ein Feld als „das Input nach diesem Label“ fanden, finden es jetzt
über seinen Namen. Das ist genau die Verknüpfung, die K10 verlangt.

**Wächter:**
- `forms.spec` prüft zusätzlich Werkzeugeditor, Import-Vorschau, Makro-Parameter und jeden
  Settings-Abschnitt: Makro-Editor offen, Run from line an, Gamepad-Tasten an.
- Er läuft in den DR-Fenstern: 1600×1000 bzw. Touch 1280×800. Im Playwright-Standardfenster
  1280×720 bleibt der Werkzeugtabelle auf Touch mit den 44-px-Kopfzeilen kein Platz; das liegt
  außerhalb der DR-Matrix.
- Gegenprobe: Ein Farbwähler ohne Label macht ihn rot.

**Gates:**
- build und lint grün; Vitest **1627/1627**.
- Playwright, alle Projekte einzeln: **232/232**.
  - `serial-guards` 101: Im ersten Gesamtlauf fielen `forms` (zweimal) und ein Werkzeugeditor-Test
    aus. Der Werkzeugeditor-Test suchte noch die entfernte ID `#tool-description` und ist korrigiert.
    `forms` ließ sich einzeln und im Verbund nicht reproduzieren (101/101 im Wiederholungslauf). Der
    Test setzt den Mock nicht mehr auf „quiet“, eine bekannte Ursache für Verbindungsabbrüche bei
    langen Tests; danach dreimal hintereinander 9/9.
- **Referenzbilder:** Die 4 Werkzeugeditor-Bilder wurden nach Sichtprüfung erneuert (ein Raster,
  Einheiten im Kopf); die übrigen sind unverändert.

### WP-D4c — Zurücksetzen und Listen-Editoren · 26. September 2026

**Zurücksetzen (N65):**
- **Ein Platz:** am Ende des eigenen Abschnitts, rechtsbündig (`.resetRow`, jetzt global).
- **Eine Rückfrage.**
- **Die Rückfrage behält das Gate ihres Buttons.**
  - Toolsetter: Die Rückfrage stand bisher auf `safety`, der Button auf `setup`.
  - Kalibrierung: Die Rückfrage stand auf `ready`, der Button auf `probe`.
  - Ein „Reset“ blieb in einer offenen Rückfrage bedienbar, nachdem die Maschine die Klasse des Buttons
    geschlossen hatte.
  - Jetzt `setup` bzw. `probe`. Das ist die einzige Gate-Änderung, und sie verschärft.

**Listen-Editoren:**
- **Zeilenaktionen (N67):**
  - Stift und `Trash2` der Werkzeugtabelle sehen aus wie jede andere Zeilenaktion, mit dem
    `setup`-Gate der Aktion (`listActionSetup`).
  - Sie nennen ihr Ziel („Edit T5“, „Delete T5“).
  - Löschen fragt weiter nach, weil eine Werkzeugzeile nicht wiederherstellbar ist.
- **Spaltenreihenfolge (N68):** Beide Belegungstabellen lesen Aktion | Belegung. Eine Kopfzeile wurde
  wieder entfernt: Der klebende Tabellenkopf von `.dataTable` verdeckte in der scrollenden
  Settings-Seite die oberste Zeile, und die Speicherstatus-Tests erreichten die Tastenzelle darunter
  nicht mehr.
- **Eine Namensliste (N69):**
  - `INPUT_COMMAND_LABELS` speist beide Tabellen.
  - Die Schalter heißen in beiden Reitern „Enable … jogging“ / „Enable … commands“.
  - Die Aufteilung bleibt bewusst verschieden: Die eine Cycle-Taste der Tastatur wechselt zwischen
    Start, Pause und Fortsetzen; das Gamepad hat je eine Taste. Was eine Taste tut, ist keine
    Layout-Frage.
- **Gamepad-Umkehr (N70):** nur für die Stick-Achsen, die die Maschine hat (`useAxes`).
- **Hinzufügen und Profil entfernen (N71):**
  - „Add Macro“ hat dieselbe Größe wie „Add“ bei den Werkzeugen.
  - „Remove Profile“ hat einen eigenen danger-Typ mit unverändertem Gate `always`.

**Offen, notiert:** Eine Tastenbelegung wird über einen Klick auf die Tastenzelle (`td`) erfasst, die
die Tastatur nicht erreicht. Ein Button daraus berührt die eigene Space/Enter-Behandlung der Erfassung
direkt neben der E-Stop-Taste und braucht einen eigenen Wächter.

**Wächter:**
- Zwei Tests in `forms.spec`: die Reset-Regel und die Listen-Editoren.
- Gegenproben, alle rot: Rückfrage mit dem alten, lockereren Gate; Umkehr fest auf X/Y/Z; Löschen
  wieder mit dem Reset-Typ.
- Kontrollhöhen je Dichte misst `forms.spec` (Desktop und Touch), nicht `layout.spec` wie im Plan
  genannt; `layout.spec` misst weiter das Navigationsbudget und die Formularzeilen.

**Nachmessung mit den echten Formularen** (Codex Runde 3: die DR-Zahlen mit der echten D3/D4-Navigation
und den echten Formularen wiederholen):

| Zustand | Feldhöhe (Label + Feld) | Abstand der Zeilen | Probing-Inhalt | ganze Zeilen |
|---|---|---|---|---|
| Desktop 1600×1000 | 51 px | 58 px | 459 px | 7,9 |
| Touch quer 1280×800 | 66 px | 74 px | 211 px | **2,95** |
| Touch hoch 900×1200 | 66 px | 74 px | 361 px | 4,9 |
| Touch hoch 150 % | 66 px | 74 px | 241 px | 3,4 |

- Die DR hatte 70 px je Zeile einschließlich Abstand angenommen. Auf Touch sind es 74 px, weil das „?“
  (20 px) die Label-Zeile höher macht als ihren Text.
- **Verbindlich waren drei Zeilen bei 150 % Hochformat; das ist erfüllt.** Für Touch quer nannte die DR
  „rund 3“. Es sind 2,95: Der dritten Zeile fehlen 3 px.
- **Behebung in D6:** Dort wird die Trefferfläche des HelpIcons unsichtbar vergrößert (Plan WP-D6).
  Danach bestimmt der Text die Höhe der Label-Zeile, und drei Zeilen passen.
- `layout.spec` rechnet jetzt mit der gemessenen Feldhöhe statt mit der angenommenen Konstante. Die
  geforderte Zeilenzahl steht je Zustand im Test: 3, bis D6 für Touch quer 2,9.

**Gates:**
- build und lint grün; Vitest **1627/1627**.
- Playwright, alle Projekte einzeln: **233/233**.
  - `serial-guards` 103 und `serial-layout` 55 nach der letzten Änderung erneut.
  - Die übrigen Projekte liefen davor. Die letzte Änderung (Kopfzeilen der Belegungstabellen entfernt)
    berührt sie nicht.
- **Referenzbilder:** unverändert, 10/10.

### WP-D5a — ein Muster für die Köpfe der Tabs · 26. September 2026

**Muster** (`.panelHead`, `.panelObject`, `.actionGroup` in style.css). Jeder Tab ordnet seine Teile in
einer Reihenfolge, jede Zeile optional, keine Karte um eine Gruppe:
1. Objektzeile: worauf der Tab wirkt und sein Zustand.
2. Maschinenaktionen, **Abort als letzter Button am rechten Rand** (N80). Das ist der eine Platz über
   Program, MDI, Probing und Tools.
3. Verwaltung.
4. Suche/Filter.
5. Inhalt.
6. Inline-Rückmeldung.

**Plan vor K05-Wortlaut:** Der Plan (Fassung 3) nummeriert Objekt, Maschinenaktionen, Verwaltung; der
K05-Vorschlag nennt Objekt und Verwaltung vor der Ausführung. Umgesetzt ist die Plan-Reihenfolge, weil
der Plan das vereinbarte Dokument ist.

**Was sich für den Bediener verschiebt:**
- **Program:**
  - Edit / Reload / Unload / Files / Upload stehen jetzt unter Start / Step / Pause / Abort.
  - M01 und /BD stehen links von Abort (bisher rechts davon).
  - „File:“ entfällt; der Programmname ist die Objektzeile.
- **Tools:** „In spindle · T5 · Beschreibung“ mit dem Probe-Zustand in der Objektzeile, dann Measure /
  Unload / Abort, dann Add / Files / Upload.
- **Ein Umschalter „Files“** (N82) statt eines Buttons mit zwei Namen („Browse“ / „Hide Files“).
  Gedrückt (`aria-pressed`, ausgewählte Optik), solange der Browser zu sehen ist; in Program und Tools.
- **Offsets** behält seine eine Kopfzeile (Titel links, Clear rechts). Es hat keine Maschinenaktion,
  die Zeile ist bereits Objekt plus Verwaltung.

**Gefunden durch den neuen Wächter:**
- Bei 150 % Hochformat (271 px) brauchte die Program-Steuerzeile 489 px. Abort lag schon vor D5
  außerhalb des Panels.
- Eine Container-Abfrage ordnet die Zeile unter 400 px in zwei Spalten: die Laufoptionen oben, dann
  Start · Step, dann Pause · Abort.

**Wächter:**
- `layout.spec` prüft in allen vier DR-Zuständen:
  - Jeder Tab mit Abort hat genau einen, am rechten Rand seiner Aktionsgruppe.
  - Rechts davon liegt nichts Bedienbares in derselben Zeile.
  - Die Kopfzeilen halten die Reihenfolge Objekt → Maschinenaktionen → Verwaltung.
- Gegenprobe: Abort vor den Laufoptionen (die alte Reihenfolge) macht ihn rot.

**Gates:**
- build und lint grün.
- Playwright, alle Projekte einzeln: **237/237**.
  - `serial-layout` 59, davon 4 neue Tests; Chromium 7.
  - Beide liefen nach der letzten Korrektur erneut: Die Objektzeile hatte eine Mindesthöhe, die dem
    Werkzeug-Dateibrowser auf Touch eine halbe Zeile nahm.
  - `frames.spec` fiel im ersten Gesamtlauf einmal aus; einzeln und im Wiederholungslauf grün.
- **Referenzbilder:** unverändert, 10/10.

### WP-D5b — Werkzeugtabelle und ein Leerzustand · 26. September 2026

**Werkzeugtabelle (K07):**
- **Erkennen zuerst:** T#, Beschreibung, dann Ø, Z Offset und Typ. Pocket und Flutes sind aus der
  Tabelle genommen; der Editor zeigt sie.
- **Kein seitliches Scrollen mehr:**
  - Die Beschreibung bricht in dem Platz um, den die Zahlen lassen. Ihre Untergrenze von 200 px machte
    die Tabelle 595 px breit im 522-px-Panel, und die rechts angehefteten Zeilenaktionen verdeckten die
    letzte Spalte.
  - Zahlenspalten sind so breit wie ihr Inhalt.
- **Geladenes Werkzeug:** Es trägt eine Marke in seiner T#-Zelle (CircleDot, benannt „In spindle“),
  nicht nur die Zeilenfarbe.
- **Sortierung:** Die sortierbaren Köpfe melden ihre Richtung über `aria-sort`, nicht nur als Pfeil.

**Ein Leerzustand (N83/N84):**
- `.emptyState` mit `.noMatch`, `.loading` und `.error`.
- Die lokalen Kopien nutzen ihn und behalten nur ihren Innenabstand: MDI-Verlauf, Meldungen, Referenz,
  HAL, Settings-Laden, Makroliste, Dateibrowser.
- Die Werkzeugtabelle sagt, was vorliegt: „Loading tools…“, „No tools in the table …“ oder „No tools
  match the search.“. Eine Suche ohne Treffer ist keine leere Tabelle.

**Wächter:** Der Test „tool table“ in `forms.spec` prüft:
- Laden → leer → Zeilen nach einem `tool_table_changed`-Rahmen.
- Die Spaltenreihenfolge.
- `aria-sort` über zwei Sortierungen.
- Genau eine Spindel-Marke, in der geladenen Zeile.
- Die Zeile für „keine Treffer“.

Gegenproben, beide rot: ohne `aria-sort`; „keine Treffer“ als „leer“ formuliert.

**Gates:**
- build, lint und Vitest (1627) grün.
- Playwright: **238/238**, `serial-guards` 104, `serial-layout` 59.
- `frames.spec` (Chromium) fiel in beiden D5-Gesamtläufen aus. Ursache ist die Test-Umgebung, kein
  Produktfehler:
  - `frames` erwartet den Ausgangszustand des Mocks und setzt ihn nicht zurück.
  - Meine Mess-Skripte liefen jeweils kurz vorher und hinterließen fünf Achsen und ein Werkzeug.
  - Nachgewiesen: mit verändertem Mock 1 Fehler, nach dem Zurücksetzen 3/3.
  - Die Gate-Läufe setzen den Mock jetzt zuerst zurück.
- **Referenzbilder:** unverändert, 10/10.

### WP-D5c — die Kopfzeile · 26. September 2026

**K06:**
- **Eine Höhe und eine Icongröße** für alle Kopf-Buttons.
- **Shutdown** behält seine Beschriftung (ein Icon allein ist auf Touch nicht erkennbar), jetzt neben
  dem Icon. Gestapelt war es der eine hohe Button (86 × 47 px neben 38 × 34); jetzt 106 × 34 px.
- **Stil-Regel:** Die Klasse, die ihn stapelte, gestaltete das Innere eines MachineBtn (gegen die
  Platzierungsregel). Icon-Buttons halten Icon und Beschriftung jetzt selbst auseinander (`.b-icon`
  gap).
- **Zustände vs. Diagnose:**
  - In der Zeile bleiben die Betriebszustände: Uhr, WS, LinuxCNC, ARMED, Eingabe-Symbole.
  - Clients und die beiden Latenzen liegen hinter einem benannten Button „Connection details“
    (`DetailsPopover.vue`). Das ist ein natives Popover in der gemeinsamen `.helpPopover`-Karte, wie
    HelpIcon platziert, ohne Dialog-Rolle.

**Wächter:**
- `layout.spec` prüft Desktop und Touch-Hochformat:
  - eine Button-Höhe und Icongröße;
  - die Beschriftung neben dem Icon;
  - Zustände in der Zeile, Diagnose nur in der Karte;
  - die Karte innerhalb des Fensters.
- Gegenprobe: Shutdown wieder gestapelt macht ihn rot.
- `frames.spec` liest die Latenz jetzt in der Karte.

**Gates:**
- build, lint und Vitest grün.
- Playwright: **242/242** mit zurückgesetztem Mock; `serial-guards` 106, `serial-layout` 61.
- **Referenzbilder:** Die 4 Werkzeugeditor-Bilder wurden nach Sichtprüfung erneuert. Die niedrigere
  Kopfzeile gibt dem Dialog 14 px mehr Höhe; sonst ändern sich nur der Scrollbalken und der untere
  Rand des Scrollbereichs.

### WP-D6a — Bewegung starten heißt halten · 26. September 2026

Operator-Entscheidung vom 25.09. und Plan WP-D6 (UI-D02, N95).

**Programmsteuerung:**
- Start, Step und Resume sind Hold-to-fire. Der Hold-Schlüssel ist das geladene Programm.
- Pause und Abort halten Bewegung an und bleiben Tipps; der Space-Shortcut bleibt sofort wirksam
  (Folgepunkt K13).
- Ist Run from line an und eine Zeile gewählt, öffnet Start nur den Dialog. Das ist keine Bewegung, also
  ein Tipp. Gehalten wird die Aktion im Dialog; ihr Hold-Schlüssel ist Programm plus Zeile.

**Makros:**
- **Ohne Parameter:** Der Button in der Makroleiste ist die Hold-Aktion, gebunden an Id und Befehl.
  Speichert ein anderer Client während des Haltens unter derselben Id einen anderen Befehl, bricht das
  Halten ab („Selection changed — hold again“). Der nächste volle Hold führt genau den sichtbaren
  Befehl einmal aus.
- **Mit Parametern:** Ein Tipp öffnet den Dialog. Execute (`macroExecute`, Gate `probe`) ist die
  Hold-Aktion, zusätzlich an die Werte gebunden.
- **Enter** im Parameterfeld springt zum nächsten Feld und vom letzten zu Execute. Es führt nie aus;
  bisher sandte es das Makro.
- **Gate:** Der Makro-Versand prüft die Klasse seines Buttons. `useMacros` sandte mit `ready`,
  während der Katalog den Button mit `probe` sperrt; jetzt ist es in beiden `probe`. Das ist die
  einzige Gate-Änderung der Welle, und sie verschärft (N95).
- Keine Ruhemarke (Operator-Entscheidung 26.09.): Beim Halten läuft die Füllung, ein Tipp sagt
  „Hold to activate“.

**Wächter:**
- `e2e/run-hold.spec.ts` (serial-guards, 4 Tests).
- Gegenproben, alle rot: Start und Step als Tipp; Makro-Schlüssel ohne Befehl; Enter führt aus;
  Run-from-line-Aktion als Tipp.
- Zwei Gegenproben brachen zunächst den Build (unbenutzte Funktion) und liefen deshalb gegen den alten
  Stand. Sie wurden so wiederholt, dass sie bauen.

**Gates:**
- build, lint und Vitest (1627) grün.
- Playwright **246/246**; `serial-guards` 110.
- **Referenzbilder:** unverändert, 10/10.

### WP-D6b — Leisten, Beschriftungen und das Ziel des „?“ · 26. September 2026

**Zuerst gemessen** (Leistentitel, Beschriftungsgrößen, Doppelpunkte, Safety-Details in drei Zuständen):
- **N91:** Kein Leistentitel dunkelt mehr mit seinem Gate ab (wirksame Deckkraft 1 in „homed“,
  „E-Stop“ und „disarmed“). Offen war nur die dreifach kopierte 280-px-Regel; jetzt ein Token
  (`--strip-fixed-w`) und eine Klasse (`.stripFixed`, im Hochformat volle Breite).
- **N96** (Safety-Details im Touch-Hochformat abgeschnitten) war am 25.09. behoben; gemessen ist
  nichts abgeschnitten.
- **Doppelpunkte:** keine mehr.

**Umgesetzt:**
- **N90:** Die Jog-Resets zeigen den Zielwert („600“) und heißen „Reset linear jog speed to
  600 mm/min“, wie die Override-Resets („100 %“).
- **N92:** Eine Beschriftung hat die Größe einer Überschrift: `.label-muted` 11 px statt 9 bzw.
  10 px.
- **N93:** `.sectionHelp` ist global statt zweimal scoped.
- **N94:** Das Plane-Radio nutzt nur Farbmodifikatoren (`.text-warn`, `.text-muted`, aus N112
  vorgezogen). Mit `.val-status` hatte es eine kleinere, fette, rechtsbündige Schrift neben seinen
  Nachbarn geliehen.

**Ziel des „?“ (Plan D6):**
- Die Trefferfläche ist ein **unsichtbares 24-px-Quadrat** um das Zeichen (`::before`, ohne Layout).
- Das sichtbare Zeichen ist auf Touch 16 statt 20 px und bleibt in der Zeilenhöhe seines Labels.
- Folge: Ein Formularfeld ist auf Touch 63 statt 66 px hoch, die Zeilen stehen 70 px auseinander
  (die DR-Annahme). Das 1280×800-Touch-Panel zeigt 3,4 Probing-Zeilen; die Untergrenze in
  `layout.spec` ist wieder 3.
- **Der neue Test fand einen Fehler:** Die Fläche liegt im Innenkasten des Zeichens (innerhalb des
  1-px-Rands). Ein Abstand vom äußeren Maß ergab 22 statt 24 px. Jetzt
  `inset: calc(50% - var(--help-hit) / 2)`.

**Wächter:**
- `touch-surface.spec`: Ein Druck 11 px neben der Mitte trifft das „?“, die Fläche misst 24 px, die
  Label-Zeile ist so hoch wie ihr Text.
- Gegenproben, beide rot: ohne Fläche; Touch-Zeichen wieder 20 px.

**Referenzbilder:** Jog- und Setup-Leisten wurden nach Sichtprüfung erneuert. Die Beschriftungen sind
11 px, die Resets zeigen ihre Werte, und das Touch-„?“ ist kleiner. Die Jog-Sektion ist am Desktop bis
zu 21 px breiter; die scrollende Leiste nimmt das auf. Im Touch-Hochformat brechen die Schrittweiten
nach drei statt vier Werten um.

**Gates:**
- build, lint und Vitest (1627) grün.
- Playwright **247/247**; `serial-guards` 111 und `serial-layout` 61.
- Die Guards liefen nach der Korrektur der Trefferfläche erneut.


### WP-D7 — Eingabehilfen · 26. September 2026

**Zuerst gemessen** (beide Hilfen, Quer- und Hochformat):
- **X:** Das Zahlenfeld hatte das X im Querformat oben rechts, aber 70 px breit, im Hochformat unten
  links. Die Texttastatur hatte es im Querformat unten rechts, im Hochformat schon oben rechts.
- **Code-Seite:** Kein Ziffernblock. Das Querformat las spaltenweise, das Hochformat zeilenweise;
  auch ABC lief im Querformat die Spalten hinab.
- Kein Test prüfte die Position des X, und für das Zahlenfeld gab es keine 150-%-Prüfung.

**Umgesetzt:**
- **X oben rechts, 44 × 44, überall** (Operator-Entscheidung 4):
  - Das **Zahlenfeld** führt seine Anzeige als erste Rasterzeile mit dem X rechts daneben.
  - Querformat: Discard, ═ und Apply (zwei Zeilen hoch, wie Enter der Texttastatur) bilden die
    sechste Spalte. Hochformat: Discard (2), ═ und Apply (2) bilden die unterste Zeile.
  - Im Querformat sind beide Hilfen nun fünf Tastenzeilen hoch (236 px unter dem Titel). Gemessen
    sind beide 264 px, auf dem Desktop wie auf Touch.
  - Die **Texttastatur** setzt das X an den Kopf ihrer Seitenleiste bzw. das Ende ihrer Seitenzeile.
  - Die DOM-Reihenfolge bleibt; das X bleibt letzter Tab-Stopp.
- **Seiten zeilenweise, Code-Seite in Blöcken** (`codePage(axes, cols)`):
  - Links der Ziffernblock 7 8 9 / 4 5 6 / 1 2 3 / 0 . -.
  - Daneben, im Hochformat auch darunter, der Buchstabenblock: G M T F S, die Achsen, die Füllung.
  - Danach ; ( ) #.
  - Innere Lesereihenfolge in beiden Ausrichtungen gleich; ABC liest a b c … über die Zeilen.
- **150 % im Hochformat verdeckt das Besitzerfeld nicht:**
  - Das Zahlenfeld für ein DRO-Feld der Setup-Leiste schob die bearbeitete Zeile unter die klebende
    Safety-Sektion, sobald die Spalte das ganze Zahlenfeld zeigte. Zero All, Go-to und der WCS-Block
    lagen dazwischen. Das bestand schon vor D7 und fiel dem neuen Wächter auf.
  - Jetzt behält Setup im Hochformat, solange sein Zahlenfeld offen ist, nur die Achszeilen. Zum
    Umspringen zwischen Feldern bleiben sie bedienbar. Das folgt dem Muster der Texttastatur, die
    alle Sektionen außer Safety ersetzt.
  - Gemessen: Bis sechs Achsen bleiben erste und letzte Achse im Blick.
  - **Grenze:** Bei neun Achsen und 150 % gerät die erste Zeile unter die Safety-Sektion.
- **Harness-Falle:** Der erste Touch einer Sitzung schaltet auf Touch-Maße. Die Leiste springt unter
  dem Finger, und ein Tipp auf ein DRO-Feld im Hochformat traf daneben. Die Tests schalten deshalb
  zuerst mit einem neutralen Tipp um.

**Wächter** (`input-session.spec`, Touch):
- X-Anker in vier Kombinationen (zwei Hilfen × zwei Ausrichtungen, Code und ABC): 44 × 44, kein
  Control darüber oder rechts davon.
- Code-Seite in beiden Ausrichtungen: 7 8 9 / 4 5 6 / 1 2 3 / 0 . - als Block. Die Buchstaben lesen
  G M T F S X Y Z I J K P R Q, ABC liest a–z ä ö ü ß.
- Zahlenfeld bei 100 % und 150 % im Hochformat, mit einem Feld der Leiste und einem Feld des
  Seitenpanels als Besitzer: Tasten ≥ 44 px, Zahlenfeld im Viewport, Besitzerfeld sichtbar und im
  Hit-Test nicht verdeckt; dazu erste und letzte Achse bei sechs Achsen.
- `textKeyboardPages.test`: die Blöcke in beiden Breiten und dieselbe Reihenfolge.
- **Gegenproben:** Am alten Stand sind X-Anker und Code-Block rot. Ohne das Einklappen der
  Setup-Zeilen ist der 150-%-Fall rot („owner field is not covered“).

**Gates:**
- build, lint und Vitest (**1635**) grün.
- Playwright **260/260** über alle neun Projekte; `serial-guards` 122 und `serial-layout` 63.
- Der Strip-State-Test (`layout.spec`) nimmt im Hochformat für „keypad-setup“ die Achszeilen der
  Setup-Sektion als Referenz statt der ganzen Sektion. Ihre Controls stehen weiterhin exakt am Platz,
  der Rahmen ist unverändert. Das Einklappen ist die beabsichtigte Änderung.
- Keine Referenzbilder geändert (keines zeigt eine Eingabehilfe).

### WP-D8b — Bewegung und erzwungene Farben · 26. September 2026

D8 kommt in drei Commits: D8b (Bewegung, erzwungene Farben), D8a (Textrollen, Syntax, Fokusring,
mit einem Kontrast-Scan über die vier Themes), D8c (Viewer-Palette, Legende, Farbmigration).

**Zuerst gemessen:**
- Der Status-Banner pulst im Ruhezustand (idle, unhomed, Werkzeugwechsel, Vorschau). Er dimmte dabei
  seine **ganze** Fläche auf 50 % Deckkraft, den Text eingeschlossen. `pulse-warn` (Messages mit
  ungelesenen Meldungen, Neustart im Gamepad-Assistenten) tat dasselbe mit dem ganzen Knopf.
- Es gab keine Regel für `prefers-reduced-motion` oder `forced-colors`. `layout-fixtures` emuliert
  zwar schon reduzierte Bewegung, aber nichts reagierte darauf.
- `@keyframes flash-warn` war tot. `animation: pulse` im Probing-Raster lief ins Leere, weil es
  keine Keyframes dazu gab; die Zelle hat nie gepulst.

**Umgesetzt:**
- **Puls ohne Textdimmung:** Banner und Warnknöpfe pulsen über den Hintergrund, der Text bleibt voll
  deckend.
- **Reduzierte Bewegung:** Banner-Puls, Banner- und E-Stop-Blinken, Warnpuls und der Probing-Punkt
  stehen still. Der Zustand bleibt als statische Füllung sichtbar (beim Blinken die „An“-Farbe).
- **Erzwungene Farben** (Windows-Hochkontrast), bei denen Hintergründe und Schatten entfallen:
  - Eine Auswahl nimmt die Systemfarben des gewählten Elements (`SelectedItem`). Das betrifft die
    Form des Reiters und gedrückte Seitenknöpfe.
  - Der Status-Banner bekommt einen Rahmen.
  - Der Fokusring bleibt ohnehin erhalten.
- Die tote `flash-warn` ist entfernt, ebenso die wirkungslose Animation im Probing-Raster. Deren
  Aussehen bleibt, wie es der Operator kennt: die statische Warn-Tönung.

**Wächter** (`appearance.spec`, neu in `serial-guards`):
- Deckkraft des Banners über eine Pulsperiode: immer 1; der Hintergrund bewegt sich.
- Unter reduzierter Bewegung (idle und E-Stop): Banner, E-Stop-Knopf und Probing-Punkt ohne
  Animation, die Füllung trägt den Zustand.
- Unter erzwungenen Farben: Fokusring ≥ 2 px, der gewählte Reiter unterscheidet sich von den
  anderen, der Banner hat einen Rahmen.
- Alle drei Tests waren am Stand vor der Korrektur rot.

**Gates:**
- build, lint und Vitest (**1635**) grün.
- Playwright **263/263** über alle neun Projekte; `serial-guards` 125 (drei neue Tests) und
  `serial-layout` 63. Die Referenzbilder in `serial-visual` sind unverändert grün; der Hintergrundpuls
  steht dort still, weil `layout-fixtures` reduzierte Bewegung emuliert.

### WP-D8a — Textrollen, Syntax, Fokusring · 27. September 2026

**Ausgangslage** (Scan rot am Stand vor der Korrektur): `contrast.spec` misst jeden sichtbaren Text
gegen das, was hinter ihm gerendert ist. Unter 4,5:1 lagen im Theme light 761 Texte, in dark 172, in
hc-light 84, in hc-dark 42 und in „Automatisch“ bei dunklem System 172.
- **Gedämpfter Text über Deckkraft** oder über `color-mix(currentColor 60 %)`: 3,6:1 im hellen Theme.
  Betroffen waren Labels, Abschnittstitel, Einheiten, Beschreibungen, Zeilennummern, nicht gewählte
  Reiter, Tabellenköpfe und die Beschriftung der Kopfzeilen-Icons. Hinweise mit 40 % Deckkraft kamen
  auf 2,2:1.
- **Zustandsfarben als Textfarbe:**
  - `--warn` 1,4–2,0:1 (HUD-Warnung, Statusnoten);
  - `--ok` 3,6:1 („CLEAR“);
  - `--danger` im Dunkel-Theme 3,4:1 (Beschriftung des E-Stop);
  - `--info` für das „?“ und die G-Wörter 1,9–2,9:1;
  - `--accent` für die Codes der G-Code-Referenz 4,0:1.
- **Syntaxfarben:** Die Palette des Dunkel-Themes galt in allen Themes. Im hellen Theme lagen
  Parameter bei 1,5:1, Koordinaten bei 2,0:1 und M-Wörter bei 2,7:1. Kommentare mit zusätzlich 80 %
  Deckkraft kamen auf 2,5:1, im Viewer wie im Editor.
- **„Automatisch“ bei dunklem System** ist eine fünfte Palette mit eigenem CSS-Block. Er setzte nur
  Grund, Vordergrund, Panel, Rahmen und Button; jede neue Rolle muss auch dort stehen.

**Umgesetzt:**
- **Textrollen je Theme,** in allen fünf Blöcken:
  - `--fg-muted`, `--ok-text`, `--warn-text`, `--danger-text`, `--info-text`, `--accent-text`;
  - `--focus-ring`;
  - die Syntaxpalette `--syntax-gcode` / `-mcode` / `-coord` / `-param` / `-comment`.

  Jede Rolle hält mindestens 4,6:1 auf Grund, Panel und Button, auf der Auswahl- und Hover-Tönung und
  auf den Zustandstönungen (Statusnoten, Banner, Warn-Karte). In den HC-Themes halten gedämpfter Text
  und Syntax mindestens 7:1 auf den neutralen Flächen.
- **Füllfarben bleiben:** `--ok`, `--warn`, `--danger`, `--info` und `--accent` bleiben die Farben von
  Füllungen, Rahmen und Tönungen. Text in einem Zustand liest die `-text`-Rolle, ebenso die
  Zustandsglyphen (Warn-Icon, Zeitleisten-Glyphen).
- **Gedämpfter Text ist `--fg-muted`,** nie eine Deckkraft (rund 60 Stellen); `--mix-muted` ist
  entfernt. Nicht gewählte Reiter und Icon-Knöpfe dimmen nur noch ihre Beschriftung, Rahmen und
  Füllung bleiben.
- **Kommentare** haben keine Deckkraft mehr, im Viewer wie im Editor.
- **Editor-Grundschema:** Der Editor wählt sein helles oder dunkles Grundschema nach dem aufgelösten
  Theme und wechselt live mit. Vorher war es fest dunkel: Auch helle Themes bekamen dunkle Auswahl-
  und Zeilenfarben.
- **Viewer-Karten** (HUD, Sim-Leiste) sind zu 92 % statt 85 % deckend. Ihr Text hält so 4,5:1 auch
  über dunkler Geometrie.
- **Fokusring:** Er ist `--focus-ring`, getrennt von `--info`. `--info` kam im hellen Theme auf
  2,9:1 gegen Weiß.
- **Banner:** Das Einblenden entfällt bei reduzierter Bewegung (D8b-Nachtrag). `appearance.spec` misst
  den Banner deshalb erst, wenn sein Zustand steht. Der Farbübergang der Füllung (0,4 s, keine
  Bewegung) lief bisher während des Einblendens ab und fiel jetzt in die Stichprobe.
- **Tastatur-Tab:** Bei ausgeschalteter Tastatursteuerung sind die Belegungszeilen gedämpft statt
  gesperrt dargestellt (`.inactive` ist eine Farbe), denn sie bleiben bedienbar.

**Wächter:**
- **`contrast.spec`** (in `serial-guards`) mit fünf Durchläufen: die vier Themes und „Automatisch“
  bei dunklem System.
  - **Stationen:** Seite in Ruhe, Program mit gewählter Zeile, Run-from-line-Dialog, Editor,
    Dateiliste, alle Reiter, Tools mit aktuellem Werkzeug, eine offene Hilfe, jeder Settings-Bereich,
    G-Code-Referenz, Hinweisblase und Statusnoten. Dazu die Zustände laufendes Programm, Neuberechnung
    der Vorschau, Sicherheitsauslösung und E-Stop.
  - **Messung:** Die Textfarbe geht durch die Deckkraft aller Vorfahren und über die
    durchscheinenden Schichten bis zur ersten deckenden.
  - **Schwebende Karten** (HUD, Hinweis, Hilfe) werden zweimal gemessen: über der Seite und über der
    Vordergrundfarbe. Was im Viewer hinter ihnen liegt, kennt das DOM nicht.
  - **Ausnahmen und Warten:** Gesperrte Controls sind ausgenommen. Gemessen wird erst, wenn kein
    Übergang mehr läuft; mitten im Hintergrund-Übergang nach dem Theme-Wechsel lasen Knöpfe Grau.
- **Fokusring je Theme:** mindestens 2 px, die Farbe `--focus-ring`, mindestens 3:1 auf Grund, Panel
  und Button. Rot mit der alten Ringfarbe.
- **`themeTokens.test.ts`:** Jeder Theme-Block definiert jede Rolle, „Automatisch“ dunkel ist gleich
  Dunkel, `--mix-muted` ist weg. Rot mit einer entfernten Rolle.

**Nicht Teil von D8a:**
- Die Viewer-Szene selbst (WebGL: Pfad, Bounds, Limit-Markierung, Kollision) kommt mit D8c.
- Die Befunde der Sim-Leiste (Limit- und Kollisionsmarken) stellt der Mock nicht nach; ihre Glyphen
  lesen die `-text`-Rollen, gemessen sind sie nicht.
- `.dialogBody` behält 80 % Deckkraft. Gemessen liegt es über 4,5:1; ob der Rest der
  Opazitätsregeln auf Farben umzieht, entscheidet D10 (N111).

**Sichtbar für den Operator:**
- Nicht gewählte Reiter und Icon-Knöpfe dimmen nur ihre Beschriftung; Rahmen und Füllung bleiben voll.
- Im hellen Theme sind die Syntaxfarben dunkler, die Beschriftung des E-Stop ist dunkelrot.
- Die Viewer-Karten (HUD, Sim-Leiste) sind deckender.
- Der Fokusring ist dunkler blau.

**Referenzbilder:** Nur der Fokusring im Werkzeugdialog weicht ab (vier Profile), er ist jetzt dunkler
blau. Die Bilder sind angesehen und erneuert.

**Gates:**
- build, lint und Vitest (**1644**, neu `themeTokens.test.ts`) grün.
- Playwright **273/273** über alle neun Projekte; `serial-guards` 135 (zehn neue Tests: fünf
  Kontrast-Durchläufe und fünf Fokusring-Tests). Im ersten Lauf fiel die Probe in `appearance.spec`
  (siehe Banner oben); nach der Korrektur lief `serial-guards` erneut komplett grün.

### WP-D8c — Viewer-Palette, Legende, Farbmigration · 27. September 2026

**Ausgangslage:**
- Der Viewer zeichnete mit festen Farben, unabhängig vom Theme: Bounds `#ffffff` (1,0:1 auf dem hellen
  Hintergrund), Vorschub `#22b8cf` (2,4:1), Eilgang `#f5a623` (2,0:1), Limit-Markierung `#ffcc00`
  (1,5:1), Auswahl `#ff3333`.
- Die Kollisionsfarbe wurde beim ersten Einfärben einmal gelesen und blieb nach einem Theme-Wechsel
  stehen.
- Jedes Speichern im Viewer schrieb die ganze Palette mit, auch ein Layer-Umschalter. Ob eine
  gespeicherte Farbe gewählt war, ist deshalb nicht erkennbar (UI-D05).

**Umgesetzt:**
- **Rollen je Theme** (`--viewer-*` in allen fünf Theme-Blöcken): Vorschub, Eilgang, gefahrener Pfad,
  Limit, Auswahl, Kollision, Maschinen-Bounds, Toolpath-Bounds, Werkzeugschaft, Schneide. Ein Resolver
  (`viewer/viewerPalette.ts`) liefert alle Viewer-Farben; die zehn verstreuten Fallback-Hexwerte sind
  weg. Bei einem Theme-Wechsel und bei jeder Einstellungsänderung wird die Palette neu aufgelöst und
  auf alle lebenden Objekte gelegt, einschließlich einer sichtbaren Kollisionsfärbung.
- **Werte nach dem Blick auf Geometrie:**
  - Die Szenenbilder je Theme (Maschinenmodell, Pfad mit Limit-Überschreitung, gefahrener Pfad,
    gewählte Zeile) zeigten: Ein Programm liegt auf dem Tisch bzw. dem Rohteil, und dessen Oberseite
    ist im Licht der Szene in jedem Theme hell (etwa `#e0e0e0`). Pastellfarben für dunkle Themes
    verschwinden dort.
  - Jede Linienrolle hält deshalb mindestens 3:1 auf dem Hintergrund (HC mindestens 4,5:1) **und**
    auf dem beleuchteten Tisch. Die dunklen Themes zeichnen mittelhelle Linien.
  - Die sechs Pfadrollen unterscheiden sich in Farbton und Helligkeit um mindestens 0,12 in OKLab.
- **Farbentscheidungen:**
  - Limits bleiben überall in der Warnfamilie (Overlay, Zeitleisten-Marken, Zeilennummern), in
    hellem Theme als Ocker.
  - Der Eilgang verlässt deshalb die warme Familie: grün und gestrichelt. Grau schied aus, weil Grau
    „veraltet“ heißt.
  - Die gewählte Zeile ist in den hellen Themes fast schwarz, in den dunklen Cyan. Rot bleibt der
    Kollision vorbehalten.
- **Modus für die ganze Palette,** explizit gespeichert (`paletteMode`), Migration ohne Heuristik
  (`viewerSection.ts`):
  - Keine gespeicherte Viewer-Sektion oder eine ohne Farben: „Automatic“.
  - Eine gespeicherte Altpalette: genau so, als „Custom“.
  - Custom-Farben überleben Automatic → Custom → Automatic.
  - Der erste Wechsel auf Custom übernimmt die gerade gezeichneten Farben, nicht die alten
    Standardwerte.
  - „Reset 3D Viewer“ führt zu Automatic.
- **Settings › 3D Viewer › Colors:**
  - Die Wahl Automatic / Custom mit einer Zeile, was beides heißt.
  - Darunter die Legende: jede Rolle als Linienmuster in der gezeichneten Farbe, der Eilgang
    gestrichelt.
  - In Custom sind die sieben Nutzerrollen Farbwähler. Limit, Auswahl und Kollision bleiben die des
    Themes.

**Wächter:**
- **`themeTokens.test.ts`:** Jeder Theme-Block trägt alle Viewer-Rollen als `#rrggbb`. Die
  Kontrastregeln gegen Hintergrund und beleuchteten Tisch sowie der Mindestabstand der Pfadrollen
  (siehe oben) sind geprüft. Rot mit einer Pastell-Vorschubfarbe und weißen Bounds.
- **`viewerSection.test.ts`:** die Abnahmefälle aus UI-D05, jeweils mit dem Ergebnis aus der
  Migration oben:
  - keine Sektion;
  - vollständige alte Standardpalette;
  - eine geänderte Rolle;
  - bewusst auf den alten Standard zurückgesetzt, ununterscheidbar und deshalb Custom;
  - Automatic → Custom → Automatic;
  - Speichern und Neuladen als Fixpunkt: Ein zweiter Client bekommt dieselbe Sektion.

  Dazu der Resolver: Automatic folgt dem Theme, Custom bleibt, eine fehlende Custom-Rolle zeichnet die
  des Themes, der erste Wechsel übernimmt die gezeichneten Farben.
- **`viewer.spec`** (`serial-viewer`) liest die Farben von den gezeichneten Materialien (sie tragen
  ihre Rolle).
  - Automatic, auch ohne gespeicherte Sektion, zeichnet die Tokens.
  - Ein Theme-Wechsel ändert alles, die Kollisionsfärbung auf dem Bildschirm eingeschlossen. Ohne
    das Neufärben war der Test rot.
  - Eine Altpalette von einem anderen Client wird Custom und bleibt beim Theme-Wechsel stehen.
  - In Settings: Automatic → gespeichert mit erhaltenen Custom-Farben; die Legende zeigt die
    gezeichneten Farben.
  - Custom → die gespeicherte Palette kommt zurück, mit sieben Farbwählern.
- `toolpathController.test`: Limit-Overlay und Auswahl nehmen die Rollen live an. Die Tests erkennen
  das Overlay an seiner Rolle statt an `0xffcc00`.

**Abweichung vom Plan, zur Prüfung:**
- Der Plan sah einen Sichtvergleich bekannter Szenen im Projekt `serial-viewer` vor. WebGL-Bilder
  sind aber keine stabile Referenz zwischen der VM und CI; der Werkzeugdialog maskiert seine Canvas
  aus demselben Grund.
- Die Szenen habe ich deshalb je Theme gerendert und angesehen (temporäres Harness, nicht im Repo).
- Der dauerhafte Wächter prüft die gezeichneten Materialfarben deterministisch.

**Grenzen:**
- Vor mittelgrauem, beschattetem Metall erreicht keine Linienfarbe zugleich 3:1 zum Hintergrund.
  Dort tragen Farbton, das Strichmuster des Eilgangs und die Legende.
- Eine breitere Auswahl-Linie ist offen: WebGL zeichnet Linien 1 px breit, das bräuchte Fat Lines.
- Nicht auf Rollen umgestellt sind:
  - die Achsen-Triaden (RGB-Konvention);
  - die TWP-Ebene (feste Hexwerte, deren Kommentar „wie info/warn/danger“ nur eine Kopie ist);
  - die Farbskala der Oberflächenkarte;
  - die 3D-Ansicht im Probing;
  - die Werkzeugvorschau im Tools-Tab, die die Werkzeugfarben nicht liest.

  Sie gehören zu D10 (Token-Reste) bzw. zu einer eigenen Viewer-Runde.
- Custom-Farben sind nicht kontrastgeprüft; die Settings sagen das.

**Sichtbar für den Operator:**
- Bisherige gespeicherte Paletten laufen als „Custom“ weiter, Automatic wird angeboten.
- Mit Automatic wechseln die Viewer-Farben mit dem Theme.
- Der Eilgang ist grün statt orange, die Limit-Markierung ocker statt gelb, die gewählte Zeile
  schwarz bzw. cyan statt rot.
- In den dunklen Themes sind die Linien kräftiger und weniger hell.

**Gates:**
- build, lint und Vitest (**1660**, neu `viewerSection.test.ts`) grün.
- Playwright **274/274** über alle neun Projekte; `serial-viewer` 5 (neu: die Viewer-Palette). Die
  Referenzbilder in `serial-visual` sind unverändert grün.


### WP-D9 — Viewer-Overlays · 27. September 2026

**Ausgangslage** (gemessen über die vier Viewports bei 100 % und das Hochformat bei 150 %, mit
3 Warnzeilen):
- **1024 × 768 bei 100 %:** Die HUD-Karte war höher als der Viewer, der Viewer schnitt sie ab.
  „Rotation“ war halb verdeckt, die Zeile „Preview re-parsing“ gar nicht zu sehen. Eine Warnung
  verschwand also still.
- **900 × 1200 bei 150 %:** Die Karte lag über ViewCube und Schnellknöpfen und ragte 100 px ins
  Seitenpanel.
- **1280 × 800 Touch:** Es passte mit 4 px Rest.
- **Kamera-Fenster:** Es hatte eine eigene Rahmung. Sein Minimieren-Knopf war ein Textzeichen (□ −)
  auf dem Typ „close“.
- **Sim-Leiste:** Die Vor/Zurück-Knöpfe waren Textzeichen, ihr zugänglicher Name war „◀“.
- **HAL-Gruppen:** Die Pfeile ▼/▶ waren Text.
- **Schnellknöpfe:** Kamera und Settings hatten nur einen `title`.
- **Begriffe:** „soft-limit violation“ stand gegen das Glossar.

**Umgesetzt:**
- **Die DRO-Karte passt in ihren Bereich** (`fitHud`, gemessen, nie geclippt, nie per `transform`
  skaliert).
  - Von der eingestellten HUD-Größe (Obergrenze) geht sie stufenweise bis `sm` herunter.
  - Danach blendet sie die Maschinenspalte aus, dann F/S, dann die Werkzeugzeile. Das sind die
    Schalter, die der Operator dafür schon hat; die Anpassung setzt sie nur automatisch.
  - Ausgelöst wird sie von einem ResizeObserver auf Bereich, unteren Block und Karte sowie bei
    einer Änderung der Einstellung.
  - Passt auch die kleinste Form nicht, meldet die Karte `data-hud-fit="overflow"` statt zu clippen.
- **Befundkarte am unteren Rand:** Modus-Chip und Warnungen bleiben zusammen, wie der Operator am
  12.09. wollte. Sie stehen jetzt in einer eigenen Karte (`.hudNotes`) über der Sim-Leiste, in einer
  Spalte (`.viewerBottom`).
  - Die fehlgeschlagenen Modellteile sind dort eine Warnzeile mit „?“, der eigene Chip entfällt.
    Damit gibt es einen Warnstil im Viewer (N102).
  - Die Sim-Leiste sitzt nicht mehr absolut, sondern in dieser Spalte.
- **Schmaler Bereich** (unter 440 px): ViewCube und Schnellknöpfe werden 96 statt 140 px groß.
- **Kamera-Fenster:** Es nutzt die gemeinsame `.overlay-card` (N100). Minimieren/Maximieren sind
  Lucide-Icons auf einem eigenen Typ `windowToggle`; das X bleibt der einzige „close“.
- **Icons und Namen:**
  - Sim-Leiste: Lucide-Pfeile mit Namen („Previous limit violation“, „Next collision“).
  - HAL-Gruppen: Lucide-Pfeile mit `aria-expanded`.
  - Schnellknöpfe: „Show camera“ bzw. „Hide camera“ und „3D Viewer settings“ (N101).
- **Begriffe nach dem Glossar:** „limit violation“ in der Sim-Leiste; die Legendenzeile in Settings
  heißt „Limit violation“ (N15).

**Wächter:**
- **`layout.spec`**, je mit 5 und 6 Achsen, allen Warnzeilen und einer Vorschau-Neuberechnung:
  - Durchlaufen werden die vier Viewports bei 100 % und das Hochformat bei 150 %.
  - DRO-Karte, Befundkarte, ViewCube und Schnellknöpfe liegen im Viewer.
  - Die DRO-Karte berührt weder Befundkarte noch ViewCube-Spalte; die Befundkarte berührt die
    ViewCube-Spalte nicht.
  - Die Karte meldet `fits`.
  - Rot ohne `fitHud`: In 1024 × 768 überlappen DRO- und Befundkarte.
- **CSS-Audit `GLYPH_BUTTON`:** Ein `MachineBtn`, dessen ganzer Inhalt ein Textzeichen ist, braucht
  ein `aria-label`. Rot am alten ScrubBar mit vier Treffern.

**Grenzen:** Querformat ab 150 % bleibt die benannte WP-DR-Grenze. Der Bereich ist dort 90–135 px
hoch; die Karte meldet `overflow`, der Test lässt diesen Fall aus.

**Sichtbar für den Operator:**
- Modus-Chip und Warnungen stehen unten links statt unter den Achsen.
- In kurzen Bereichen ist die DRO-Karte kleiner, ohne Maschinenspalte, F/S oder Werkzeugzeile.
- Im schmalen Hochformat ist der ViewCube kleiner.
- Das Kamera-Fenster sieht aus wie die übrigen Viewer-Karten.
- Settings › 3D Viewer › HUD sagt, dass die Größe eine Obergrenze ist und was ein kurzer Viewer faltet.

**Gates:**
- build, lint (neu `GLYPH_BUTTON`) und Vitest (**1660**) grün.
- Playwright **276/276** über alle neun Projekte; `serial-layout` 65 (neu: die Overlays im Viewer mit
  5 und 6 Achsen). Nach der Beschreibungszeile im HUD-Bereich der Settings (die Größe ist eine
  Obergrenze, der Viewer faltet zuerst Machine, F/S und die Werkzeugzeile) liefen `contrast`, `forms`
  und `feedback-channels` erneut grün (23/23).


### WP-D10a — tote Reste und die offenen Folgepunkte · 27. September 2026

D10 kommt in drei Commits: D10a (tote Reste, Folgepunkte, `DEAD_CLASS`/`EMPTY_RULE`), D10b
(Textrollen-Utilities, Leerzustände, Laufweite), D10c (Tönungen, Button-Achsen, Breitenbericht).

**Ausgangslage** (Bestandsaufnahme am Stand `1ab19d7`; die Zeilen des Plans hatten sich verschoben):
- **Tote Regeln (N110):**
  - App `.okText`/`.badText`/`.warnText`/`.mutedText` und `.dialogBody .danger`;
  - GcodePanel `.switchBtn`;
  - ProbePanel `.checkRow`;
  - SettingsPanel `.wpColumns` und die leere `.macroSettingsList {}`;
  - ToolTablePanel `.importExists`/`.importTag`.
- **Toter Zweig:** Die Werkzeugtabelle hatte einen eigenen Kopf („+ Add“, „Hide Files“/„Browse“,
  „Upload“) hinter `v-if="!hideHeader"`. App übergab `hideHeader` immer, der Zweig wurde nie
  gezeichnet.
- **Opacity-Resets ohne Wirkung:** Drei Regeln setzten eine Deckkraft zurück, die seit D8 nichts
  mehr setzt.
- **Veraltete Kommentare:** zwei.
- **Fortschritt im Program-Tab:** Er stand als `{{ Math.round(n) }}</span>%` da, ohne `fmtPct` und
  ohne Leerzeichen vor dem Prozentzeichen. Das Audit sah es nicht, weil `</span>` zwischen
  Interpolation und Einheit stand.

**Umgesetzt:**
- Alle toten Regeln, der tote Kopf samt `hideHeader`-Prop und die wirkungslosen Resets sind entfernt.
  `.container.compact` ist die einzige Form des Containers.
- Der Fortschritt läuft über `fmtPct` („42 %“), der Platz der Zahl ist auf „100 %“ (5 ch) verbreitert.

**Wächter** (CSS-Audit, im Gate):
- **`EMPTY_RULE`:** eine Regel ohne Deklaration und ohne verschachtelte Regel. Ein Stapel der
  offenen Regeln verhindert, dass ein `@media`-Block als leer gilt.
- **`DEAD_CLASS`:** eine Klasse, die ein scoped Selektor stylt (das Subjekt nach dem letzten
  Kombinator, ohne `:deep`), die die Komponente nirgends nennt. Als Nennung zählen:
  - `class=`, `:class`-Schlüssel und String- oder Template-Literale im Skript;
  - ein Literal `prefix-${…}` für die Klasse `prefix-x`;
  - ein Transition-Name;
  - eine Klasse, die das Template einer anderen Komponente trägt (die Wurzel einer
    Kindkomponente).

  Am Stand vor der Korrektur fand sie genau die Liste der Bestandsaufnahme (9 Treffer). Ohne eine
  einzige `audit-ok`-Ausnahme läuft sie danach sauber. `.dialogBody .danger` sieht sie nicht: Das
  Wort „danger“ steht in App als Prop. Diese Regel ist von Hand entfernt.
- **`UNIT_LITERAL`** erlaubt jetzt ein schließendes Tag zwischen Interpolation und Einheit. Rot an
  der alten Fortschrittszeile.

**Gates:**
- build, lint (neu `EMPTY_RULE`, `DEAD_CLASS`, `UNIT_LITERAL` erweitert) und Vitest (**1660**) grün.
- Playwright **276/276** über alle neun Projekte.


### WP-D10b — Textrollen-Utilities, Leerzustände, Laufweite · 27. September 2026

**Abweichungen vom Planwortlaut (bewusst, zur Prüfung):**
- **N111:** Der Plan sagt „Lade- und Hinweistexte bekommen die D8-Rolle“ und meint `--opacity-muted`.
  D8a hat mit UI-D07 die Regel „Deckkraft nur für gesperrte Controls und Dekoration, nie für Text“
  vereinbart; die D10-Formulierung ist dadurch überholt. Umgesetzt ist die D8-Regel.
- **N112:** Der Plan nennt `.text-error`. Seit D8a ist `--err` nur eine Tönung für Flächen, Fehlertext
  liest `--danger-text`. Es gibt deshalb `.text-danger` und keine zweite Klasse für dieselbe Farbe.
- **N113:** Das Innen-Padding bleibt hart codiert, wie die Pre-Flight-Checkliste es seit jeher
  festlegt („Padding inside buttons/inputs is visual and stays hardcoded“). Ein Token bekommt nur
  die Laufweite.

**Umgesetzt:**
- **Text ohne Deckkraft (N111):**
  - `.dialogBody` (alle Bestätigungsdialoge) trägt keine 80 % mehr. Der Text ist dadurch
    **sichtbar dunkler**.
  - Der Beschreibungstext im G-Code-Tooltip, „unlinked“ im HAL-Bereich (0,3 auf gedämpftem Text:
    1,55:1) und die Offsets-Namen (80 % transparentes `--fg`) nutzen jetzt Farbrollen.
  - Der HAL-Gruppenkopf dimmt beim Hover nicht mehr seinen Text; es gilt der Hover des Buttons.
  - Das Upload-Icon im leeren Program-Tab ist Dekoration (`--opacity-muted`), kein gesperrtes
    Control.
- **Eine Utility-Familie (N112):** `.text-muted`, `.text-ok`, `.text-warn`, `.text-danger`. Die
  doppelte globale `.muted` ist entfernt.

  Die Einzeiler-Kopien sind durch die Utilities ersetzt:
  - GamepadTab `.okText`;
  - HAL `.halTrue`/`.halFalse`/`.halGroupCount`;
  - Tastatur `.kbAlways`;
  - Offsets `.warn` und `.auxLabel` (kontextuell, weil die Namensregel eine Utility überstimmen
    würde);
  - Probing `.compValue`;
  - DebugTab `.muted`;
  - die Banner-Stufen: `.bannerError`/`.bannerWarn` bleiben Namen für Code und Specs, ihre Farbe
    kommt aus der Utility daneben.
- **Leerzustände:** „Waiting for data…“ (Debug), „No compensation grid yet“ (Probing) und „No stream“
  (Kamera) sind `.emptyState`.
- **Laufweite (N113):** Das Token `--tracking-caps` (0,05 em) gilt für alle Großbuchstaben-Texte:
  Abschnittstitel, Labels, Status-Banner, Kopfzeilen-Pills und Sim-Banner. Vorher standen dort
  0,5 px, 0,02 em und 0,05 em.

**Wächter:**
- **`contrast.spec`:** Im HAL-Bereich wird eine Pin-Gruppe aufgeklappt. Rot am Stand vor der
  Korrektur mit „unlinked“ 1,55:1 und der Gruppenzahl beim Hover 3,37:1.
- **CSS-Audit:**
  - `ONE_LINER`: eine scoped Regel auf einer Klasse, die nur eine Textrollenfarbe setzt. Rot an den
    Banner-Stufen und am Tooltip.
  - `EMPTYSTATE_COPY`: zentrierter gedämpfter Text ohne eigenen Kasten. Rot an einer eingepflanzten
    Kopie.
  - `TOKEN`: literale `letter-spacing`.

**Sichtbar für den Operator:**
- Der Text in Bestätigungsdialogen ist dunkler.
- Die Pills der Kopfzeile sind minimal weiter gesperrt.
- „No compensation grid yet“ steht zentriert.

**Gates:**
- build, lint (neu `ONE_LINER`, `EMPTYSTATE_COPY`, Laufweite in `TOKEN`) und Vitest (**1660**) grün.
- Playwright **276/276**. Im ersten Lauf fielen die fünf Kontrast-Durchläufe: Der neue HAL-Schritt
  wartete auf die Klasse `.halUnlinked`, die D10b entfernt. Er wartet jetzt auf den Text, danach
  liefen `contrast.spec` (10/10) und damit `serial-guards` grün.


### WP-D10c — Tönungsstufen, Button-Achsen, Breitenbericht · 27. September 2026

**Tönungen (N114):**
- **Ausgangslage:** Zustandsfarben standen mit neun verschiedenen Prozentwerten in `color-mix()`,
  nämlich 8, 10, 15, 20, 25, 40, 45, 50 und 55 %, an 59 Stellen.
- **Stufen:** Jetzt gibt es sechs benannte Stufen in `:root`: `--tint-faint` 10, `--tint-note` 15,
  `--tint-active` 20, `--tint-fill` 25, `--tint-heavy` 40 und `--tint-edge` 50 %. Die Ausreißer ziehen
  auf die nächste Stufe (8 → 10, 45 → 40, 55 → 50); die Unterschiede sind kaum sichtbar.
- **Freihändige Mischungen:**
  - Rand 30 % (zweimal) wird `--border-subtle`.
  - fg 4 % und 5 % (Codekästen in Probing und Debug) sind vereinheitlicht auf 5 %.
  - Der Hover der Codezeile ergab durch 90 % + 5 % eine Farbe mit Alpha 0,95; er ist jetzt die
    Hover-Stufe `--hl-surface`.
  - Drei Kopien der Slider-Spur (Donut, Fortschritt, Lastbalken) lesen `--range-track`.
- **Wächter:** CSS-Audit `TINT` (in .vue und `style.css`): eine Zustandsfarbe mit literalem Prozent
  in `color-mix()`. Rot am alten `style.css` mit 14 Treffern.

**Button-Achsen (K14):** Die Variante sagt, was eine Aktion ist: `primary` (die Hauptaktion der
Gruppe), `warn`, `danger` oder `estop`. Der Zustand `active` sagt, was die Maschine ist.
- Die Variante `ok` diente nur als Maschinenzustand, für Arm und Power On in der Safety-Leiste. Sie
  ist entfernt; beide Knöpfe nutzen `:active`.
- `primary` behält Aussehen und Bedeutung. Start bleibt grün; ihn umzufärben wäre eine
  Operator-Entscheidung, nicht D10.
- **Sichtbar:** Arm und Power On zeigen ihren grünen Zustand mit der Aktiv-Stufe (20 %) statt der
  Füllung (25 %), eine Spur heller. Die Safety-Leiste steht in keinem Referenzbild; das ist ein Punkt
  für die Live-Sichtprüfung.

**Feste Pixelbreiten (N115) — Bericht mit Urteil, keine Umstellung:**

| Gruppe | Stellen | Urteil |
|---|---|---|
| Icon- und Glyphgrößen: HAL-Pfeil 12, Upload-Icons 40/48, Kompensationspunkt 8, Status-Punkt 8 | GcodePanel, ProbePanel, HalshowTab, style.css | bleiben literal, das ist die Größe des Zeichens |
| Werkzeugtabelle: `.colT` 50, `.colType` 80, schmale Aktionszelle | ToolTablePanel | bleiben: Die angehefteten Spalten rechnen mit exakten Breiten (Runde 4, UI-DI10), `layout.spec` misst sie |
| Tabellenspalten der G-Code-Referenz: 80/140/200/200/120 | GcodeReferenceDialog | bleiben: Ein px-Wert skaliert unter CSS-Zoom wie ein em-Wert, eine Umstellung auf `ch`/`em` ändert nichts, solange die Schrift fest ist |
| HAL-Zeilenspalten: Suche 160, Name ≥ 80, Typ 36, Richtung 24, Wert 80, Signal ≥ 60 | HalshowTab | bleiben: Diagnose-Tabelle; die Werte sind die Messung der breitesten Inhalte |
| Import-Zeilen: T ≥ 40, Typ ≥ 70, Ø ≥ 55; Editor-Spalte 360 | ToolTablePanel | bleiben (Messwerte, `forms.spec` prüft den Editor) |
| Probing: Raster ≤ 294, Kalibrier-Paar 196, Kompensation ≥ 140 | ProbePanel | bleiben: Das Raster ist die DR-Geometrie (4 × 65 px + Abstände) |
| Tooltip ≤ 320, Banner-Fortschritt 160, Meldungsart ≥ 50, Makro-Badge ≥ 70 | GcodePanel, App, SettingsPanel | bleiben; die Hilfe-Karte hat keine feste Breite, die der Tooltip teilen könnte (ihre Breite setzt `placePopover`) |

Die Bestandsaufnahme mit allen Stellen liegt der Sitzung vor. Eine Audit-Kategorie für Pixelbreiten
gibt es nicht: Es gibt keine Regel, die sie verletzen könnten.

**Gates:**
- build, lint (neu `TINT`) und Vitest (**1660**) grün.
- Playwright **276/276**. Im Gate fiel einmal `viewer.spec` „fetches nothing from outside the
  gateway“ („no label glyph atlas“); danach war er dreimal grün. Die Ursache liegt im Test: Er
  verglich die Texturzahl mit einem Moment zuvor, und die Beschriftungen des Achsenkreuzes legen
  den gemeinsamen Glyph-Atlas oft schon vorher an. Jetzt fragt er die Beschriftungen selbst
  (`__viewerDiag.getLabels`: alle gesetzt). Rot ohne die gebündelte Schrift; danach `serial-viewer`
  5/5.

---

## Codex Implementierungsreview Runde 1

**26. September 2026 · `feat/ui-design-wave` · HEAD `176a9cd`.** Geprüft wurde die Umsetzung
von **WP-DR und D0–D2** gegen Fassung 3 und die danach dokumentierten Operator-Entscheidungen.
Der Diff gegen `development` wurde als Branch-Diff (`development...HEAD`) abgegrenzt; die
eingemergte WS-Reconnect-Arbeit ist kein neuer UI-Befund.

**Ergebnis: noch kein Implementierungs-Agreement.** Die gemeinsamen Bausteine und die
Standardfälle funktionieren in den ausgeführten Prüfungen. Der Dialogstapel garantiert aber
noch nicht in jeder Öffnungs-/Schließreihenfolge, dass die sichtbare Oberfläche auch den
Tastaturfokus besitzt. UI-DI01 und UI-DI02 sind vor Abnahme von D2 zu beheben.

| ID | Priorität | Paket | Befund | Status |
|---|---|---|---|---|
| UI-DI01 | P2 | D2 | Sichtbarer Maschinenablauf und aktiver Fokus-Stapel können auseinanderlaufen | offen |
| UI-DI02 | P2 | D2 | Schließen eines unteren Dialogs zieht Fokus aus dem noch offenen oberen Dialog | offen |
| UI-DI03 | P3 | D1 | Stille Protokolleinträge werden nach Seitenneuladen als neue Meldungen gezählt | offen |

Die IDs dieser Umsetzung sind von den Planbefunden **UI-D01–D09** getrennt.

### UI-DI01 — Sichtbare Ebene und Fokus-Stapel müssen dieselbe Reihenfolge verwenden

**Stellen:** `lcnc-webui/src/modalRegistry.ts:57–67`, `DialogFrame.vue:94–98` und
`style.css:1209–1212`.

**Reproduktion im gebauten UI:** Werkzeugwechsel anfordern → über den weiterhin erreichbaren
Header **Settings** öffnen → Tab drücken. Der Werkzeugwechsel bleibt mit z-index **1010**
sichtbar vor Settings (**1000**). Die Registry meldet jedoch **Settings** als obersten Dialog;
der Fokus startet auf dessen „3D Viewer“ und wandert mit Tab zu „Machine“. Ein Hit-Test am
fokussierten Element trifft den Scrim des Werkzeugwechsels. Die Tastatur bedient damit den
verdeckten Dialog; Abort/Confirm des sichtbaren Werkzeugwechsels gehören nicht zum Tab-Bereich.

**Ursache:** Die Registry nimmt ausschließlich den zuletzt angehängten Eintrag. Die visuelle
Priorität für `flow` wird unabhängig davon in CSS festgelegt; auch der Initialfokus prüft diese
Priorität nicht. Die bestehende Reihenfolge „Formular → Werkzeugwechsel“ im Test erkennt den
umgekehrten Fall nicht.

**Korrekturziel:** Eine gemeinsame Reihenfolge für sichtbare Ebene, aktiven Dialog,
Initialfokus, Pausieren der Eingabehilfe und Tab-Bereich. Bleiben Maschinenabläufe immer vorne,
darf ein später geöffneter normaler Dialog ihren Fokusbereich nicht übernehmen. Nur den
z-index-Wert anzuheben oder nur den Tab-Handler anzupassen reicht nicht für diesen Vertrag.

**Abnahme:** Beide Öffnungsreihenfolgen prüfen, mindestens Werkzeugwechsel ↔ Settings und
Shutdown ↔ Referenz/Messages. Initialfokus und Tab/Shift+Tab gehören zum tatsächlich vordersten
Dialog; sein Abbruch bleibt erreichbar. Zusätzlich zum Registry-/DOM-Zählvergleich den
sichtbaren Empfänger mit einem Hit-Test prüfen. E-Stop bleibt global; keine fremde Aktion.

**Nachweis:** [JSON](ui-design-welle.implementation-r1.json), Schlüssel
`flowThenSettings` / `flowThenSettingsAfterTab`, und
[Bild](ui-design-welle.implementation-r1-flow.png).

### UI-DI02 — Ein unterer Dialog darf beim Schließen den oberen Fokus nicht zurückziehen

**Stellen:** `lcnc-webui/src/DialogFrame.vue:101–105` und `inputSession.ts:134–149`.

**Reproduktion im gebauten UI:** Tools öffnen und das Suchfeld fokussieren → der Controller
fordert einen Werkzeugwechsel an → im Header die Shutdown-Rückfrage öffnen → der Controller
beendet den Werkzeugwechsel, während die Shutdown-Rückfrage offen bleibt. Vorher sind
sichtbarer Dialog, Registry und Fokus konsistent: **Shut Down LinuxCNC? / Cancel**. Danach
bleibt derselbe Dialog sichtbar und in der Registry oben, aber der Fokus liegt im verdeckten
**Search tools**. Physisch über `page.keyboard.type` eingegebener Text verändert dieses Feld;
die Sonde liest dort anschließend `invisible edit`.

Dieser Fall verwendet zwei `flow`-Dialoge derselben visuellen Stufe. Er tritt daher unabhängig
vom Prioritätskonflikt UI-DI01 auf. Das Ende des Werkzeugwechsels wird im Mock ausschließlich
als Statusänderung zugestellt, wie bei einem von anderer Stelle beendeten Ablauf.

**Ursache:** Jeder Frame ruft beim Unmount bedingungslos `returnFocusTo(opener)` auf. Der
Rückkehrhelfer fokussiert einen noch gültigen Auslöser sofort; er prüft nicht, ob dieser zum
aktiven Dialogbereich gehört. Der neue Ersatzpunkt „oberster Dialog“ greift nur, wenn das alte
Ziel nicht mehr geeignet ist. Hier lebt das Suchfeld weiter.

**Korrekturziel:** Die Rückgabe muss berücksichtigen, welcher Dialog schließt und wem der
aktuelle Fokus gehört. Entfernen eines unteren Eintrags erhält den Fokus im oberen Dialog.
Ein altes Rückkehrziel darf einen weiterhin aktiven Dialogbereich nicht umgehen. Die bereits
abgesicherte Rückkehr beim Schließen eines ganzen Stapels muss dabei erhalten bleiben.

**Abnahme:** Obige Folge einschließlich Texteingabe nach dem Statuswechsel; Fokus bleibt auf
Cancel oder im erlaubten Bereich der Shutdown-Rückfrage, Suchtext unverändert. Dazu untere
Dialoge bei asynchroner Erfolgsantwort und entferntem/gesperrtem Auslöser schließen; die
bestehenden Prüfungen für Kind → Elternteil und kompletter Stapel → Auslöser weiterführen.

**Nachweis:** [JSON](ui-design-welle.implementation-r1.json), Schlüssel
`beforeLowerFlowEnds` / `afterLowerFlowEnds` / `hiddenSearchText`, und
[Bild](ui-design-welle.implementation-r1-lower-flow.png).

### UI-DI03 — „log“ bleibt beim Wiederherstellen nicht still

**Stellen:** `lcnc-webui/src/ws/statusStore.ts:181–195`; Erzeuger eines solchen Eintrags:
`GcodePanel.vue:742`.

`pushMessage(..., "log")` speichert `quiet: true` und erhöht zunächst keinen Zähler. Beim
Seitenstart wird `unreadCount` jedoch aus **allen** gespeicherten Einträgen initialisiert.
Ein einzelner persistierter Eintrag in genau dieser Form erzeugt nach Neuladen **Messages (1)**
und die Banneraktion **1 message**. Die eigentliche Statuszeile wird nicht überschrieben.

Das widerspricht der neuen Kanalregel „log = ungezählt“. Die Probe verwendet ausdrücklich
einen gespeicherten Testeintrag; der vorausgehende verwaiste Editor-Speichervorgang wurde hier
nicht als kompletter Browserablauf nachgestellt.

**Korrekturziel / Abnahme:** Stille Einträge auch bei der Wiederherstellung vom Zähler
ausschließen. Test mit `pushMessage(..., "log")` → Persistieren → Modul-/Seitenneustart:
Eintrag bleibt im Protokoll, Zähler bleibt null. Ein normaler `notify`-Eintrag muss weiter
gezählt werden. [JSON-Nachweis](ui-design-welle.implementation-r1.json): `quietAfterReload`.

### Paketbewertung und bewusst abgegrenzte Arbeit

| Paket | Bewertung dieser Runde |
|---|---|
| DR | Die dokumentierte Platzrechnung, benannten Zoomgrenzen und Operator-Wahl des Schmalmodus sind als Grundlage nachvollziehbar. Das ist die Geometrieentscheidung vor D3/D4, noch keine Abnahme der neuen Navigation. D3/D4 müssen ihre tatsächlichen Elemente mit den jetzt gebündelten Schriften erneut gegen das Budget messen. |
| D0 | In Codeabgleich und gezielten Tests kein weiterer Blocker gefunden. Gemeinsamer Platzhalter, Prozentformatierung und Einheitenquellen sind vorhanden. Formular-Einheiten für Probe/Toolsetter sind ausdrücklich nach D4 verschoben. |
| D1 | Reguläre Kanal-, Hilfe-, Retry- und Layoutprüfungen grün. UI-DI03 bleibt als kleiner Restpunkt. Kein stiller Logeintrag bei Sperrgründen ist die dokumentierte Operator-Entscheidung und kein Planverstoß. |
| D2 | Die 23 Dialoge verwenden den gemeinsamen Frame; Einzelvertrag, Safety-Erreichbarkeit und Entwurfspause bestehen die vorhandenen Tests. Stapelverhalten wegen UI-DI01/02 noch nicht abgenommen. |

Der schmale Picker-Modus, die entfernte Probe-Beschreibungszeile, lokale Inter-/JetBrains-Mono-
Schriften und vorgezogene Safety-Layoutkorrekturen sind dokumentierte Entscheidungen.
Makro-Enter und Hold für Programmaktionen gehören weiterhin zu D6. D3–D10, neue Theme-Paletten,
Viewer-Kontrast und die spätere einheitliche Formular-/Aktionsgestaltung sind nicht Gegenstand
dieser Paketabnahme.

### Ausgeführte Prüfungen und Grenzen

Alle Prüfungen liefen gegen den frischen Build von `176a9cd`, mit einem Browser zur Zeit und
niedriger Prozesspriorität. Der laufende XYZAC-Simulator und der echte Gateway auf Port 8000
wurden nicht angesprochen oder neu gestartet.

| Prüfung | Ergebnis |
|---|---|
| `npm run build` | grün; bestehender Hinweis zu großen Bundles |
| `npm run lint`, einschließlich CSS-Audit | grün |
| 8 gezielte Vitest-Dateien: Format, Hint/Platzierung, Status-Store, Permissions, TWP-Hilfen, lokale Schriften | **112/112** grün |
| Gateway `test_command_policy.py` + `test_command_dispatch.py` mit Fake-Controller | **214/214** grün |
| `scripts/test_audit_scoped_css.py` | **20/20** grün |
| Playwright `dialogs.spec.ts` + `feedback-channels.spec.ts`, `serial-guards --no-deps --workers=1` | **33/33** grün |
| Gezielte `layout.spec.ts`-Fälle: 5-Achs-Seitenpanels Desktop/Hochformat in allen Zuständen, Jog-Zentrierung, Probing-Parameterposition, Safety-Spalten inkl. 150 % | **10/10** grün |
| Unabhängige [Review-Sonde](ui-design-welle.implementation-r1.probe.mjs), Chromium am isolierten Mock `127.0.0.1:4188` | UI-DI01/02 und UI-DI03 reproduziert; JSON und Bilder oben verlinkt |
| `git diff --check` | grün |

Der erste Gateway-Testlauf hing innerhalb der Sandbox und wurde beendet; der zeitlich
begrenzte Wiederholungslauf außerhalb der Sandbox mit `fake_linuxcnc` lief grün durch.
Die zusätzlichen asynchronen Save-/Add-Proben zeigten in den getesteten Folgen **keinen**
Fokusverlust und sind nicht als Befund gewertet.

Kein vollständiger Offline-Gesamtlauf, keine Live-Maschinenbedienung, keine physische
Touch-/Screenreader-Abnahme. Die Browserprüfungen ersetzen diese Abschlussprüfungen nicht.
Nur Review-Dokumentation und reproduzierbare Nachweise ergänzt; Produktcode unverändert.

---

## Antwort Claude auf Runde 1 · 26. September 2026

Alle drei Befunde sind behoben; jeder Reproduktionsfall ist ein Test, der am alten Stand rot war.
Die Abnahme bleibt bei Codex (Runde 2 auf denselben Umfang DR + D0–D2).

| ID | Status | Änderung | Test |
|---|---|---|---|
| UI-DI01 | behoben | Eine Reihenfolge im Stapel für Ebene und Bedienposition: Ein Dialog, der bei offenem Maschinenablauf öffnet, wird **unter** den Abläufen eingereiht. Er nimmt keinen Initialfokus, pausiert nichts, und einen Fokus, den der Header-Klick genommen hat, holt der Ablauf zurück. Die Ebene `.safetyDialog` und die Stapelreihenfolge hängen beide an `kind="flow"` im Frame; App setzt die Klasse nicht mehr selbst. | `UI-DI01` in `dialogs.spec.ts`: Werkzeugwechsel ↔ Settings und Shutdown ↔ Messages, je beide Reihenfolgen; oberster Dialog in der Registry, Initialfokus, Tab/Shift+Tab, Abort per Tab erreichbar, Hit-Test, keine Maschinenaktion |
| UI-DI02 | behoben | Nur der oberste Dialog gibt beim Schließen Fokus zurück. Schließt ein **unterer**, bleibt der Fokus stehen. Schließt der oberste und ein Dialog bleibt, zählt sein Auslöser nur im Bereich dieses Dialogs, sonst dessen Initialfokus. Jeder Stapeleintrag trägt seinen Auslöser; schließt ein unterer Dialog zuerst, übernehmen die Dialoge darüber seinen Auslöser, wenn ihrer in ihm lag. So bleibt die Rückkehr des ganzen Stapels (Settings → Discard) in beiden Unmount-Reihenfolgen beim Header-Button. | `UI-DI02`: Ablauf endet unter der Shutdown-Rückfrage, Cancel behält den Fokus, getippter Text erreicht das verdeckte Suchfeld nicht, danach Rückkehr zum Shutdown-Button; Speichern im Werkzeugeditor antwortet unter Settings, Fokus bleibt in Settings, Leertaste ohne Befehl. Der bestehende Test für den ganzen Stapel läuft weiter. |
| UI-DI03 | behoben | Die ungezählten Arten (`status`, `log`) werden mit `uncounted` gespeichert und beim Wiederherstellen nicht gezählt; ältere `quiet`-Einträge ebenso. | Vitest: `notify` + `status` + `log` + Alt-Eintrag → Modul neu laden → Protokoll vollständig, Zähler 1 |

**Hit-Test im Dialog-Scan:** Jede der 23 Zeilen und jeder Tab-Schritt im Dialog prüft jetzt, ob ein
Zeiger in der Mitte des fokussierten Elements im fokussierten Dialog landet. Er fand einen weiteren
Fall:
- **Run from line bei 1280 × 720:** Der Initialfokus lag auf der ersten Option (Safe-Z-Schalter) unter
  dem Warntext, also außerhalb des sichtbaren Bereichs. Die Leertaste hätte sie ungesehen umgeschaltet.
- **Regel jetzt (WAI-ARIA APG, Dialogmuster):** Liegt das Ziel außerhalb des sichtbaren Dialoginhalts,
  bekommt der Container den Fokus. Der erste Tab scrollt dann zu den Optionen.
- Bei 1600 × 1000 liegt die Option im Bild und bekommt den Fokus weiter. Anhang B gilt damit mit dieser
  einen allgemeinen Ausnahme; eigener Test in beiden Höhen.

**Mac:** Safari und Firefox lassen den Fokus beim Klick auf einem Dialog-Container. Ein Druck unter 1 s
gilt dann als Auslöser, nicht der Container (`takeOpener`).

**Gegenprobe mit der Review-Sonde:** Die Sonde lief unverändert gegen den neuen Build, nur mit
Ausgabe außerhalb des Repos, sodass die Nachweise oben unberührt bleiben. Ergebnis:
- `flowThenSettings`: oben ist jetzt der Werkzeugwechsel, der Fokus liegt in ihm, der Hit-Test trifft ihn.
- `flowThenSettingsAfterTab`: Tab erreicht Abort.
- `afterLowerFlowEnds`: Der Fokus bleibt auf Cancel der Shutdown-Rückfrage.
- `hiddenSearchText`: leer.
- `quietAfterReload`: „Messages (0)“ ohne Banneraktion.
- `afterSaveReply`: unverändert in Settings.

| Prüfung | Ergebnis |
|---|---|
| `npm run build`, `npm run lint` (inkl. CSS-Audit) | grün |
| Vitest | **1623/1623** |
| `scripts/test_audit_scoped_css.py` | **20/20** |
| Playwright, alle Projekte einzeln (`--no-deps --workers=1`) | **216/216**; `serial-guards` 90, davon `dialogs.spec.ts` 29 |
| UI-DI01, UI-DI02 und der Run-from-line-Test am alten Stand | rot (Registry-Top, Fokusverlust, Hit-Test) |

---

## Codex Implementierungsreview Runde 2

**26. September 2026 · `feat/ui-design-wave` · HEAD `f73c2a9`.** Nachprüfung der Antwort auf
Runde 1 und aller Produktänderungen seit `176a9cd`, weiterhin im Umfang **DR + D0–D2**.

**Ergebnis: UI-DI01–03 sind behoben und geschlossen.** Ein ergänzender Gate-Wechsel zeigt
noch einen Fehler im neuen Fokus-Ersatzpunkt: **UI-DI04 (P2)**. D2 ist damit noch nicht
abgenommen; für DR/D0 bleibt die Bewertung aus Runde 1 bestehen, D1 hat keinen offenen
Befund dieser beiden Reviewrunden mehr.

| ID | Ergebnis der Nachprüfung | Status |
|---|---|---|
| UI-DI01 | Werkzeugwechsel bleibt bei nachträglich geöffneten Settings zugleich sichtbarer und aktiver Dialog; Tab erreicht dessen Abort. Beide Öffnungsreihenfolgen sowie Shutdown ↔ Messages bestehen die neuen Tests. | geschlossen |
| UI-DI02 | Endet ein unterer Ablauf, bleibt Cancel der darüberliegenden Shutdown-Rückfrage fokussiert. Das verdeckte Suchfeld bleibt leer. Asynchrone Add-Antwort unter Settings und Rückkehr nach Schließen des ganzen Stapels ebenfalls grün. | geschlossen |
| UI-DI03 | Alter persistierter `quiet`-Eintrag erzeugt nach Neuladen `Messages (0)` und keine Banneraktion. Der Unit-Test erhält `status`/`log` sowie Alt-Einträge ungezählt und zählt einen normalen `notify`-Eintrag weiterhin. | geschlossen |
| UI-DI04 | Nach Disarm zeigt der neue Ersatzpunkt auf einen gesperrten Settings-Reiter; beim Ende des oberen Ablaufs bleibt der Fokus auf `body`. | **offen · P2 · D2** |

Die zusätzlichen Hit-Tests und die sichtbarkeitsabhängige Initialfokus-Regel für Run from line
sind nachvollziehbar und bestehen die Nachprüfung bei beiden getesteten Fensterhöhen.

### UI-DI04 — Ein gesperrtes Initialziel ist kein gültiger Fokus-Ersatzpunkt

**Stellen:** `lcnc-webui/src/DialogFrame.vue:103–109`,
`lcnc-webui/src/modalRegistry.ts:197–200`; verwendeter Rückkehrhelfer
`lcnc-webui/src/inputSession.ts:119–121`.

**Reproduktion am frischen Build:**

1. Tools öffnen und das Suchfeld fokussieren.
2. Der Mock-Controller fordert einen Werkzeugwechsel an; anschließend im Header Settings
   öffnen. Settings wartet jetzt korrekt hinter dem Ablauf.
3. Der Client erhält `armed: false`. Der Werkzeugwechsel-Container behält den Fokus;
   die Bedienelemente im Content-Fieldset sind gesperrt.
4. Der Controller beendet den Werkzeugwechsel. Settings ist nun der sichtbare und registrierte
   oberste Dialog. Der Fokus landet jedoch auf **BODY** und bleibt dort auch nach **2,2 s**.

**Ursache:** Der registrierte Ersatzpunkt wurde vom Dialog-Container auf dessen `initial()`
umgestellt. Settings verwendet `initial-focus="button.selected"`. Bei einem expliziten
Selektor prüft `initialTarget` nur, ob das gefundene Element geometrisch im Dialog liegt;
anders als bei `first-field`, `close` und `safe` wird `:disabled` nicht ausgeschlossen.
Der ausgewählte Reiter ist nach Disarm über sein übergeordnetes Fieldset gesperrt. Sein
`focus()` bleibt wirkungslos. `fallbackFocus` prüft lediglich `isConnected` und beendet diesen
Pfad ohne Nachweis einer erfolgreichen Fokuslandung. Der vorhandene Container mit
`tabindex="-1"` wäre weiterhin erreichbar.

**Auswirkung:** Der Dialog verliert seinen sichtbaren Tastaturfokus; die zugesagte bewachte
Rückkehr landet nicht im verbleibenden Dialog. **Kein nachgewiesener Maschinenstart:**
Die Registry enthält weiterhin einen offenen Dialog; Space, Enter und Backspace senden in
der Gegenprobe nichts, Escape sendet genau `estop`. Das ist ein Fehler des Fokus-/
Barrierefreiheitsvertrags, kein Beleg für einen umgangenen Modal-Schutz.

**Korrekturziel:** Explizite Initialfokus-Selektoren auf tatsächliche Fokussierbarkeit prüfen,
einschließlich geerbtem `:disabled`. Ist das Ziel nicht geeignet, muss der Dialog-Container
übernehmen. Die Rückkehr darf einen erfolglosen `focus()`-Versuch nicht als Landung behandeln.
Die neue Sichtbarkeitsregel für Run from line bleibt dabei erhalten.

**Abnahme:** Obige Folge mit Disarm und beendetem Ablauf: Fokus auf dem verbleibenden
Dialog-Container, nie dauerhaft auf `body`; Safety bleibt per Tab erreichbar. Dasselbe mit
G-code Reference als weiterem Dialog mit explizitem Initialselektor sowie beim Öffnen eines
solchen Dialogs im bereits gesperrten Zustand. Bestehende Prüfungen für beide Stapelreihenfolgen,
Entwurfspause, vollständiges Schließen, Space/Enter/Backspace und Escape müssen grün bleiben.

**Nachweise:** [Sonde](ui-design-welle.implementation-r2.probe.mjs),
[JSON](ui-design-welle.implementation-r2.json) (`disarmedBeforeFlowEnds`,
`disarmedAfterFlowEnds`, `disarmedFallback`, `disarmedAfterBackstop`,
`disarmedKeyCommands`, `disarmedWithEscapeCommands`) und
[Bild des verbleibenden Dialogs](ui-design-welle.implementation-r2-disarmed.png).
Die JSON-Datei enthält auch die erfolgreichen Nachprüfungen von UI-DI01–03. Die Nachweise aus
Runde 1 wurden unverändert erhalten.

### Ausgeführte Prüfungen und Grenzen

| Prüfung am Stand `f73c2a9` | Ergebnis |
|---|---|
| `npm run build` | grün; bestehender Hinweis zu großen Bundles |
| `npm run lint` einschließlich CSS-Audit | grün |
| `vitest run src/ws/statusStore.test.ts --maxWorkers=1` | **31/31** grün, einschließlich Persistieren und erneutem Modulimport |
| Playwright `dialogs.spec.ts` + `keyboard-guards.spec.ts`, `serial-guards --no-deps --workers=1` | **54/54** grün: 29 Dialog- und 25 Tastaturtests |
| Unabhängige Review-Sonde am Mock `127.0.0.1:4188` | UI-DI01–03 bestätigt behoben; UI-DI04 reproduziert, einschließlich Wartezeit und Gegenprobe der Tastaturbefehle |
| `git diff --check` | grün |

Die neue Gate-Wechsel-Probe ergänzt die vorhandenen Tests: Der dortige Wechsel „Programm
läuft → idle“ sperrt nicht den gesamten Content-Bereich durch Disarm und erfasst diesen
Ersatzpunkt daher nicht. Die im Claude-Bericht genannten vollständigen 1623 Unit- und
216 Browsertests wurden in dieser Runde nicht nochmals vollständig ausgeführt. Backend,
D0-Formatierung und Layoutregeln wurden durch die Nachbesserung nicht funktional geändert.

Alle Browserprüfungen liefen nacheinander mit niedriger Prozesspriorität gegen Mocks. Der
laufende XYZAC-Simulator und der echte Gateway wurden nicht angesprochen oder neu gestartet.
Keine physische Touch-/Screenreader- oder macOS-Safari-/Firefox-Abnahme; die neue
`takeOpener`-Sonderregel für macOS wurde nur im Code geprüft. Nur Review und Nachweise geändert.

---

## Antwort Claude auf Runde 2 · 26. September 2026

**UI-DI04 ist behoben.** Der neue Test war am Stand `f73c2a9` rot, erst in Schritt 1, nach der ersten
Korrektur noch in Schritt 4. Die Abnahme bleibt bei Codex.

| Teil | Änderung |
|---|---|
| Initialziel | Das Ziel muss den Fokus nehmen können: nicht gesperrt, auch nicht über sein Gate, gerendert und im sichtbaren Dialoginhalt. Sonst übernimmt der Container. Das gilt für jede Art, auch für explizite Selektoren (`button.selected`, `input.refSearch`), und damit auch beim Öffnen im gesperrten Zustand. Die Sichtbarkeitsregel für Run from line bleibt. |
| Landung | `fallbackFocus` prüft nach `focus()`, ob der Fokus angekommen ist, statt dem Aufruf zu vertrauen. |
| Fokus fällt auf `body` | Derselbe Disarm sperrt auch ein fokussiertes Feld in einem offenen Dialog, etwa die Suche der G-code Reference. Chromium setzt den Fokus dann auf `body` und meldet ein `focusout` ohne Ziel (geprüft). Die Registry setzt den Fokus einen Frame später auf den **Container** des obersten Dialogs, nicht auf dessen Initialziel. So leuchtet mitten in einem Vorgang kein Feld auf. Eine laufende Fokusrückgabe (`focusReturn.pending`) behält ihre Landung, und ein Fokus auf einem Control, etwa einem Leistenknopf per Zeiger, bleibt unberührt. |

**Test `UI-DI04`** in `dialogs.spec.ts`, vier Schritte:
1. Codex' Folge: Settings wartet unter dem Werkzeugwechsel, Disarm, der Ablauf endet.
2. Settings wird im Disarm-Zustand über den Header geöffnet.
3. G-code Reference unter einem Ablauf, Disarm, der Ablauf endet.
4. Ein einzelner Dialog, dessen fokussiertes Suchfeld der Disarm selbst sperrt.

Jeder Schritt verlangt den Fokus auf dem Container, auch nach 600 ms, also nach den Frames der
Rückgabe. Außerdem prüft er, dass Tab die Safety-Leiste erreicht. In Schritt 1 senden Leertaste,
Enter und Backspace nichts, Escape sendet genau `estop`.

**Grenze:** Firefox und Safari lassen den Fokus bei einem gesperrten Control möglicherweise auf
diesem Control. Dort holt der nächste Tab ihn in den Bereich zurück, weil der Tab-Handler beim ersten
Stopp beginnt. Die Chromium-Tests decken das nicht ab. Es steht auf der Liste für die Live-Prüfung
am Mac.

**Gegenprobe mit der Sonde aus Runde 2:** Die Sonde lief unverändert gegen den neuen Build, nur mit
Ausgabe außerhalb des Repos. Ergebnis:
- `disarmedAfterFlowEnds` und `disarmedAfterBackstop` (nach 2,2 s): Der Fokus liegt auf dem Container
  von Settings (DIV); der Hit-Test trifft Settings.
- `disarmedFallback`: Das Initialziel ist weiter gesperrt, der Fokus trotzdem auf dem DIV.
- `disarmedKeyCommands`: leer; mit Escape genau `estop`.
- Die Nachprüfungen von UI-DI01–03 sind unverändert grün.

| Prüfung | Ergebnis |
|---|---|
| `npm run build`, `npm run lint` (inkl. CSS-Audit) | grün |
| Vitest | **1623/1623** |
| Playwright, alle Projekte einzeln (`--no-deps --workers=1`) | **217/217**; `serial-guards` 91, davon `dialogs.spec.ts` 30 |

---

## Codex Implementierungsreview Runde 3

**26. September 2026 · `feat/ui-design-wave` · HEAD `13e12e9`.** Nachprüfung der Antwort auf
Runde 2 und der seitdem geänderten Produktstellen in `DialogFrame.vue`, `inputSession.ts`
und `modalRegistry.ts` samt neuem Browsertest. Umfang weiterhin **DR + D0–D2**.

**Ergebnis: UI-DI04 ist behoben und geschlossen. Keine neuen Befunde im geprüften Umfang.
Implementierungs-Agreement für DR + D0–D2.** Die geschlossenen Befunde UI-DI01–03 bleiben
auch in der erneuten unabhängigen Gegenprobe geschlossen.

| ID | Ergebnis der Nachprüfung | Status |
|---|---|---|
| UI-DI01 | Werkzeugwechsel bleibt bei nachträglich geöffneten Settings zugleich sichtbarer und aktiver Dialog; Tab erreicht Abort. Beide Stapelreihenfolgen bestehen weiterhin die Browsertests. | geschlossen |
| UI-DI02 | Beim Ende des unteren Ablaufs bleibt Cancel der darüberliegenden Shutdown-Rückfrage fokussiert; das verdeckte Suchfeld bleibt leer. Auch die asynchrone Add-Antwort belässt den Fokus in Settings. | geschlossen |
| UI-DI03 | Der persistierte alte `quiet`-Eintrag erzeugt nach Neuladen weiterhin `Messages (0)` und keine Banneraktion. | geschlossen |
| UI-DI04 | Nach Disarm und beendetem Werkzeugwechsel landet der Fokus auf dem Settings-Container und bleibt dort, auch nach 2,2 s. Bereits gesperrt geöffnete Settings und beide G-code-Reference-Fälle bestehen den neuen Test. | geschlossen |

### Nachprüfung UI-DI04

Die Korrektur erfüllt das Ziel aus Runde 2:

- `initialTarget` verwirft nun auch bei expliziten Selektoren durch das übergeordnete
  Fieldset gesperrte Ziele (`:disabled`) sowie nicht gerenderte Ziele. Der Dialog-Container
  übernimmt. Die Sichtbarkeitsregel für Run from line bleibt erhalten und besteht ihren Test.
- `fallbackFocus` prüft die tatsächliche Fokuslandung, bevor die Rückgabe als erfolgreich gilt.
- Fällt der Fokus beim Sperren eines bereits fokussierten Feldes auf `body`, setzt die Registry
  ihn im nächsten Frame auf den obersten Dialog-Container. Eine laufende Fokusrückgabe und
  ein bereits auf einem anderen Control gelandeter Fokus bleiben unberührt.

Der neue Test `UI-DI04` in `e2e/dialogs.spec.ts` deckt vier Fälle ab: Settings unter einem
endenden Werkzeugwechsel nach Disarm; Settings bereits im Disarm-Zustand öffnen;
G-code Reference unter einem endenden Werkzeugwechsel nach Disarm; und das Sperren des
fokussierten Suchfelds in einer allein geöffneten G-code Reference. Der Container bleibt
jeweils auch nach 600 ms fokussiert; Tab erreicht die Safety-Leiste.

Die **unabhängige Sonde aus Runde 2** bestätigt die ursprüngliche Fehlerfolge zusätzlich:
`disarmedAfterFlowEnds` und `disarmedAfterBackstop` zeigen beide `DIV` in Settings,
der Hit-Test trifft Settings. Das ursprünglich ausgewählte Initialziel ist nachweislich
weiter gesperrt (`candidateDisabled: true`), bei weiterhin aktivem Modal-Schutz.
Space, Enter und Backspace erzeugen keine Befehle; Escape erzeugt genau `estop`.

**Nachweise:** [Sonde aus Runde 2](ui-design-welle.implementation-r2.probe.mjs),
[neues JSON](ui-design-welle.implementation-r3.json) und
[Bild des verbleibenden Dialogs](ui-design-welle.implementation-r3-disarmed.png).
Die Sonde wurde inhaltlich unverändert ausgeführt; lediglich Modulauflösung und
Ausgabepräfix wurden für die temporäre Kopie angepasst. Die historischen Nachweise aus
Runde 1 und 2 bleiben unverändert.

### Ausgeführte Prüfungen und Umfang des Agreements

| Prüfung am Stand `13e12e9` | Ergebnis |
|---|---|
| `npm run build` | grün; bestehender Hinweis zu großen Bundles |
| `npm run lint` einschließlich CSS-Audit | grün |
| `vitest run src/useNumberKeypad.test.ts --maxWorkers=1` | **4/4** grün; Entwurfs-Lebenszyklus, die Fokusabnahme erfolgt im Browser |
| Playwright `dialogs.spec.ts` + `keyboard-guards.spec.ts`, `serial-guards --no-deps --workers=1` | **55/55** grün: 30 Dialog- und 25 Tastaturtests |
| Unabhängige Review-Sonde am Mock `127.0.0.1:4188` | UI-DI01–04 bestätigt behoben; inklusive verzögerter Add-Antwort, 2,2-s-Wartezeit und Gegenprobe der Tastaturbefehle |
| `git diff --check` | grün |

Die im Claude-Bericht genannten vollständigen 1623 Unit- und 217 Browsertests wurden in
dieser Runde nicht nochmals vollständig ausgeführt. Backend, D0-Formatierung und Layoutregeln
wurden durch die Nachbesserung nicht funktional geändert.

Das Agreement schließt die Review-Befunde dieser Paketgruppe. Die im Plan vorgesehenen
Pakete **D3–D6 und D7–D10** einschließlich ihrer Geometrie- und Abschlussprüfungen bleiben
ausstehend; daraus folgt noch keine Merge-Freigabe für die gesamte Design-Welle. Die
Referenzmessungen aus DR ersetzen nicht die Messung der später umgesetzten Navigation und
Formulare. Die bewusst auf D4 verschobenen Feldeinheiten für Probing und Toolsetter bleiben
Teil dieses Pakets.

Alle Browserprüfungen liefen in Chromium nacheinander mit niedriger Prozesspriorität gegen
isolierte Mocks. Der laufende XYZAC-Simulator und der echte Gateway wurden nicht angesprochen
oder neu gestartet; der zusätzliche Review-Mock wurde anschließend beendet. Keine physische
Touch-/Screenreader- oder macOS-Safari-/Firefox-Abnahme. Das in Claudes Antwort genannte
Fokusverhalten gesperrter Controls auf diesen Browsern bleibt eine Prüfgrenze der Live-Abnahme.
Nur Review-Dokumentation und Nachweise geändert, kein Produktcode.

---

## Codex Implementierungsreview Runde 4

**26. September 2026 · `5cc74a5..f0123f5` · Branch `feat/ui-design-wave` ·
Handshake R3 · Umfang WP-D3 bis WP-D6b, Plan Fassung 3.**

**Ergebnis: Noch kein Implementierungs-Agreement für D3–D6. Sieben reproduzierbare
Befunde UI-DI05–11 offen, davon zwei P1.** Das bisherige Agreement für DR + D0–D2
und die Schließung von UI-DI01–04 bleiben bestehen. Die vereinbarten 44 px Touch-Höhe
im Seitenpanel und der Verzicht auf eine Ruhemarke an Hold-Buttons sind ausdrücklich
akzeptierte Operator-Entscheidungen, keine Befunde.

Geprüft wurden die Produktänderungen, Claudes Umsetzungsbericht/Messungen/Gates und
die betroffenen Tests. Die ergänzenden Änderungen `abf0a6a` (Touch), `93387e9`
(Viewer-Label-Repaint) und `2461d04` (Handshake-Tooling) wurden einbezogen. Gemeinsame
Reiter, Formularfelder, Einheiten und Aktionsgruppen verbessern die Struktur. Die
offenen Punkte betreffen konkrete Interaktionen und das verbleibende Platzbudget
im vereinbarten schmalen Layout.

### Befundübersicht

| ID | Priorität | Paket | Befund | Status |
|---|---|---|---|---|
| UI-DI05 | P1 | D6 | Gleicher Programmpfad mit neuer Revision bricht Start-/Step-/Resume-/Run-from-line-Hold nicht ab | offen |
| UI-DI06 | P1 | D3 | Ctrl/Alt/Meta + Pfeil auf fokussiertem Reiter erreicht die Jog-Tastenbelegung | offen |
| UI-DI07 | P2 | D3/D4 | Gleichnamige Spindel-Radiogruppen in Settings und Run from line löschen die sichtbare Auswahl | offen |
| UI-DI08 | P2 | D6 | Parameterdialog bindet Execute an eine alte Makro-Kopie; neue Befehlsrevision bricht Hold nicht ab | offen |
| UI-DI09 | P2 | D5 | Program-Kopf verdrängt bei Touch hoch 150 % den Codeinhalt vollständig | offen |
| UI-DI10 | P2 | D5 | Werkzeugbeschreibung kollabiert bei Touch hoch 150 % auf einzelne Buchstaben | offen |
| UI-DI11 | P2 | D3 | Wechsel des Probing-Verfahrens stoppt einen laufenden Tastatur-Jog nicht | offen |

**Gemeinsame Nachweise:** [unabhängige Browser-Sonde](ui-design-welle.implementation-r4.probe.mjs)
und [Messwerte/Befehlsprotokoll](ui-design-welle.implementation-r4.json). Alle unten genannten
Maschinenbefehle wurden ausschließlich am isolierten Mock aufgezeichnet; es wurde keine
reale Maschinenbewegung ausgelöst. Die Sonde prüft bei den Revisionsfällen ausdrücklich,
dass die Änderung vor Ablauf des Holds im UI angekommen ist. `errors` ist leer.

### UI-DI05 · P1 — Programmrevision fehlt in allen vier Hold-Bindungen

**Stellen:** [GcodePanel.vue:798](../../lcnc-webui/src/GcodePanel.vue#L798),
[Step/Resume](../../lcnc-webui/src/GcodePanel.vue#L803),
[Run from line](../../lcnc-webui/src/GcodePanel.vue#L1081).
Der Plan verlangt Pfad **und Revision**, bei Run from line zusätzlich die Zeile.
Die Implementierung verwendet nur `activeFile` bzw. `activeFile:selectedLine`.

**Reproduktion:** `/A.ngc` laden, Hold beginnen, nach 100 ms eine neue
`viewer_gcode_ready`-Version für denselben Pfad senden und über `/gcode` geänderten
Inhalt liefern. Der neue Text steht nach 191–200 ms sichtbar im Codefenster, während
der Button weiterhin `holding` ist. Nach Ablauf sendet jede der vier Aktionen ihren
Befehl: `cycle_start`, `auto_step`, `cycle_resume` bzw. `auto_run`. Kein Abbruchhinweis.
Bei Run from line enthält der Befehl zudem `entry_x: 0` aus der alten Analyse, obwohl
die neue Programmfassung vor Zeile 3 nach X20 fährt. Ein Wechsel auf `/B.ngc` dagegen
bricht korrekt ab und zeigt „Selection changed — hold again“.

**Folge:** Die Bestätigung überdauert einen inhaltlichen Programmwechsel. Run from line
kann zusätzlich einen neuen Programmstand mit alten Einstiegsvorgaben kombinieren.
Die vorhandene Gegenprobe mit anderem Pfad deckt diesen Fall nicht ab.

**Abnahme:** Alle vier Holds an die tatsächlich veröffentlichte Programmrevision
binden; bereits deren Ankunft muss einen laufenden Hold invalidieren, auch wenn der
Textabruf noch dauert. Run from line muss die Analyse/Einstiegsvorgaben vor einem
erneuten Ausführen aktualisieren oder den Dialog entsprechend ungültig machen.
Regressionstest für gleiche Datei/neue Revision bei allen vier Aktionen, einschließlich
verzögertem Textabruf; Pfad-/Zeilenwechsel und bestehende Abbruch-/Gate-Regeln erhalten.
JSON: `programHolds`, `changedPathControl`.

### UI-DI06 · P1 — Modifizierte Navigationstasten starten Jog auf einem Reiter

**Stellen:** [TabNav.vue:52](../../lcnc-webui/src/TabNav.vue#L52),
[useKeyboardShortcuts.ts:104](../../lcnc-webui/src/useKeyboardShortcuts.ts#L104).
`TabNav` kehrt bei Alt/Ctrl/Meta vor `preventDefault()` zurück. Der globale Handler
ordnet anschließend allein anhand von `e.key` die Maschinenaktion zu.

**Reproduktion:** Keyboard-Jog aktivieren, den Hauptreiter Program fokussieren.
Pfeil rechts allein verschiebt nur den Fokus auf MDI und sendet keinen Befehl.
`Ctrl+ArrowRight`, `Alt+ArrowRight` und `Meta+ArrowRight` senden dagegen jeweils
`jog_cont(axis: 0, vel: 10)` und beim Loslassen `jog_stop(axis: 0)`; der Fokus bleibt
auf Program. Für die Gegenprobe wurden normale Browser-Tastaturereignisse verwendet.

**Folge:** Eine Tastenkombination zur Navigation auf einem fokussierten Reiter kann
die Maschine bewegen. Der D3-Vertrag „alle Pfeile lokal abgefangen“ ist unvollständig.
Das Loslassen stoppt korrekt; der Befund betrifft den unerwarteten Start.

**Abnahme:** Navigationstasten dürfen auf den Reitern auch mit Modifikatoren nicht
in die Maschinenbelegung fallen. E-Stop und die bestehenden Keyup-Stopps erhalten.
Alle sechs Navigationstasten mit/ohne Modifikatoren an Haupt- und Probing-Reitern
prüfen; Settings bleibt ebenfalls geschützt. Eine positive Gegenprobe außerhalb
der Navigation muss den vorgesehenen Tastatur-Jog weiterhin erlauben.
JSON: `modifiedTabKeys`.

### UI-DI07 · P2 — Settings entmarkiert die Spindelvorwahl im Run-from-line-Dialog

**Stellen:** [GcodePanel.vue:1065](../../lcnc-webui/src/GcodePanel.vue#L1065),
[SettingsPanel.vue:742](../../lcnc-webui/src/SettingsPanel.vue#L742).
Beide Optionsgruppen verwenden den nativen Radio-Namen `rflSpindleDir`.
Die getrennten ARIA-Gruppen isolieren die HTML-Radiogruppen nicht voneinander.

**Reproduktion:** Bei Voreinstellung Fwd Run from line öffnen und Rev wählen.
Über die Kopfzeile Settings öffnen und ohne Änderung wieder schließen. Vorher ist
Rev angehakt; während und nach Settings sind alle drei Optionen im verbleibenden
Run-from-line-Dialog ungeprüft. Der weiterhin gespeicherte Vue-Wert bleibt jedoch
`reverse`: Ein voller Hold sendet `auto_run` mit `spindle_dir: "reverse"` und
`spindle_speed: 10000`. Schon das Mounten der auch im Hintergrund vorhandenen
Settings-Gruppe reicht für den nativen Gruppeneffekt.

**Folge:** Sichtbarer Auswahlzustand und tatsächlich ausgeführte Spindelvorwahl
widersprechen sich nach einer erlaubten Dialogfolge.

**Abnahme:** Jede unabhängige Optionsgruppe benötigt einen eigenen nativen Namen,
gegebenenfalls pro Instanz. Die persistierte Voreinstellung und die aktuelle
Ausführungswahl dürfen einander nicht entmarkieren. Beide Öffnungsreihenfolgen,
Settings auf einer anderen Sektion und alle drei Werte prüfen: sichtbares `checked`,
Modellwert und gesendete Vorwahl müssen zusammenpassen.
JSON: `spindleRadioGroups`; [Bild nach Schließen von Settings](ui-design-welle.implementation-r4-spindle-radios.png).

### UI-DI08 · P2 — Execute-Hold im Parameterdialog bemerkt neue Makrorevision nicht

**Stellen:** [useMacros.ts:33](../../lcnc-webui/src/useMacros.ts#L33),
[macroExecuteKey](../../lcnc-webui/src/useMacros.ts#L67),
[gespeicherte Dialog-Kopie](../../lcnc-webui/src/useMacros.ts#L77),
[Execute-Bindung](../../lcnc-webui/src/App.vue#L2280).
Die Settings-Synchronisation ersetzt `userMacros`, während der offene Dialog das
alte Makro-Objekt behält. Sein Hold-Key liest weiter nur diese alte Kopie.

**Reproduktion:** Parametermakro `G0 Z{depth} F{feed}` mit Werten 5/100 öffnen,
Execute halten. Nach 100 ms dieselbe Makro-ID per `settings_changed` auf
`G0 Z-{depth} F{feed}` und einen neuen Namen ändern. Nach 109 ms ist der neue Name
in der Makroleiste sichtbar; Execute hält weiter, Vorschau bleibt `G0 Z5 F100`.
Nach Ablauf wird genau dieser alte Befehl gesendet, ohne Abbruchhinweis. Beim
erneuten Öffnen desselben Makros zeigt der Dialog korrekt `G0 Z-5 F100`.

**Einordnung:** Es wird kein heimlich ausgetauschter neuer Befehl ausgeführt; alte
Vorschau und alter Befehl stimmen überein. Dennoch greift der explizit vereinbarte
Abbruch bei geänderter Makrorevision im Parameterdialog nicht. Der Test für den
parameterlosen Leistenbutton beweist diesen zweiten Ausführungsweg nicht.

**Abnahme:** Auch der offene Dialog muss die aktuelle Revision/Entfernung seines
Makros beobachten und den laufenden Hold abbrechen. Eingabewerte dürfen dabei
erhalten bleiben; vor einem neuen Hold braucht es einen eindeutigen sichtbaren
Stand, ohne stilles Überschreiben des Entwurfs. Befehls-, Parameterdefinitions-
und Wertänderung sowie Entfernen prüfen, über Settings-Synchronisation und lokalen
Setter. Nach erneutem Halten genau den sichtbaren Befehl einmal ausführen.
JSON: `macroRevision`.

### UI-DI09 · P2 — Im schmalen Program-Tab bleibt keine Höhe für Code

**Stellen:** [Program-Kopf](../../lcnc-webui/src/GcodePanel.vue#L794),
[schmales Aktionsraster](../../lcnc-webui/src/GcodePanel.vue#L1119),
[Codebereich](../../lcnc-webui/src/GcodePanel.vue#L1186).

**Reproduktion:** Vereinbarter DR-Fall 900×1200, Touch, CSS-Zoom 150 %, geladenes
Programm; etwa 271 CSS-px Panel-Innenbreite. Der feste `.panelHead` belegt 272 CSS-px
(408 sichtbare px). Nach Reiterauswahl, Kopf, Fortschritt und Abständen bleiben
`.codeArea` und `.codeViewer` jeweils mit `clientHeight: 0`. Ihre obere Kante liegt
bei y=1251,75 bereits unter dem 1200 px hohen Viewport. Auch die untere Verwaltung
ist angeschnitten. Der Test zur rechten Position von Abort erfasst dieses gesamte
Höhenbudget nicht.

**Folge:** Gerade im ausdrücklich unterstützten schmalen Fall ist der geladene
Code nicht mehr nutzbar. Die horizontale Anpassung der Aktionsgruppe verbraucht die
verfügbare Inhaltshöhe vollständig.

**Abnahme:** Für den schmalen Lesemodus ein tragfähiges vertikales Budget herstellen,
etwa durch zusammenfassbare Verwaltung/Optionen, mit sichtbarem Abort und erreichbaren
Aktionen. Die akzeptierten 44 px Touch-Höhe erhalten. Mit geladenem Programm prüfen:
mehrere tatsächlich lesbare Codezeilen, erreichbare Verwaltung und Hit-Tests innerhalb
des Panels; reine Überlaufunterdrückung oder kleinere Schrift ist keine Abnahme.
JSON: `narrowProgram`; [Screenshot](ui-design-welle.implementation-r4-narrow-program.png).

### UI-DI10 · P2 — Schmale Werkzeugbeschreibung erzeugt überhohen Tabellenkopf

**Stellen:** [Beschreibungsspalte](../../lcnc-webui/src/ToolTablePanel.vue#L925),
[Zellinhalt](../../lcnc-webui/src/ToolTablePanel.vue#L947),
[Umbruchregel](../../lcnc-webui/src/ToolTablePanel.vue#L1146).
Die bisherige Mindestbreite entfällt; `overflow-wrap: anywhere` gilt für Kopf und Zellen.

**Reproduktion:** Gleicher DR-Fall wie UI-DI09, ein Werkzeug T5 „Test cutter“,
Ø6, Z−40,123456, Typ Endmill. Die Beschreibungsspalte schrumpft auf 24 CSS-px
einschließlich Innenabstand. „Description“ bricht auf einzelne Buchstaben um.
Der Tabellenkopf wird 247,25 sichtbare px hoch, der ganze Tabellenviewport hat nur
115,25 px Höhe. Gleichzeitig bleiben 371 CSS-px Tabellenbreite bei 264 CSS-px
Client-Breite: Horizontaler Überlauf besteht trotzdem.

**Folge:** Der erste Blick zeigt nur einen Teil des senkrechten Tabellenkopfs und
keine Werkzeugzeile. Die Beschreibung erfüllt ihre neue Rolle zur Erkennung des
Werkzeugs nicht. Nach gezieltem Scrollen ist T5 im Hit-Test erreichbar; behauptet
wird keine dauerhafte Unerreichbarkeit, sondern die konkret unbrauchbare Text- und
Höhenaufteilung bereits bei nur einem Werkzeug.

**Abnahme:** Eine lesbare Mindestbreite für Beschreibung und einen kompakten Kopf
sicherstellen; schmale Darstellung und übrige Spalten als Ganzes auslegen. Mit
echten Beschreibungstexten und Zahlen im 150-%-Fall prüfen, dass der Kopf nicht den
Inhaltsviewport verbraucht, Werkzeugidentität lesbar bleibt und Aktionen erreichbar
sind. Das ist unabhängig vom Program-Höhenproblem UI-DI09 zu beheben.
JSON: `narrowTools`, `narrowToolsAfterScroll`;
[Ausgangsansicht](ui-design-welle.implementation-r4-narrow-tools.png),
[nach Scrollen zu T5](ui-design-welle.implementation-r4-narrow-tools-scrolled.png).

### UI-DI11 · P2 — Probing-Unterreiter übernehmen den Jog-Stopp nicht

**Stellen:** [Hauptreiter-Watcher](../../lcnc-webui/src/App.vue#L497),
[Verfahrenszustand](../../lcnc-webui/src/App.vue#L362),
[schmale Verfahrensauswahl](../../lcnc-webui/src/App.vue#L1910).
Der neue Jog-Stopp hängt nur an `activeTab`, nicht an `probeView`.

**Reproduktion:** Probing/Outside anzeigen, Fokus auf body, Pfeil rechts halten,
bei weiterhin gehaltener Taste Inside anklicken. Nach dem Verfahrenswechsel und
150 ms Wartezeit steht im Protokoll nur `jog_cont`, kein Stopp. Erst Keyup sendet
`jog_stop`. Dieselbe Folge mit Wechsel zum Hauptreiter Tools sendet sofort die
Stopps für die drei Achsen, bevor die Taste losgelassen wird.

**Folge:** Der D3-Vertrag „ein laufender Jog stoppt beim Tabwechsel“ gilt innerhalb
der neuen Navigation nur teilweise. Es geht um den fehlenden Stopp beim Wechsel;
der vorhandene Keyup-Schutz funktioniert weiterhin.

**Abnahme:** Hauptreiter und Probing-Verfahrenswechsel müssen denselben bedingten
Abbruchpfad für einen laufenden Jog verwenden, im Raster wie im schmalen Selektor.
Tests müssen den Stopp vor Keyup nachweisen und zugleich sicherstellen, dass
Navigation ohne laufenden Jog keine Maschinenbefehle erzeugt.
JSON: `jogTabSwitch`, einschließlich positiver Hauptreiter-Gegenprobe.

### Ausgeführte Prüfungen und Prüfgrenzen

| Prüfung am unveränderten Produktstand `f0123f5` | Ergebnis |
|---|---|
| `npm run build` | grün; bestehender Hinweis zu großen Bundles |
| `npm run lint` einschließlich CSS-Audit | grün |
| `vitest run --maxWorkers=1` | **78 Dateien, 1627/1627 Tests** grün |
| `lcnc-gateway/.venv/bin/python -m pytest -q scripts/test_review_handshake.py` | **6/6** grün |
| Playwright `serial-guards --no-deps --workers=1` | **111/111** grün, einschließlich Dialog-, Tastatur-, D3/D4-/Hold- und Touch-Wächtern |
| Playwright `serial-layout --no-deps --workers=1` | **61 Fälle grün in zwei Läufen:** 55 bestanden, danach Prozessende mit SIGTERM ohne Testfehler; die sechs restlichen Fälle gezielt ausgeführt und 6/6 bestanden |
| Playwright `serial-visual` + `serial-viewer`, `--no-deps --workers=1` | **14/14** grün: 10 Bildvergleichs- und 4 Viewer-Tests; keine Referenzbilder geändert |
| Unabhängige Round-4-Sonde, eigener Mock `127.0.0.1:4188` | sieben oben dokumentierte Befunde; Pfadwechsel, normale Reitertaste, Hauptreiter-Jog-Stopp, neu geöffneter Makrodialog und Tool-Hit-Test als Gegenproben |
| `git diff --check` | grün |

Damit sind **186 unterschiedliche bestehende Browserfälle** erneut erfolgreich
ausgeführt. Dies ist kein erneuter kompletter Lauf der von Claude berichteten
247 Browserfälle; die übrigen Projekte und die unveränderten Backend-Suites wurden
nicht wiederholt. Die grünen vorhandenen Gates erfassen die hier ergänzten
Revisions-/Dialogfolgen und das konkrete Inhaltsbudget bei 150 % bislang nicht.
Die unabhängige Sonde dokumentiert Fehler und ist ausdrücklich kein bestandener
Regressionstest. Bei einer Nachprüfung neue Ausgabedateien verwenden und diese
historischen JSON-/Bildnachweise unverändert lassen.

Alle Browserprüfungen liefen nacheinander mit einem Chromium-Worker und niedriger
Prozesspriorität gegen Mocks; der eigene Review-Mock auf Port 4188 wurde anschließend
beendet. Der laufende LinuxCNC-Simulator und der echte Gateway
wurden nicht angesprochen oder neu gestartet. Keine physische Touch-, Screenreader-,
Safari- oder Firefox-Abnahme; die Touch-Prüfungen emulieren Browserereignisse. Der
Label-Repaint wurde anhand der Änderung und Viewer-Regressionen geprüft, ohne neue
physische Maschinenabnahme. D7–D10 einschließlich der späteren Theme-/Kontrastarbeit
bleiben außerhalb dieser Paketabnahme. Keine Änderungen am Produktcode oder an
bestehenden Tests/Referenzen; nur Review-Dokumentation und eigene Nachweise.

**Nächster Schritt:** Claude beantwortet und korrigiert UI-DI05–11 und fordert über
den Handshake eine Nachprüfung an. Bis dahin bleibt D3–D6 ohne Agreement.

---

## Antwort Claude auf Runde 4 · 26. September 2026

**Alle sieben Befunde UI-DI05–11 sind behoben.** Jeder neue Test war vor der Korrektur rot, und
zwar an der erwarteten Stelle. Die Abnahme bleibt bei Codex. Codex' Nachweise stehen unverändert in
`3184945`; die Korrekturen folgen in `40dd519..74cc096`.

| ID | Änderung | Test (vorher rot) |
|---|---|---|
| UI-DI05 · P1 | `ws/bulkData.ts` führt zwei Revisionen:<br>• die **veröffentlichte** (`<Datei>#<Version>`), gesetzt bei **Ankunft** von `viewer_gcode_ready`, vor dem Textabruf;<br>• die des **angezeigten Texts**, gesetzt, wenn der Abruf eintrifft oder scheitert.<br>Alle vier Hold-Schlüssel tragen Pfad und beide Revisionen. Die Ankunft bricht einen laufenden Hold ab; das Eintreffen des Texts bricht einen Hold ab, der während des Ladens begann. Solange der Text lädt, sind Start, Step und die Run-from-line-Aktion gedimmt („Loading program — wait“). Resume wird dabei nicht gedimmt, sein Schlüssel allein bricht ab. Eine Zeilenauswahl gehört zu Programm und Text: Ein anderes Programm oder ein geänderter Text löscht sie und schließt einen darauf geöffneten Run-from-line-Dialog. Eine Analyse des alten Texts kann deshalb nicht mehr gesendet werden. | `run-hold.spec`:<br>• gleiche Datei, neue Revision mit verzögertem Text für Start, Step und Resume: Hinweis, kein Befehl; nach dem Eintreffen genau ein Befehl;<br>• Warten während des Ladens;<br>• Run from line: kein `auto_run`, Dialog zu, nächster Lauf mit `entry_x` 20 aus dem neuen Text;<br>• anderes Programm löscht die Auswahl.<br>`bulkData.test`: Revision bei Ankunft, Textrevision bei Eintreffen und bei Fehler. |
| UI-DI06 · P1 | `TabNav` verhindert jede Navigationstaste auf einem Reiter, auch mit Ctrl, Alt oder Meta. Nur die bloße Taste (oder Shift) bewegt den Fokus. E-Stop und die Keyup-Stopps bleiben unberührt. | `tabs.spec`: alle sechs Tasten × Ctrl/Alt/Meta/Shift auf Hauptreiter, Probing-Reiter und Settings-Abschnitt: kein Befehl, der Fokus bleibt. Gegenprobe: die bloße Taste ohne Fokus joggt. |
| UI-DI07 | Die Optionsgruppe des Dialogs hat einen eigenen nativen Namen pro Instanz (`useId`); Settings' Vorgabe heißt `rflDefaultSpindleDir`. | `run-hold.spec`: beide Öffnungsreihenfolgen, Settings auf „Display“ und „Machine“, alle drei Werte; sichtbares `checked` = Modell = gesendetes `spindle_dir`. Statisch: `radioNames.test.ts`, ein wörtlicher Radio-Name gehört zu genau einer Komponente (mit den alten Namen rot). |
| UI-DI08 | Der Parameterdialog hält ID, Namen und Werte; das Makro liest er **live** aus der Liste. Titel, Felder, Vorschau, der Execute-Schlüssel (ID + Befehl + Parametersatz + Werte) und das Senden folgen der aktuellen Revision. Bei einem geänderten Parametersatz bleiben eingegebene Werte, neue Parameter zeigen ihren Standard, entfallene verschwinden. Wird das Makro entfernt, zeigt der Dialog „This macro was removed — nothing to run.“, und Execute ist gesperrt. | `run-hold.spec` über `settings_changed` während des Execute-Holds: neuer Befehl und Name, neuer Parameter, Entfernen. Jeweils Abbruch und kein MDI; danach genau der sichtbare Befehl einmal. `useMacros.test`: derselbe Ablauf über den lokalen Setter. |
| UI-DI09 | „Schmal“ wird an **einer** Stelle entschieden: App markiert das Panel mit `.sidePane.narrow`, derselbe Schwellwert, der die Reiter durch Auswahllisten ersetzt. Die Container-Query des Run-Rasters ist entfallen: Ein Schwellwert entscheidet, Auswahllisten und alle Schmal-Regeln kippen gemeinsam. Program klappt schmal die Run-Optionen (M01, /BD) und die Verwaltung hinter einen „More“-Schalter am Ende der Objektzeile. Ist eine Option an, steht sie am Schalter („More · M01“). Die Zeilen rücken auf `--gap-tight`; „40 lines“ entfällt aus der Objektzeile, die Fortschrittszeile nennt es. Ergebnis bei 150 %: **drei ganze Codezeilen** (Touch 32 px), Abort im Panel. Ausgeklappt scrollt der Tab, und der Code behält drei Zeilen. Das neue Token `--code-line-h` (23/32 px) ist die eine Quelle der Zeilenhöhe. | `layout.spec`, DR-Fall 900 × 1200 Touch, 150 % und 100 %: mindestens drei Codezeilen, Abort-Hit-Test im Panel; Verwaltung und Schalter eingeklappt versteckt, ausgeklappt alle per Hit-Test erreichbar; bei 100 % kein Schalter. Bei 150 % am alten Stand rot (0 Zeilen). |
| UI-DI10 | Der Befund betrifft die **Tabelle**. Schmal gilt: Kopf einzeilig, Beschreibung mit 7-em-Untergrenze und Wortumbruch, die Spalte Type entfällt (Filter und Editor tragen sie), enge Zellen, Ø und Z scrollen unter den angehefteten Zeilenaktionen. Der Tools-**Kopf** behält alle Controls: Seine Aktionszeile braucht 270 von 271 px. Ein scrollender Tab kostet 10 px Scrollbalken und bricht sie um. Ein „More“ in der Tools-Objektzeile hatte keinen Platz; er ließ sie überlaufen, gemessen und verworfen. Nebenbefund des Wächters: Die zwei angehefteten Aktionszellen waren 2 px schmaler als der Versatz des Stifts, **in jeder Breite**; dazwischen schien der Z-Wert durch. Beide haben jetzt eine exakte gemeinsame Breite. Angeheftete Kopfzellen sind deckend und über die Farbe gedämpft. | `layout.spec`, gleicher Fall: Tabellenkopf nicht höher als eine Werkzeugzeile, Beschreibung ≥ 7 em und im Hit-Test nicht verdeckt, im ersten Blick eine ganze Zeile, angeheftete Aktionen lückenlos, ihre Kopfzellen deckend, kein seitliches oder ganzes Scrollen des Tabs, Zeilen- und Kopfaktionen erreichbar. |
| UI-DI11 | Hauptreiter und Probing-Verfahren (Raster und schmale Auswahl) nutzen denselben bedingten Stopp (`stopJogOnNavigation`). | `tabs.spec`: Stopp vor dem Keyup beim Wechsel im Raster und in der Auswahl; ohne laufenden Jog kein Befehl. |

**Offen zur Kenntnis:**
- **Drift-Neuparse bricht Holds ab:** Jede Neuparse erhöht die Revision, auch eine Drift-Neuparse nach
  einem Antasten. Ein Hold, in den sie fällt, wird abgebrochen und meldet sich; das ist bewusst
  konservativ.
- **Globale Tastenzuordnung mit Modifikatoren:** Außerhalb der Reiter joggt die globale Zuordnung weiter
  auch mit Modifikator, weil Belegungen bloße Tasten sind. Das ist nicht Teil von UI-DI06 und hier
  nicht erweitert.
- **Abort im ausgeklappten Program-Tab:** Ausgeklappt und zum Code gescrollt kann der Abort des Panels
  aus dem Blick geraten. Während Lauf und Pause trägt das Banner Abort (`bannerAbort`). Stichprobe bei
  150 %: Zustand *running*, ausgeklappt, `.codeArea` ans Ende gescrollt. Der Hit-Test trifft das
  Banner-Abort und auch das des Panels (es blieb im Blick). Der Wächter prüft den eingeklappten
  Ruhezustand.
- **Viewer-HUD bei 150 % im Hochformat (neuer Befund des Wächters):** Der Warntext des HUD ragt unter
  dem Viewer über den oberen Rand des Seitenpanels. Er gehört zu D9 (Viewer-Overlays).

| Prüfung | Ergebnis |
|---|---|
| `npm run build`, `npm run lint` (inkl. CSS-Audit) | grün |
| Vitest | **1632/1632** (80 Dateien) |
| Playwright, alle Projekte einzeln (`--no-deps --workers=1`) | **257/257**: chromium 7, serial-tools 23, serial-lifecycle 3, serial-nine-axis 3, serial-touchoff 25, serial-guards 119, serial-layout 63, serial-visual 10, serial-viewer 4. Keine Referenzbilder geändert. |

**Gegenprobe mit der Sonde aus Runde 4:** Die Sonde lief gegen den neuen Build, auf eigenem Mock
(Port 4188) und mit Ausgabe außerhalb des Repos. Codex' Nachweise blieben unverändert. Zwei
Anpassungen waren nötig, weil sich das geprüfte Verhalten absichtlich geändert hat:
- Bei Run from line schließt sich der Dialog, sobald der neue Text eintrifft. Die Sonde hält das fest
  (`targetGone`), statt auf den verschwundenen Knopf zu warten.
- Der Titel des Makrodialogs folgt dem Makro live. Die Sonde sucht den Dialog deshalb ohne Namen und
  schließt ihn danach mit Cancel.

Ergebnis:
- `programHolds`: Keiner der vier Fälle sendet einen Befehl, und jeder zeigt einen Hinweis. Start und
  Step melden „Unavailable — Loading program — wait“ (während des Ladens gedimmt), Resume meldet
  „Selection changed — hold again“. Der Run-from-line-Dialog ist 234 ms nach Holdbeginn geschlossen.
- `changedPathControl`: unverändert Abbruch.
- `macroRevision`: kein MDI, „Selection changed“. Der offene Dialog zeigt „Review Move Revised“ mit
  der Vorschau `G0 Z-5 F100`.
- `modifiedTabKeys`: Ctrl, Alt und Meta senden nichts, der Fokus bleibt auf Program. Die bloße Taste
  bewegt ihn auf MDI.
- `jogTabSwitch`: Der Verfahrenswechsel sendet die Stopps vor dem Loslassen, wie der Hauptreiter.
- `spindleRadioGroups`: Vor, während und nach Settings ist Rev angehakt. Gesendet wird
  `spindle_dir: "reverse"`.
- `narrowProgram`: `.codeViewer` 99 CSS-px (drei Touch-Zeilen).
- `narrowTools`: Tabellenkopf 36 CSS-px statt 165; T5 per Hit-Test ohne Scrollen erreichbar.
- `errors` ist leer.

---

## Codex Implementierungsreview Runde 5

**26. September 2026 · `3184945..84a1cc5` · Branch `feat/ui-design-wave` ·
Handshake R4 · Nachprüfung der Korrekturen UI-DI05–11 zu D3–D6.**

**Ergebnis: UI-DI05–11 sind behoben und geschlossen. Keine neuen Befunde im geprüften
Umfang. Implementierungs-Agreement für D3–D6.**
Die historischen Nachweise aus Runde 4 im Commit `3184945` sind unverändert.

### Ergebnis je Befund

| ID | Nachprüfung am Stand `84a1cc5` | Status |
|---|---|---|
| UI-DI05 · P1 | Alle vier Holds brechen bei neuer Revision unter gleichem Pfad ab und senden nichts. Die Revision wird vor dem Textabruf veröffentlicht. Ein während des Ladens neu begonnener Resume-Hold bricht auch beim späteren Eintreffen des Texts ab; erst ein weiterer voller Hold sendet genau einmal. Geänderter Text schließt Run from line und löscht die Zeilenauswahl; der Regressionstest bestätigt beim erneuten Ausführen den neuen Einstieg X20. | geschlossen |
| UI-DI06 · P1 | Ctrl/Alt/Meta + Pfeil auf Program senden keine Befehle und lassen den Fokus dort. Die bloße Pfeiltaste bewegt den Fokus. Der Regressionstest deckt alle sechs Navigationstasten mit Modifikatoren an Haupt-, Probing- und Settings-Reitern ab; normaler Jog außerhalb bleibt möglich, E-Stop und Keyup-Stopps bestehen ihre Gegenproben. | geschlossen |
| UI-DI07 | Die Run-from-line-Gruppe hat einen eigenen Namen pro Instanz, die Settings-Voreinstellung einen anderen. Rev bleibt vor, während und nach Settings sichtbar gewählt; gesendet wird weiterhin Rev. Der Regressionstest besteht für beide Öffnungsreihenfolgen und alle drei Optionen, einschließlich Settings auf Display und Machine. | geschlossen |
| UI-DI08 | Der offene Parameterdialog folgt dem Makro über seine ID. Titel und Vorschau wechseln auf die neue Revision, der alte Execute-Hold sendet nichts. Der nächste Hold verwendet den sichtbaren Befehl. Neue Parameter behalten bestehende Eingabewerte und erhalten ihre eigenen Standardwerte; ein entferntes Makro wird erklärt und ist nicht ausführbar. Synchronisations- und lokaler Setter-Pfad sind geprüft. | geschlossen |
| UI-DI09 | Im schmalen Program-Tab stehen bei Touch hoch 150 % drei ganze Codezeilen zur Verfügung, auch im tatsächlichen Hit-Test. More zeigt die Verwaltung; alle fünf Verwaltungsaktionen sind nach Scrollen innerhalb des Panels erreichbar. Die gemessenen Kontrollhöhen bleiben 44 CSS-px. In den zusätzlich geprüften Lauf-/Pausezuständen bleibt Abort erreichbar. | geschlossen |
| UI-DI10 | Der Tabellenkopf bleibt einzeilig und sinkt im ursprünglichen Repro von etwa 165 auf 36 CSS-px. Die Beschreibung hat etwa 77 statt 24 CSS-px Breite; T5 und „Test cutter“ sind direkt sichtbar. Die seltenere Typ-Spalte weicht im schmalen Modus Filter und Editor; die übrigen Zahlen bleiben über das horizontale Scrollen der Tabelle erreichbar. | geschlossen |
| UI-DI11 | Sowohl Outside → Inside als auch der Hauptreiterwechsel senden die Jog-Stopps bereits vor Keyup. Der Regressionstest bestätigt außerdem den schmalen Verfahrensselektor und das Ausbleiben von Maschinenbefehlen bei Navigation ohne laufenden Jog. | geschlossen |

### Unabhängige Gegenprobe und bewusste Verhaltensänderungen

[Sonde Runde 5](ui-design-welle.implementation-r5.probe.mjs) und
[JSON mit Befehlen, Zeitpunkten, Maßen und Hit-Tests](ui-design-welle.implementation-r5.json).
Die Ausgangsfolgen aus Runde 4 wurden erneut am eigenen Mock auf `127.0.0.1:4188`
ausgeführt. Die Sonde prüft ausdrücklich die Ankunft vor Ablauf des Holds und zeichnet
die tatsächlich gesendeten Befehle auf. Keine reale Maschine wurde angesprochen.

Die zwei angekündigten Änderungen sind sachgerecht und wurden in der neuen Sondenkopie
berücksichtigt:

- **Run from line:** Eine Auswahl auf dem alten Text gehört nicht zum neuen Text.
  Der Dialog darf deshalb schließen und die Auswahl verwerfen. Die Sonde erfasst
  das verschwundene Ausführungsziel, statt dessen Weiterbestehen vorauszusetzen.
- **Makroparameter:** Der Dialog zeigt die aktuelle Revision einschließlich Namen.
  Sein Locator hängt deshalb nicht mehr am alten Titel. Nach dem abgebrochenen
  Hold wird der noch offene Dialog explizit geschlossen; beim erneuten Öffnen ist
  dieselbe neue Vorschau sichtbar.

Zusätzlich wird ein Textabruf gezielt zurückgehalten. In diesem Zustand ist Step
gesperrt und Resume weiterhin verfügbar. Ein neu begonnener Resume-Hold wird durch
die Freigabe des Textabrufs wieder abgebrochen; kein Befehl entsteht. Ein weiterer
vollständiger Hold sendet genau einmal `cycle_resume`. Damit sind beide Zeitpunkte
der neuen Bindung geprüft: Veröffentlichung und Eintreffen des Texts.

Die Layout-Nachprüfung misst neben `clientHeight` auch die sichtbaren Zeilengrenzen
und `elementFromPoint`: Im eingeklappten Program-Tab sind drei vollständige Zeilen
tatsächlich les- und antippbar. Der Codeviewer hat 99 CSS-px Höhe statt zuvor 0.
Mit aufgeklapptem More bleiben Edit, Reload, Unload, Files und Upload erreichbar;
bei Lauf und Pause trifft die Gegenprobe sowohl den Panel-Abort als auch den
Banner-Abort. Das ist eine konkrete Stichprobe des neuen Scrollverhaltens, keine
Zusicherung, dass der Panel-Abort in jeder beliebigen Scrollposition sichtbar bleibt.

**Bilder:** [Program eingeklappt](ui-design-welle.implementation-r5-narrow-program.png),
[Program ausgeklappt und zum Code gescrollt](ui-design-welle.implementation-r5-narrow-program-expanded.png),
[Werkzeugtabelle](ui-design-welle.implementation-r5-narrow-tools.png),
[Spindelauswahl nach Settings](ui-design-welle.implementation-r5-spindle-radios.png).
Alle Nachweise der früheren Runden bleiben unverändert. Für spätere Wiederholungen
ebenfalls ein neues Ausgabepräfix verwenden.

### Ausgeführte Prüfungen und Prüfgrenzen

| Prüfung am unveränderten Produktstand `84a1cc5` | Ergebnis |
|---|---|
| `npm run build` | grün; bestehender Hinweis zu großen Bundles |
| `npm run lint` einschließlich CSS-Audit | grün |
| `vitest run --maxWorkers=1` | **80 Dateien, 1632/1632 Tests** grün |
| Playwright `run-hold`, `tabs`, `keyboard-guards`, `dialogs`, `serial-guards --no-deps --workers=1` | **74/74** grün |
| Playwright `serial-layout`, `serial-visual`, `serial-viewer`, `--no-deps --workers=1` | **77/77** grün: 63 Layout-, 10 Bildvergleichs- und 4 Viewer-Tests; keine Referenzbilder geändert |
| Unabhängige Runde-5-Sonde | alle Befund-Gegenproben bestanden (`assertionsPassed: true`), keine Browserfehler; zusätzliche Prüfung des während des Textladens begonnenen Holds und der sichtbaren Codezeilen/Abort-Ziele |
| `git diff --check` und historische Runde-4-Nachweise | grün; keine Änderungen an den Runde-4-Artefakten seit `3184945` |

Damit sind **151 unterschiedliche bestehende Browserfälle** erneut erfolgreich
ausgeführt. Die vollständigen von Claude berichteten 257 Browserfälle wurden nicht
nochmals vollständig ausgeführt. Die unveränderten Python-/Handshake- und Backend-Suites
wurden nicht wiederholt. Die Nachprüfung betrifft die sieben Korrekturen und ihre
betroffenen Interaktionen; das bisherige Agreement für DR + D0–D2 und die Schließung
von UI-DI01–04 bleiben bestehen.

Die konservative Hold-Unterbrechung bei einer Drift-Neuparse ist akzeptabel. Die
globale Tastenbelegung außerhalb von Reitern wurde durch UI-DI06 bewusst nicht
umgestellt. Der in Claudes Antwort benannte HUD-Überlauf im schmalen Hochformat bleibt
Teil von D9; diese Nachprüfung nimmt die späteren Viewer-/Theme-/Kontrastarbeiten
nicht vorweg. **D7–D10 und die Gesamtabnahme bleiben offen.**

Alle Browserprüfungen liefen seriell mit niedriger Prozesspriorität gegen lokale
Mocks; der eigene Review-Mock auf Port 4188 wurde anschließend beendet.
Keine physische Touch-/Screenreader- oder Safari-/Firefox-Abnahme. Der
laufende LinuxCNC-Simulator und der echte Gateway wurden weder angesprochen noch
neu gestartet. Nur Review-Dokumentation und eigene Belege geändert; kein Produktcode,
keine bestehenden Tests und keine Bildreferenzen.

Das Agreement schließt diese Paketgruppe. Zusammen mit dem bisherigen Agreement
sind damit DR + D0–D6 abgenommen; daraus folgt noch keine Merge-Freigabe für die
gesamte Design-Welle.

## Übergabe D7–D10 an Codex · 27. September 2026

**Umfang:** WP-D7 bis D10 aus Fassung 3, Branch-Diff `d6f6fe4..HEAD`. Die Abschnitte oben (WP-D7,
D8b, D8a, D8c, D9, D10a, D10b, D10c) beschreiben je Paket Ausgangslage, Umsetzung, Wächter, Grenzen
und Gates.

**Commits:**

| Paket | Commit | Inhalt |
|---|---|---|
| D7 | `54d20e9` | Eingabehilfen: X oben rechts, Code-Seite in Blöcken, Seiten zeilenweise |
| D8b | `00d4b6e` | Bewegung und erzwungene Farben |
| D8a | `6bb8637` | Textrollen je Theme, Syntaxpalette, Fokusring; `contrast.spec` |
| D8c | `1ab19d7` | Viewer-Palette je Theme, Legende, Automatic/Custom mit Migration |
| D9 | `130cf69` | Viewer-Overlays: HUD passt in den Bereich, eine Befundkarte, Icons mit Namen |
| D10a | `d1c48ef` | tote Reste, Folgepunkte, `DEAD_CLASS`/`EMPTY_RULE` |
| D10b | `4f7190f` | `.text-*`-Familie statt Opazität und Einzeilern, Leerzustände, Laufweite |
| D10c | `ccd2cae` | Tönungsstufen, Button-Achsen, Breitenbericht; der Offline-Label-Test fragt die Beschriftungen |
| Audit | `dbfdaa8` | Fixtures je neuer Audit-Kategorie (Treffer und Nicht-Treffer) |
| Gate | `4076f2c` | `test_suite_runner`: das Offline-Gate hat seit dem Handshake acht Schritte (brach sonst am Backend ab) |

**Abweichungen vom Planwortlaut, bewusst:**
1. **D8 Viewer-Szenen:** Der Plan sah einen Sichtvergleich bekannter Szenen im Projekt
   `serial-viewer` vor. Committed sind stattdessen Prüfungen der gezeichneten Materialfarben, weil
   WebGL-Bilder zwischen VM und CI keine stabile Referenz sind; der Werkzeugdialog maskiert seine
   Canvas aus demselben Grund. Die Szenen je Theme sind gerendert und angesehen worden.
2. **D10 N111:** Der Plan wollte Lade- und Hinweistexte auf `--opacity-muted` setzen. Die in D8
   vereinbarte Regel (UI-D07: keine Opazität für Text) ersetzt das; umgesetzt ist die D8-Regel.
3. **D10 N112:** keine `.text-error`. `--err` ist seit D8a nur eine Flächentönung, Fehlertext liest
   `--danger-text` (`.text-danger`).
4. **D10 N113:** Das Innen-Padding bleibt nach der Pre-Flight-Checkliste literal. Nur die Laufweite
   wird ein Token.
5. **D10 N115:** ein Bericht mit Urteil statt einer Umstellung (px und em skalieren unter CSS-Zoom
   gleich).

**Für den Operator sichtbar** (Live-Sichtprüfung):
- **Tastaturen:** X oben rechts; Code-Seite mit Ziffernblock.
- **Farben:**
  - Textfarben je Theme dunkler bzw. kräftiger, Syntax im hellen Theme dunkler.
  - Nicht gewählte Reiter und Icon-Knöpfe dimmen nur ihre Beschriftung.
  - Fokusring dunkler blau.
  - Dialogtext dunkler.
- **Viewer-Farben:**
  - Neue Standardpalette: Eilgang grün gestrichelt, Limit ocker/gelb, gewählte Zeile schwarz bzw.
    cyan.
  - Gespeicherte Altpaletten laufen als Custom weiter.
  - Legende in Settings.
- **Viewer-Aufbau:**
  - Modus und Warnungen stehen unten links.
  - Die DRO-Karte wird in kurzen Bereichen kleiner.
  - Der ViewCube wird im schmalen Hochformat kleiner.
  - Das Kamera-Fenster hat den Karten-Stil.
- **Arm und Power On:** Ihr grüner Zustand ist eine Spur heller (Aktiv-Stufe statt Füllung).

**Benannte Grenzen:**
- Querformat ab 150 % (WP-DR).
- 9 Achsen bei 150 % im Hochformat für das Setup-Feld (D7).
- Vor beschattetem Metall erreicht keine Viewer-Linie 3:1.
- WebGL-Linien sind 1 px breit, eine breitere Auswahl ist offen.
- Nicht auf Rollen: Achsen-Triaden, TWP-Ebene, Farbskala der Oberflächenkarte, Probing-3D,
  Werkzeugvorschau. Das ist Stoff einer eigenen Viewer-Runde.

**Gates am HEAD:** `python3 scripts/test_suite.py offline` **PASS**
(`runlogs/test-suite/20260927T013250Z-offline/report.json`):

| Teil | Ergebnis |
|---|---|
| Backend-Pytest | 969 |
| 5-Achs-Modell | grün |
| Audit-Tests | 28 |
| Handshake-Tests | grün |
| Lint und Build | grün |
| Vitest | 1660 |
| Playwright, alle neun Projekte | 276/276 |

---

## Codex Implementierungsreview Runde 6

**27. September 2026 · `d6f6fe4..000ceef` · Branch `feat/ui-design-wave` ·
Handshake R5 · Implementierung WP-D7–D10, Plan Fassung 3.**

**Ergebnis: drei offene P2-Befunde UI-DI12–14; noch kein Implementierungs-Agreement
für diese Paketgruppe.** Die bisherigen Agreements für DR + D0–D6 bleiben bestehen.
Es gibt keine neue P1-Feststellung in diesem Review.

### UI-DI12 · P2 · D9: Mit Programm-Zeitleiste überdeckt die Warnkarte Achswerte

**Stellen:** `lcnc-webui/src/ThreeViewer.vue:3744` und `:3753` (kleinste Form trotz
fehlenden Platzes), `:4059` (Warnungen und ScrubBar am unteren Rand).

**Repro:** Fünf Achsen XYZAC, 900 × 1200, Touch-Dichte, CSS-Zoom 150 %, HUD-Einstellung
`md`, geladenes Programm mit gültigen Sequenzdaten für die Zeitleiste. Zwei gewöhnliche
Zustandshinweise reichen: Kompensation Z 0,123 und Rotation 12°; dazu der Maschinenmodus.
Kein Simulationsstart, kein Maschinenbefehl und keine lange Fehlerliste sind nötig.

Die kleinste, vollständig gefaltete DRO-Karte trägt bereits `data-hud-fit="overflow"`.
Trotzdem bleibt sie an ihrem oberen Anker und die Warnkarte an ihrem unteren Anker.
Die beiden Karten überlappen sich **29,08 Bildschirm-px** in der Höhe; der C-Wert wird
überdeckt. Mit sechs Achsen sind es **65,22 px**, sodass B und C betroffen sind.
Auch im unterstützten kompakten Fenster 1024 × 768 bei 100 % überlappen sich die Karten
mit sechs Achsen um **17,78 px**. Die benannte Grenze „Querformat ab 150 %“ erklärt
diese Fälle nicht.

**Belege:** [Fünf Achsen, Hochformat 150 %](ui-design-welle.implementation-r6-5axis-touch-portrait-150-md.png),
[sechs Achsen, kompakt 100 %](ui-design-welle.implementation-r6-6axis-compact-md.png),
[Messdaten](ui-design-welle.implementation-r6.json), Einträge `layouts`.

**Erforderlich:** Auch nach Erreichen der kleinsten DRO-Form muss eine Platzstrategie
greifen, die alle Achswerte und die Befunde lesbar hält. Beispielsweise kann die
Zusatzinformation bedarfsgerecht kompakt werden bzw. einen explizit erreichbaren
Detailbereich erhalten. `overflow` als Datenattribut löst die sichtbare Überdeckung
nicht. Die Entscheidung muss auch Zeitleiste, Kollisions-/Limitbefunde und umbrochene
Hinweise berücksichtigen.

**Abnahme:** Die genannten Fenster mit einer tatsächlich sichtbaren `.scrubBar`
prüfen; alle Achswerte vollständig lesbar und keine Kartenüberdeckung. Der derzeitige
Wächter in `e2e/layout.spec.ts:731` prüft drei Hinweise, lädt aber keine Vorschau mit
Zeitleiste. Er erreicht diesen Fall deshalb nicht.

### UI-DI13 · P2 · D9: Die HUD-Anpassung kann dauerhaft zwischen zwei Größen wechseln

**Stellen:** `lcnc-webui/src/ThreeViewer.vue:3733` (Höhe des bisherigen unteren Blocks),
`:3750` (Messung nur der DRO-Kandidaten), `:4060` (Warnkarte übernimmt die neue Größe).

**Repro:** Dieselbe Programm-/Hinweiskonstellation mit fünf Achsen, Touch-Dichte,
1280 × 800 bei 100 %, gewünschte HUD-Größe `md`. Nach dem Einrichten werden weder
Fenster noch Einstellungen oder Maschinenwerte verändert.

Die DRO- und Warnkarte wechseln fortgesetzt zwischen `hudScale-md` und `hudScale-sm`.
In der zusätzlichen stationären Messung wechseln sie **100-mal in etwa 8,26 Sekunden**.
Die DRO-Höhe springt dabei zwischen **198,19 und 173,97 px**, die Höhe der Warnkarte
zwischen **68,67 und 61,08 px**. Weitere Schwellen wurden im Hochformat 900 × 1200
mit gewünschtem `xl` sowie beim Vergrößern des Desktopfensters gefunden. Nicht jede
Einstiegsfolge löst den Zyklus aus; eine weitere spätere Kontrollmessung bleibt stabil.

**Ursache:** `availH` wird mit der Warnkartenhöhe der bisherigen Skala berechnet.
Passt die größere DRO in diese Resthöhe, vergrößert derselbe Zustandswechsel anschließend
auch die Warnkarte. Der ResizeObserver sieht nun zu wenig Platz und verkleinert beide
wieder. Damit ist erneut Platz für den zuvor verworfenen Kandidaten vorhanden.

**Beleg:** [Sonde](ui-design-welle.implementation-r6.probe.mjs) und
[Zeitreihe](ui-design-welle.implementation-r6.json), insbesondere `oscillation.transitions`
mit Zeitpunkten und tatsächlich sichtbaren Kartenmaßen. Die Messung erfolgt nach
geladener Schrift; `pageerror` blieb leer.

**Erforderlich:** Die benötigte Gesamthöhe eines Kandidaten konsistent messen, auch
für die zugehörige Warnkarte, oder deren Schriftgröße von der DRO-Anpassung trennen.
Die Anpassung muss einen stabilen Endzustand erreichen.

**Abnahme:** An den reproduzierten Schwellen nach dem Layoutwechsel mehrere Sekunden
ohne weitere Eingaben beobachten. Skala, Zeilenhöhen und Faltungen müssen sich
stabilisieren. Eine einzelne Prüfung auf `data-hud-fit="fits"` reicht hierfür nicht;
dieses Attribut bleibt im beobachteten Zyklus grün.

### UI-DI14 · P2 · D8: Die Pfadauswahl besitzt weiterhin nur eine Farbcodierung

**Stelle:** `lcnc-webui/src/viewer/toolpathController.ts:600`, `makeHighlight`.

Der Plan Fassung 3 verlangt unter D8 ausdrücklich: „Auswahl breiter“ als zusätzliches
Merkmal zur Farbe. Die Umsetzung zeichnet die Auswahl weiterhin als gewöhnliche
`LineSegments` mit `LineBasicMaterial`, gleicher Standardbreite und gleicher Geometrie
wie die Pfadlinie. Neu sind die Farbrolle und ihr Live-Update; ein zusätzliches
Formmerkmal wurde nicht implementiert. Die Übergabe benennt das selbst als offene
Grenze.

Damit bleibt die Zuordnung der gewählten Codezeile zum Pfad ausschließlich von der
Farbe abhängig, besonders ungünstig bei dichtem Pfad oder einem ungünstigen
Geometriehintergrund. Eine Legende außerhalb der Szene kann das fehlende Merkmal an
der ausgewählten Linie nicht ersetzen. Das ist eine noch offene Plananforderung,
keine neue Zusatzanforderung an diese Runde.

**Erforderlich:** Ein tatsächlich sichtbares, von der Farbe unabhängiges Merkmal
umsetzen, etwa eine breitere Kontur oder eindeutige Marker am ausgewählten Segment.
Die technische Wahl darf von der im Plan genannten breiten Linie abweichen, wenn sie
dieselbe Erkennbarkeit erreicht. Ein Verschieben dieser Anforderung benötigt eine
ausdrückliche Änderung des vereinbarten Umfangs; die Implementierungsnotiz allein
nimmt sie nicht aus der Abnahme.

**Abnahme:** Auswahl im dünnen und dichten Pfad mit geladenem Modell in allen vier
Themes sichtbar prüfen und das Formmerkmal absichern. Ein Farbwertvergleich erkennt
sein Fehlen nicht.

### Bewertung der übrigen Umsetzung und der angekündigten Abweichungen

- **D7:** X-Anker, 44-px-Tasten, Code-Ziffernblock, Zeichenabdeckung und Besitzerfeld
  im Hochformat sind nachvollziehbar umgesetzt und bestehen die gezielten Wächter.
- **D8 Text und Migration:** Die festen Textrollen, eigene Fokusfarbe, reduzierte
  Bewegung, Forced Colors und die verlustfreie Auto/Custom-Migration sind sinnvoll
  umgesetzt. Die aktuellen Text-Kontrastprüfungen bestehen einschließlich Editor,
  Hinweisen und Themenwechsel. Daraus folgt keine vollständige Barrierefreiheitsabnahme.
- **D8 Viewer-Nachweis:** Materialfarbtests sind ein geeigneter deterministischer
  Wächter für Palette und Verdrahtung. Sie belegen für sich weder die Erkennbarkeit
  vor gerenderter Geometrie noch Transparenz, Linienbreite oder Formunterscheidung.
  Plattformübergreifende WebGL-Pixelreferenzen sind dafür nicht zwingend; ein
  reproduzierbarer Szenenaufbau mit dokumentierter Sichtprüfung und gezielten
  Strukturprüfungen ist ebenfalls möglich. Das temporäre, nicht mitgelieferte
  Szenen-Harness konnte hier nicht nachgeprüft werden. UI-DI14 bleibt offen.
- **D9:** Der gemeinsame Kartenstil, benannte Icons und zusammengeführte Befunde
  passen zur Design-Welle. Die neue automatische Platzanpassung benötigt die beiden
  Korrekturen UI-DI12 und UI-DI13.
- **D10:** Bereinigung, Text-Utilities, Tönungsstufen und Audit-Fixtures sind
  nachvollziehbar. Die Ersatzentscheidung Textrollen statt Textopazität folgt D8;
  `.text-danger`, das beibehaltene Padding und der begründete Breitenbericht erfordern
  keine weiteren Änderungen. Im aktuellen Fassung-3-Plan steht bei N111 bereits die
  Textrollenregel; die Übergabe beschreibt dort einen älteren Wortlaut.

### Verifikation und Prüfgrenzen

Eigene Prüfungen am Produktstand `000ceef`:

- Build und ESLint/CSS-Audit bestanden.
- Vitest: **82 Dateien, 1660 Tests bestanden**.
- Audit- und Suite-Runner-Pytest: **42 Tests bestanden** (28 + 14).
- Gezielte Browserprüfungen für Eingabesitzungen, Formulare, Rückmeldungen,
  Kontrast und Darstellung: **47/47 bestanden**.
- Layout-Regressionsprüfungen für HUD, Eingabeleisten und ihre Negativkontrollen:
  **8/8 bestanden**.
- Bestehende Bildreferenzen und Viewerprüfungen: **15/15 bestanden** (10 + 5).
  Damit wurden **70 Browsertests** frisch ausgeführt; keine Bildreferenz wurde ersetzt.
  [Protokolle der Prüfungen](ui-design-welle.implementation-r6.evidence.txt).

Die unabhängige [Sonde](ui-design-welle.implementation-r6.probe.mjs) lädt eine Vorschau
mit gültigen Sequenzdaten, damit die Zeitleiste wirklich erscheint. Sie misst
20 Kombinationen aus Achszahl, Fenster, Zoom und gewünschter HUD-Größe, zusätzlich
21 Höhenschwellen und zwei längere stationäre Zeitreihen. Die
[JSON-Belege](ui-design-welle.implementation-r6.json) enthalten auch die Mock-Befehle;
es wurde kein Maschinenlauf ausgelöst.

Der übergebene Offline-Bericht `runlogs/test-suite/20260927T013250Z-offline/report.json`
ist PASS und nennt `4076f2c` als geprüften Commit. Zwischen diesem Stand und `000ceef`
kam nur die Übergabedokumentation hinzu; die Produktbasis ist dieselbe. Die vollständige
Backend- und Browser-Suite wurde in diesem Review nicht nochmals als Gesamtgate gestartet.

Alle Browserprüfungen liefen seriell mit niedriger Prozesspriorität gegen lokale
Mocks. Keine physische Touch-/Screenreader- oder Safari-/Firefox-Abnahme und kein
Live-XYZAC-Simulationsabschluss. LinuxCNC und der echte Gateway wurden nicht
angesprochen oder neu gestartet. Nur Review-Dokumentation und eigene Belege geändert;
keine Produktänderung und kein Update bestehender Tests oder Bildreferenzen.
Der eigene Review-Mock auf Port 4188 wurde nach den Messungen beendet.

---

## Antwort Claude auf Runde 6 · 27. September 2026

Alle drei Befunde angenommen und behoben. Jeder Wächter war vor der Korrektur nachweislich rot.

### UI-DI12 — die Karten überdecken sich mit Zeitleiste

**Ursache:** Mein Wächter lud kein Programm mit Zeitleiste. Mit der Sim-Leiste ist die untere Spalte
so hoch, dass auch die kleinste DRO-Form nicht mehr darüber passte. `overflow` war dann nur ein
Attribut, keine Strategie.

**Korrektur** (`fitHud`, Reihenfolge der Kandidaten):
1. DRO-Stufe von der eingestellten Größe abwärts bis `sm`, dabei Maschinenspalte, F/S und
   Werkzeugzeile falten.
2. Reicht das nicht, faltet die Befundkarte auf **eine Zeile** („MACHINE · G54 · 3 warnings“). Ein
   Knopf („Show viewer warnings“, `aria-expanded`) öffnet sie ausdrücklich. Geöffnet darf sie die
   DRO bewusst überdecken, bis man sie wieder faltet.
3. Als letzte Stufen gibt es `xs` (Faktor 0,7) und `xxs` (0,6). Beide werden nie in den Settings
   angeboten. `xxs` zeichnet die Werte in 12 CSS-px, der Grundgröße der Oberfläche (bei 150 % sind
   das 18 Gerätepixel). Damit bleiben auch 6 Achsen bei 150 % im Hochformat vollständig sichtbar,
   wenn das Urteil der Kollisionsprüfung die zweite Zeile der Sim-Leiste umbricht.

Außerdem:
- Die Befundkarte bleibt links neben der ViewCube-Spalte, wie die DRO-Karte. Gefaltet lag sie im
  schmalen Hochformat unter den Schnellknöpfen.
- Zwischen DRO-Karte und unterer Spalte gilt der enge Abstand (4 px) statt des Viewer-Rands (12 px).

**Ergebnis** in den von dir genannten Fenstern:

| Fall | Form | Belegung |
|---|---|---|
| 5 Achsen, 150 % Hochformat | `sm`, alles gefaltet, Befundzeile gefaltet | passt |
| 6 Achsen, 1024 × 768 | `sm`, gefaltet | passt |
| 6 Achsen, 150 % Hochformat | `xxs`, gefaltet (die Sim-Leiste mit Prüfurteil: 99 px) | passt |

Alle Achswerte sind sichtbar, keine Karte überdeckt eine andere.

**Wächter** (`layout.spec`, beide Profile, vier Viewports bei 100 % plus Hochformat bei 150 %, HUD
`md` und `xl`): Geladen ist eine Vorschau mit Sequenzdaten, die Sim-Leiste ist sichtbar.
- Geprüft wird, dass DRO-Karte, Befundkarte, Sim-Leiste, ViewCube und Schnellknöpfe im Viewer liegen
  und sich nicht überschneiden.
- Jede Achszeile wird gezeigt.
- Eine gefaltete Befundkarte nennt „3 warnings“ und bietet den Knopf.
- Rot ohne die Faltstufe der Befundkarte („the DRO card fits“ bei 150 % Hochformat und 1024 × 768).

### UI-DI13 — die Anpassung schwingt

**Ursache:** wie beschrieben. Die untere Spalte wurde in der Stufe des aktuellen Zustands gemessen,
die Wahl änderte dann diese Stufe.

**Korrektur:** Jeder Kandidat wird **vollständig** gemessen: DRO-Karte und Befundkarte in der Stufe
und Faltung des Kandidaten, die untere Spalte samt Sim-Leiste in ihrer echten Höhe, danach wird
zurückgesetzt. Die Wahl hängt nur noch von Bereich und Inhalt ab, nicht mehr vom aktuellen Zustand.
Ein Wechsel, den die Wahl selbst auslöst, führt deshalb zur selben Wahl.

**Wächter:** An allen Fällen oben wartet der Test, bis sich der Inhalt der Sim-Leiste gesetzt hat,
und beobachtet dann zwei Sekunden lang (20 Stichproben) die Klassen beider Karten. Es muss genau eine
Form bleiben. Rot mit der alten Messung: „the HUD form settles“ bei 1024 × 768 für beide Profile.

Das Warten ist nötig, weil das Urteil der Kollisionsprüfung („No moving pairs“) etwa 240 ms nach dem
Laden in der Sim-Leiste erscheint. Die Leiste wächst dadurch von 85 auf 99 px, und die Anpassung
wechselt berechtigt einmal, etwa von `sm` auf `xs`. Ohne das Warten zählte der Test diesen einen
Wechsel als Schwingen; gemessen war es keines, die Form blieb danach stehen.

### UI-DI14 — die Auswahl nur über die Farbe

**Korrektur:** Die gewählte Zeile wird zusätzlich als **breite Linie** gezeichnet:
- `LineSegments2`/`LineMaterial` aus Three, 3 CSS-px in Bildschirmeinheiten, also unabhängig vom
  Zoom, gegenüber 1 px für den Pfad. Die Farbe kommt aus derselben Rolle.
- Es sind dieselben Segmente wie bei der 1-px-Linie, höchstens 8192 Paare.
- Die Auflösung für die Pixelbreite liest die Linie vor jedem Zeichnen aus dem Renderer.

**Wächter:**
- **Unit-Test:** ein `LineSegments2` mit `linewidth` 3 und `worldUnits: false`, genau die
  Segmente der gewählten Zeile, die Farbe folgt der Rolle.
- **`e2e/scenes.viewer.spec.ts`** (neu, in `serial-viewer`, im Repo): Maschinenmodell mit dichtem
  und dünnem Pfad, Limit-Überschreitung, gefahrenem Pfad und gewählter Zeile, in allen vier Themes.
  - Geprüft wird die Struktur: gezeichnete Rollenfarben; die breite Auswahl ist sichtbar, trägt
    Segmente und ist mindestens 3 px breit.
  - Die acht Bilder hängt der Test an den Bericht, mit `SCENE_OUT` auch in einen Ordner.
  - Ich habe sie angesehen. Die Auswahl hebt sich über die Breite ab: dicker schwarzer Strich im
    hellen, dicker cyanfarbener in den dunklen Themes, im dichten wie im dünnen Pfad.

  Damit ist der Szenenaufbau reproduzierbar; die Bilder sind bewusst keine Pixelreferenzen.

### Nebenbefund aus deinen Belegen

In deinen Bildern stand in der Sim-Leiste „sweep: TNaN“. Das Etikett las die Werkzeugnummer aus dem
nicht-reaktiven Zwischenspeicher des Viewers, der mit `NaN` startet, und blieb auf dem Wert des
ersten Renderns stehen. Jetzt liest es den reaktiven Status, und eine nicht-endliche Nummer heißt
„no tool loaded“.

### Zu deiner Anmerkung zu N111

Richtig: Fassung 3 nennt bei N111 bereits die Textrollenregel. Meine Übergabe beschrieb einen
älteren Wortlaut. Umgesetzt ist, was Fassung 3 sagt.

**Gates:**
- build, lint, Vitest (**1661**) und Audit-Tests (**28**) grün.
- Playwright **277/277** über alle neun Projekte; `serial-layout` 65, `serial-viewer` 6 (neu:
  `scenes.viewer.spec.ts`).

---

## Codex Implementierungsreview Runde 7

**27. September 2026 · `6fe1cd2..883465a` · Branch `feat/ui-design-wave` ·
Handshake R6 · Nachprüfung UI-DI12–14 zu D7–D10.**

**Ergebnis: Die drei Korrekturen schließen UI-DI12–14. Zwei weitere P2-Befunde
UI-DI15–16 verhindern noch das Agreement für D7–D10.** Sie betreffen die Inhalte
der Programm-Zeitleiste und den Simulationshinweis im unterstützten schmalen Layout.
Die erweiterten Prüfungen mit Limitbefund und aktiver lokaler Simulation machen
diese bestehenden Engpässe sichtbar. Die bisherigen Agreements für DR + D0–D6
bleiben gültig.

### Nachprüfung der drei Korrekturen

| ID | Ergebnis am Stand `883465a` | Status |
|---|---|---|
| UI-DI12 | Die ursprüngliche Überdeckung der Achswerte durch die Warnkarte ist in allen 20 Kombinationen aus fünf/sechs Achsen, Fenster, Zoom und gewünschter HUD-Größe beseitigt. Alle Achswerte bleiben sichtbar. Die kompakte Warnkarte nennt die Anzahl; sowohl drei Zustandshinweise als auch ein zusätzlicher langer Programmhinweis lassen sich bei 150 % per Klick öffnen und wieder schließen. | geschlossen |
| UI-DI13 | Die vollständige Kandidatenmessung stabilisiert die Anpassung. Keine Oszillation in den 20 Kombinationen, an 21 Höhenschwellen und in den beiden längeren Zeitreihen. Am ursprünglichen Repro 1280 × 800, Touch, fünf Achsen, `md` bleibt die Form über 200 Stichproben konstant. | geschlossen |
| UI-DI14 | Die Auswahl wird zusätzlich mit `LineSegments2` und `LineMaterial` in 3 Bildschirmpixeln gezeichnet. Der neue Unit-Test prüft Segmentinhalt, Breite, Löschen der Auswahl und Farbwechsel; der Viewer-Test besteht auch seine wiederholten Szenen-Neuaufbauten. Alle acht neu erzeugten Szenenbilder wurden angesehen: Die Auswahl hebt sich in dünnem und dichtem Pfad in allen vier Themes durch ihre Breite ab. | geschlossen |

[Fortgeschriebene unabhängige Sonde](ui-design-welle.implementation-r7.probe.mjs),
[Messdaten und Zeitreihen](ui-design-welle.implementation-r7.json),
[sechs Achsen bei 150 %, gefaltete Hinweise](ui-design-welle.implementation-r7-6axis-touch-portrait-150-md.png),
[geöffnete Hinweise einschließlich Programmwarnung](ui-design-welle.implementation-r7-warnings-program.png).
Die historischen R6-Belege im Commit `6fe1cd2` bleiben unverändert.

Die ausdrücklich geöffnete Warnkarte darf vorübergehend über der DRO liegen:
Das ist eine angeforderte Detailansicht mit erreichbarem Rückweg. Die Sonde prüft
den tatsächlichen Hit-Test des Schließknopfs und die Sichtbarkeit der Warnzeilen.
In ihrer Sechsachs-Konstellation meldet `data-hud-fit` noch `overflow`, obwohl sich
die geschlossenen Karten nicht mehr überdecken: Der letzte Zwischenraum ist kleiner
als der vorgesehene Abstand. Die sichtbare ursprüngliche Überdeckung ist behoben;
dieses Attribut allein ist deshalb weder ein ausreichender Erfolgs- noch Fehlernachweis.

Der reproduzierbare Szenentest ist jetzt im Repository. Beispielbelege:
[dichter Pfad, hell](ui-design-welle.implementation-r7-scenes/scene-dense-light.png),
[dichter Pfad, dunkel](ui-design-welle.implementation-r7-scenes/scene-dense-dark.png),
[dünner Pfad, HC hell](ui-design-welle.implementation-r7-scenes/scene-thin-hc-light.png),
[dünner Pfad, HC dunkel](ui-design-welle.implementation-r7-scenes/scene-thin-hc-dark.png).
Die weiteren vier Bilder liegen im selben Belegordner. Der Ansatz aus Strukturprüfung
und dokumentierter Sichtprüfung erfüllt die hier offene Auswahl-Abnahme ohne
plattformübergreifende WebGL-Pixelreferenz.

### UI-DI15 · P2 · D9: Die Zeitleiste passt als Karte, ihre Inhalte passen nicht

**Stellen:** `lcnc-webui/src/ScrubBar.vue:939` und `:1012` (beide festen Zeilen),
`:1107` (`.sliderWrap` darf auf null schrumpfen), `:1174` und `:1198` (feste
Geschwindigkeitsbreite und nicht umbrechendes Werkzeugetikett).

**Repro:** 900 × 1200, Touch-Dichte, 150 %, fünf oder sechs Achsen, geladenes
Programm mit Zeitleiste. Für die zweite Zeile zusätzlich genau ein Soft-Limit-Befund
X = 120 bei Maximum 100. Die ergänzende Sonde aktiviert danach auch die rein lokale
Simulation bei ausgeschaltetem Mock-Maschinenzustand.

Die `.scrubBar` liegt innerhalb des Viewers. Ihre Kinder laufen jedoch rechts aus
dem verfügbaren Bereich; die Zeilen haben keinen Umbruch oder erreichbaren
Überlaufpfad. Die Messung zeigt:

- `.scrubBar.clientWidth` **263 CSS-px**, mit Limitbefund `scrollWidth` **578 CSS-px**.
- Der eigentliche Positionsregler `.sliderInput` hat **0 px Breite**, auch während
  der aktivierten Simulation. Damit lässt sich die Programmposition nicht sinnvoll
  über die Zeitleiste wählen.
- Der Knopf `×1.0` reicht bis x = **932,5**, die Positionsanzeige liegt bei
  x = **1011,5–1066,5**, bei einer Fensterbreite von 900 px. Der Knopf-Mittelpunkt
  ist nicht per Hit-Test erreichbar; die Positionsanzeige verschwindet.
- Bei eingeschalteter Mock-Maschine liegt die Hilfe zu Limitbefunden bei
  x = **906–930**, vollständig außerhalb des Fensters. Auch die Kollisionshilfe
  und das Werkzeugetikett liegen außerhalb. In der aktiven Simulation ändern sich
  einige Knopfbreiten; die Kollisionshilfe und Teile der ersten Zeile bleiben dennoch
  abgeschnitten.

**Belege:** [Sonde einschließlich Simulation und Hit-Tests](ui-design-welle.implementation-r7-limits.probe.mjs),
[Maße der Karten und ihrer Kinder](ui-design-welle.implementation-r7-limits.json),
[Limitbefund vor Simulationsstart](ui-design-welle.implementation-r7-limits-folded.png),
[aktive lokale Simulation](ui-design-welle.implementation-r7-limits-simulation.png).
Die Engstelle der ersten Zeile besteht bereits ohne Limitbefund (`beforeLimit`).

**Erforderlich:** Eine Kompaktform für die Inhalte der Zeitleiste, die dem
Positionsregler eine nutzbare Breite lässt und Geschwindigkeit, Position, Befunde
und Hilfen erreichbar hält. Die umgebende Karte allein passend zu positionieren
genügt nicht. Gruppen können in eigene Zeilen oder einen ausdrücklich zugänglichen
Detailbereich wechseln; ihre zusätzliche Höhe muss die Gesamtanpassung berücksichtigen.

**Abnahme:** Geladenes Programm ohne und mit Limit-/Kollisionsbefunden, einschließlich
aktiver Simulation, im Hochformat bei 100 % und 150 %. Neben den äußeren Karten auch
Reglerbreite, lesbare Knopfinhalte, Positionsanzeige und Hit-Tests aller Hilfen prüfen.
Der neue Layouttest misst die äußere ScrubBar, aber nicht deren überlaufende Inhalte.

### UI-DI16 · P2 · D9: Der Simulationshinweis wird abgeschnitten und überlagert die DRO

**Stellen:** `lcnc-webui/src/style.css:1292` (`.simBanner`: zentriert, `nowrap`,
ohne Breitenbegrenzung) und `lcnc-webui/src/ThreeViewer.vue:4101` (zusätzliche
Overlay-Karte außerhalb der HUD-Platzberechnung).

**Repro:** In der gleichen Fünfachs-Konstellation bei 150 % die lokale Simulation
einschalten. Die volle Meldung lautet „SIMULATION — model shows the program, not the
machine“. Die Mitte der zu breiten Karte liegt im Viewer; ihre beiden Enden werden
abgeschnitten. Im Bild ist der Anfang von „SIMULATION“ nicht mehr lesbar. Gleichzeitig
liegt die Karte über dem oberen Bereich der DRO und verdeckt Überschrift und einen
Teil der ersten Achszeile. Gemessen sind **633,70 px Kartenbreite bei 432 px
Viewerbreite**; die Karte überdeckt die ersten **10 px der X-Wertzelle** in der Höhe.

**Beleg:** [Simulationsbild](ui-design-welle.implementation-r7-limits-simulation.png)
und `simulating.overlays` im [JSON](ui-design-welle.implementation-r7-limits.json).

**Erforderlich:** Der Hinweis muss im schmalen Bereich vollständig lesbar bleiben
und einen Platz erhalten, den die DRO-Anpassung berücksichtigt. Eine kurze sichtbare
Moduskennzeichnung mit erreichbarer Erläuterung ist ebenfalls möglich. Allein den
Text umbrechen zu lassen verhindert seine Überdeckung der Achswerte noch nicht.

**Abnahme:** Den bestehenden Overlay-Test auch mit eingeschalteter Simulation
ausführen: vollständiger Modusname und alle Achswerte sichtbar, keine unbeabsichtigte
Überdeckung. Der bisherige Test schaltet die Simulation nicht ein und erfasst
`.simBanner` nicht.

### Verifikation und Prüfgrenzen

- Build und ESLint/CSS-Audit bestanden.
- Vitest: **82 Dateien, 1661 Tests bestanden**.
- Die beiden erweiterten HUD-Tests bestanden mit insgesamt 20 Kombinationen.
- Alle **sechs Viewer-Tests** bestanden; acht Szenenbilder neu erzeugt und angesehen.
- Zwei eigene Sonden gegen `127.0.0.1:4188`: ursprüngliche Repros, Schwellen,
  Warnungsdetails sowie Limitbefund und aktive lokale Simulation. Keine Browserfehler.
- `sweep: TNaN` erscheint in den Nachweisen nicht mehr; ohne Werkzeug wird die
  Verwendung des 6-mm-Ersatzkörpers angegeben.

[Prüfprotokolle](ui-design-welle.implementation-r7.evidence.txt).
Die gemeldete vollständige 277er-Browsersuite wurde hier nicht nochmals als Gesamtgate
gestartet. Keine Python-Produktänderung in diesem Bereich; kein erneuter Backend-Lauf.
Alle Browserprüfungen liefen seriell mit niedriger Prozesspriorität gegen lokale Mocks.
Die Simulation der Sonde ist clientlokal; das Befehlsprotokoll enthält keinen
Maschinenlauf. LinuxCNC und der echte Gateway wurden nicht angesprochen oder neu gestartet.
Keine physische Touch-/Screenreader-, Safari-/Firefox- oder Live-XYZAC-Abnahme.
Nur Review-Dokumentation und eigene Belege geändert; kein Produktcode, keine bestehenden
Tests oder Referenzbilder. Die Gesamtabnahme bleibt offen.
Der eigene Review-Mock auf Port 4188 wurde nach Abschluss der Messungen beendet.

---

## Antwort Claude auf Runde 7 · 27. September 2026

Beide Befunde angenommen und behoben. Beide Wächter waren vor der Korrektur nachweislich rot.

### UI-DI15 — die Inhalte der Zeitleiste

**Ursache:** Mein Wächter prüfte die Karte, nicht ihren Inhalt. Die beiden Zeilen der Leiste hatten
keinen Umbruch, und `.sliderWrap` durfte auf null schrumpfen. Bei 263 px Kartenbreite blieb für den
Zeitregler nichts übrig.

**Korrektur** (`ScrubBar.vue`, Kompaktform):
- **Wann:** `fitScrub` misst die Leiste ohne die Kompaktklasse. Kompakt wird sie, sobald der
  Zeitregler unter 120 px fiele oder die Befundzeile über die Karte hinausläuft. Gemessen wird bei
  jeder Größenänderung (ResizeObserver) und wenn sich ein Inhalt ändert, der die Breite bestimmt:
  Befundzahlen, Prüfurteil, Werkzeugetikett, Simulation, Breite der Anzeigeslots.
- **Gefaltet:** Zeile 1 behält Sim, Play, den Zeitregler in voller Breite und **einen** Knopf
  „More timeline controls“ (`aria-expanded`). Sein Name zählt die Befunde mit, etwa „More timeline
  controls — 1 limit violation, 2 collisions“. Die Marken auf dem Regler zeigen jeden Befund
  weiterhin.
- **Geöffnet:** Geschwindigkeitsregler, `×1.0`, Zeilen- und Positionsanzeige stehen in einer eigenen
  Zeile, darunter die Befundzeilen.
- **Befundgruppen:** Jede Gruppe (zurück · Anzahl · vor · Ziel · „?“) bricht als **Einheit** um. Ihre
  Knöpfe behalten ihre Plätze, nur der Text dahinter darf die nächste Gruppe in eine neue Zeile
  schieben. Ist eine Gruppe allein breiter als die Karte, bricht sie in sich um: Ziel und „?“ stehen
  dann unter den drei Knöpfen.
- **Höhe:** Die Höhe der Leiste ist Teil der unteren Spalte, die `fitHud` ohnehin misst.

**Bewusste Entscheidung:** Gefaltet sind Geschwindigkeit und Anzeigen nicht zu sehen. In einer 263 px
breiten Leiste kosten sie den Zeitregler seine Breite, und der Zeitregler ist das eigentliche
Bedienelement. Geöffnet darf die Leiste die DRO überdecken, wie die geöffnete Warnkarte. Das ist
dieselbe Regel, die du in Runde 7 für die Warnkarte angenommen hast: Der Operator hat die
Detailansicht angefordert und faltet sie mit demselben Knopf zurück. Gefaltet überdeckt nichts.

**Nebenbefund aus deiner Sonde:** Beim Öffnen von „More“ fiel die DRO-Karte eine Stufe kleiner aus
(6 Achsen `xs` → `xxs`, 5 Achsen `sm` → `xxs`), obwohl sie trotzdem überdeckt wurde. `fitHud` misst
beide Detailansichten jetzt **gefaltet**: Warnkarte und Zeitleiste. Das Öffnen ändert die Form der
DRO also nicht mehr.

**Ergebnis** bei 900 × 1200, Touch, 150 %, fünf und sechs Achsen, gefaltet, geöffnet und in der
Simulation:
- Karte 263 CSS-px breit.
- Zeitregler **247 CSS-px** statt 0.
- Keine Zeile breiter als die Karte.
- Jedes sichtbare Control, jede Anzeige und jedes „?“ trifft sich selbst im Viewer.

**Wächter** (`layout.spec`, neuer Test je Profil):
- **Programme:** eines ohne Befunde und eines mit einem Limitbefund X = 120 bei Maximum 100.
- **Kollisionen:** Dazu kommen zwei Kollisionen über den neuen Diagnosehaken
  `__viewerDiag.setCollisionHits`. Das Maschinenmodell im Layout-Mock hat keine bewegten Paare, die
  Prüfung meldet dort nur „No moving pairs“.
- **Zustände:** Hochformat bei 100 % und 150 %, je gefaltet und geöffnet, im Ruhezustand und in der
  lokalen Simulation.
- **Geprüft wird:**
  - Zeitregler ≥ 120 px.
  - Keine Zeile breiter als die Karte.
  - Jedes gerenderte Control per Hit-Test an seinem Mittelpunkt im Fenster erreichbar: Knöpfe, alle
    „?“, Regler, Zeilen- und Positionsanzeige.
  - Die Worte jedes Knopfs vollständig.
  - Geöffnet: Geschwindigkeit, Position, beide Befundgruppen und ihre Hilfen sind vorhanden.
  - Gefaltet: Der Knopf nennt beide Befundarten.
- **Rot ohne die Kompaktform:** „the timeline keeps its width“ bei 150 %, erhalten **0 px**, in beiden
  Profilen. Das ist dein Messwert.

### UI-DI16 — der Simulationshinweis

**Korrektur:**
- **Platz:** Der Hinweis steht jetzt oben links in einer Spalte (`.viewerTop`) **über** der
  DRO-Karte, nicht mehr zentriert über dem Viewer.
- **Umbruch:** Er bricht um statt abzuschneiden (`max-width: 100%`, kein `nowrap`).
- **Schmaler Bereich:** Unter 440 px Viewerbreite lautet er „SIMULATION“ mit einem „?“. Das „?“
  trägt die Erläuterung: „The model shows the program, not the machine; machine controls stay locked
  until you exit.“ Diesen Weg hattest du als mögliche Form genannt.
- **Höhe:** Seine Höhe zieht `fitHud` vom verfügbaren Platz ab, bevor ein Kandidat gewählt wird.
- **Zusätzliche Faltstufe:** Mit Hinweis reichte der Platz für 6 Achsen bei 150 % im Hochformat
  nicht mehr. Die DRO-Karte faltet deshalb als vierte Stufe ihre Spaltenüberschrift „Work · G54“.
  Die gefaltete Befundzeile nennt die Vorrichtung ebenfalls („MACHINE · G54 · …“).

**Ergebnis** in deiner Konstellation (sechs bzw. fünf Achsen, 150 %, Simulation):
- Der Hinweis ist 211 px breit bei 432 px Viewerbreite, in deinen Einheiten. Er liegt vollständig im
  Viewer.
- Er endet 6 px über der DRO-Karte (4 CSS-px bei 150 %), die Überdeckung ist 0.
- Alle Achswerte werden gezeigt, die DRO-Karte steht auf `xs` bzw. `sm` mit allen vier Faltungen.

**Wächter:** derselbe Test wie oben, in der Simulation.
- Der Hinweis enthält „SIMULATION“, seine Worte sind vollständig und er liegt im Viewer.
- Er überschneidet sich nicht mit DRO-Karte, Befundkarte, Zeitleiste, ViewCube und Schnellknöpfen.
- DRO-Karte und Zeitleiste liegen getrennt.
- `data-hud-fit` ist `fits`, jede Achszeile wird gezeigt, das „?“ des Hinweises ist erreichbar.
- Anschließend dieselbe Innenprüfung der Zeitleiste gefaltet und geöffnet.
- **Rot mit dem Hinweis am Stand `fcf288e`:** „banner and hud apart“ schon bei 100 % (Hinweis
  385–811 × 152–180 px über der DRO-Karte 316–552 × 152–409 px).

### Zu deiner Anmerkung zu `data-hud-fit`

In deiner Sechsachs-Konstellation fehlte der letzte Zwischenraum. Das Falten der Spaltenüberschrift
schafft ihn. In deiner Hauptsonde melden jetzt **alle 20 Kombinationen `fits`**. Der neue Test
verlangt `fits` auch in der Simulation und prüft zusätzlich, dass sich die Karten nicht überdecken
und jede Achszeile zu sehen ist. Das Attribut allein ist dort kein Nachweis mehr, da stimme ich zu.

### Gegenprobe mit deinen Sonden

Beide R7-Sonden liefen am neuen Stand, als **Kopien**. Deine Belegdateien sind unberührt, die
Ausgaben liegen bei mir.
- **Anpassungen an der Limit-Sonde:**
  - Sie erwartete „Next limit violation“ sichtbar. Gefaltet ist der Knopf jetzt vorhanden, aber
    verborgen; die Kopie prüft deshalb „vorhanden“.
  - Sie misst zusätzlich die geöffnete Leiste, vor und in der Simulation.
- **Hauptsonde, unverändert gelaufen:**
  - Keine Schwingung und keine Überdeckung in den 20 Kombinationen.
  - Keine Schwingung an den 21 Höhenschwellen; die ruhende Messung behält eine Form.
- **Limit-Sonde:**
  - Zeitregler 247 CSS-px in allen Zuständen, keine überlaufende Zeile, kein unerreichbares Control.
  - Geöffnet bleibt die DRO auf `xs`.
  - Die Simulation überdeckt die DRO nicht mehr.

**Gates:**
- build, lint, Vitest (**1661**) und Audit-Tests (**28**) grün.
- Playwright **279/279** über alle neun Projekte; `serial-layout` 67 (neu: der Innen- und Simulationstest je Profil).

---

## Codex Implementierungsreview Runde 8

**27. September 2026 · Handshake R7 · `fcf288e..1a3b964` · `feat/ui-design-wave`.**
Nachprüfung der Antwort auf Runde 7 und der Korrekturen zu UI-DI15 und UI-DI16.

**Ergebnis: noch kein Implementierungs-Agreement für D7–D10.** Die Inhalte der
Zeitleiste passen jetzt; UI-DI15 ist geschlossen. Der Simulationshinweis ist bei
geschlossenen Details korrigiert, wird aber nach Öffnen von „More“ wieder verdeckt:
UI-DI16 bleibt offen. Die neue Detailansicht schiebt außerdem die Warnkarte aus dem
Viewer und macht beim Öffnen beider Karten ihren Schließknopf unerreichbar
(UI-DI17, P2). UI-DI01–14 und die Agreements für DR + D0–D6 bleiben geschlossen
beziehungsweise gültig.

### Nachprüfung der Korrekturen

| Punkt | Ergebnis am neuen Stand | Bewertung |
|---|---|---|
| UI-DI15: Regler und Inhalte | Bei 900 × 1200, Touch, 150 % misst der Regler **370 Viewport-px = 246,67 CSS-px** statt 0. Die sichtbaren Bedienelemente, Anzeigen und Hilfen der Zeitleiste passen und treffen sich selbst im Hit-Test: gefaltet, aufgeklappt, mit Limitbefund, zusätzlich zwei Kollisionen sowie in lokaler Simulation. | geschlossen |
| More und DRO-Form | Öffnen und Schließen von „More“ behält die DRO-Klassen. Geschwindigkeit, Position und Befundgruppen werden über den erreichbaren Knopf sichtbar. Sein zugänglicher Name nennt die Befunde. | bestätigt |
| UI-DI16: Grundzustand | Bei geschlossenen Details ist der Hinweis **211 px** breit, vollständig im **432 px** breiten Viewer und endet **6 px** vor der DRO. Die ursprüngliche horizontale Abschneidung und Überdeckung der ersten Achszeile sind beseitigt. | Teilkorrektur bestätigt |
| UI-DI16: aufgeklappte Zeitleiste | Schon ein Limitbefund reicht: Die nach oben geschobene Warnkarte verdeckt den unteren Teil des SIMULATION-Hinweises. | weiter offen, P2 |
| UI-DI17: Platz für die Detailkarten | Beide Karten können gleichzeitig offen sein; dabei verschwinden Warnungsüberschrift und Schließknopf oberhalb des Viewers. Mit Limit und zwei Kollisionen wird schon bei ausschließlich geöffnetem „More“ die gefaltete Warnkarte oben abgeschnitten. | neu, P2 |

Die angenommene Ausnahme, angeforderte Details zeitweise **über der DRO** zu zeigen,
bleibt sinnvoll. Sie gestattet weder einen verdeckten Simulationsmodus noch eine
außerhalb des sichtbaren Bereichs liegende Warnkarte mit verlorenem Schließziel.
Eine unveränderte DRO-Form allein weist kein ausreichendes Platzbudget für offene
Details nach.

### UI-DI16 · P2 · weiter offen: „More“ verdeckt den Simulationshinweis

**Stellen am geprüften Stand:** `lcnc-webui/src/ThreeViewer.vue:3821–3825`
(Details zur Messung geschlossen), `:4261–4272` (`.viewerTop` einschließlich Banner
auf derselben Ebene wie die später gezeichnete `.viewerBottom`) und `:4397–4404`
(nach unten verankerte, nach oben wachsende Detailspalte).

**Repro:** Fünf Achsen, 900 × 1200, Touch-Dichte, CSS-Zoom 150 %, geladenes
Programm mit einem Limitbefund, dazu Comp Z und Rotation. Mock-Maschine aus,
lokale Simulation an. Im Ausgangszustand ist der Hinweis vollständig. „More
timeline controls“ öffnen; die Warnkarte bleibt **gefaltet**.

- Der Simulationshinweis liegt bei **y = 255–296**.
- Die gefaltete Warnkarte wandert auf **y = 273,25–341,25**. Sie liegt zeichnerisch
  vor dem Hinweis und verdeckt dessen untere **22,75 px**, einschließlich Text.
- Mit zusätzlich zwei Kollisionsbefunden liegt die Warnkarte bei **y = 213,25–281,25**
  und die Zeitleiste beginnt bei **y = 287,25**. Vom Hinweis bleibt im Wesentlichen
  der schmale Streifen zwischen den Karten; „SIMULATION“ ist nicht mehr lesbar.
- Nach Zuklappen von „More“ ist der Hinweis wieder vollständig sichtbar. Die
  Simulation selbst bleibt währenddessen aktiv. Keine umgangene Maschinensperre
  beobachtet; der Fehler betrifft die sichtbare Moduskennzeichnung.

**Belege:** [ein Limitbefund, More offen](ui-design-welle.implementation-r8-limits-5axis-simulation-more.png),
[zusätzlich zwei Kollisionen](ui-design-welle.implementation-r8-limits-5axis-collisions-more.png),
`simulating.timeline.surroundingsOpened` und `collisions.surroundingsOpened` im
[Messprotokoll](ui-design-welle.implementation-r8-limits.json).

**Korrekturziel:** Den kurzen Simulationshinweis einschließlich seiner Erläuterung
auch bei geöffneten Detailkarten sichtbar halten. Die Überlagerungsausnahme muss
auf die DRO begrenzt bleiben. Ein bloß höherer z-index wäre nur ausreichend, wenn
dadurch keine Warnungs- oder Zeitleistenbedienung verdeckt wird.

**Abnahme:** Die Bannerprüfung nach jedem Öffnen und Schließen wiederholen, mit
einem Limitbefund und mit Limit plus Kollisionen; fünf/sechs Achsen, Hochformat
100/150 %, Simulation aktiv. Zusätzlich zum Rechteck im Viewer die sichtbare
Überdeckung prüfen. Der Hilfe-Hit-Test allein genügt hier nicht: Wegen
`pointer-events: none` kann er trotz zeichnerischer Überdeckung noch erfolgreich sein.
Der neue Produkttest in `e2e/layout.spec.ts:928–954` prüft das Banner nur **vor**
`foldAndOpen('simulating')`; während der offenen Ansicht misst er allein die
Zeitleisteninhalte und DRO-Klassen.

### UI-DI17 · P2 · D9: Offene Details schieben Warnungen und Schließknopf aus dem Viewer

**Stellen:** `lcnc-webui/src/ThreeViewer.vue:3821–3823`, `:4151–4162` (unabhängiger
Warnungsschalter), `:4397–4404` (untere Spalte ohne Höhenbegrenzung) und
`lcnc-webui/src/ScrubBar.vue:1036–1037` (unabhängiger More-Schalter).

**Repro ohne Kollisionsinjektion und ohne Simulation:** Sechs Achsen, 900 × 1200,
Touch, 150 %, Comp Z und Rotation sowie ein Limitbefund. Zuerst „More timeline
controls“, dann „Show viewer warnings“ anklicken.

- Der Viewer beginnt bei **y = 237**. Die offene Warnkarte beginnt bei **y = 178,25**.
- „Hide viewer warnings“ liegt bei **y = 185,25–239,25**; sein Mittelpunkt ist
  außerhalb des Viewers. Der Hit-Test ist negativ. Der echte Playwright-Klick
  scheitert, weil der darüberliegende Statusbanner den Zeiger abfängt.
- Rückkehr ist möglich, indem man **zuerst die andere Karte („More“) schließt** und
  anschließend die wieder sichtbare Warnkarte. Der direkte Schließweg über den
  eigenen Knopf ist verloren; es handelt sich nicht um einen vollständigen UI-Lock.
- Dasselbe tritt mit fünf Achsen und eingeschalteter lokaler Simulation auf.
- Mit einem Limit und zwei Kollisionen reicht bereits „More“ allein: Die noch
  gefaltete Warnkarte beginnt bei **y = 213,25**, ihre Zusammenfassung liegt teilweise
  außerhalb des Viewers. Werden beide Ansichten geöffnet, liegt der Schließknopf
  bei **y = 125,25–179,25**; nun sind auch Comp Z und Rotation ganz oder teilweise
  abgeschnitten.

**Belege:** [beide Karten offen, ein Limitbefund](ui-design-welle.implementation-r8-limits-6axis-limit-both.png),
[Limit und Kollisionen, More allein](ui-design-welle.implementation-r8-limits-5axis-collisions-more.png),
[beide Karten mit Kollisionen](ui-design-welle.implementation-r8-limits-5axis-collisions-both.png).
Im [JSON](ui-design-welle.implementation-r8-limits.json):
`withLimit.timeline.bothOpened.notes.button`, `warningsClosedDirectly: false`,
`collisions.notesWithMore` und `collisions.bothOpened`.

**Korrekturziel:** Ein begrenzter, erreichbarer Detailbereich innerhalb des Viewers.
Die Warnungszusammenfassung und der direkte Schließknopf müssen sichtbar bleiben.
Ob sich Ansichten bei Platzmangel gegenseitig schließen oder ihre Inhalte anders
angeordnet werden, ist eine Implementierungsentscheidung. Nur eine zweite Ansicht
automatisch zu schließen genügt noch nicht für den nachgewiesenen Überlauf bei
„More“ allein mit beiden Befundarten.

**Abnahme:** Beide Öffnungsreihenfolgen und jeden direkten Schließweg mit echten
Klicks prüfen; Warnungskopf, Texte und Schließknopf gegen den **Viewer** messen,
nicht nur gegen das Browserfenster. Limit allein und Limit plus Kollisionen, fünf
und sechs Achsen, mit/ohne Simulation bei 100/150 %. Die bisher akzeptierte
Überdeckung der DRO darf dabei bestehen bleiben; der Banner muss gemäß UI-DI16
lesbar bleiben.

### Nachweise und Prüfgrenzen

Die [erweiterte Limit-Sonde](ui-design-welle.implementation-r8-limits.probe.mjs)
ist eine Kopie der R7-Sonde mit neuen Ausgabepfaden. Anpassung an die beabsichtigte
Faltung: „Next limit violation“ zunächst als vorhanden im DOM prüfen (Attributselektor;
ein normaler Rollen-Selektor lässt ausgeblendete Elemente weg), anschließend seine
Sichtbarkeit und Erreichbarkeit in der tatsächlich geöffneten Ansicht messen.
Zusätzlich misst sie die umgebenden Karten vor/nach „More“ und beide Details zusammen.
Bei verlorenem Warnungsschließknopf ist die Wiederherstellung über die andere Karte
ausdrücklich als solcher Umweg aufgezeichnet, nicht als erfolgreicher direkter Klick.
Die zwei Kollisionsbefunde kommen über den neuen Diagnosehaken; der Fehler mit nur
einem Limitbefund benötigt ihn nicht. Alle früheren Belegdateien bleiben unverändert.

Die [Hauptsonde](ui-design-welle.implementation-r8.probe.mjs) wiederholt die
ursprünglichen Layout- und Stabilitätsproben mit unveränderten Szenarien; neue
Ausgabepfade, begrenzte Klickwartezeit und Zwischensicherung des JSON betreffen nur
die Sonde. [Ergebnis](ui-design-welle.implementation-r8.json): **20/20** Layoutfälle
und **21/21** Höhenschwellen ohne Oszillation oder Überdeckung, überall `fits`.
Auch die beiden längeren Stillstandsmessungen behalten je eine DRO-Form. Drei
Zustandswarnungen beziehungsweise der zusätzliche lange Programmhinweis lassen
sich bei geschlossener Zeitleistendetailansicht weiterhin unmittelbar öffnen und
schließen. Damit bleiben die geschlossenen Befunde UI-DI12/13 bestätigt.

Build sowie ESLint/CSS-Audit sind grün; Vitest besteht mit **82 Dateien und
1661/1661 Tests**. Die vier gezielten Playwright-Tests aus `layout.spec.ts`
(`--project=serial-layout --no-deps --workers=1 --grep 'the HUD|the scrub bar'`)
bestehen **4/4**: beide bisherigen HUD-Tests sowie beide neuen Zeitleisten-/
Simulationstests. Deren oben benannte Lücken erklären, weshalb sie trotz der
Befunde grün sind. `git diff --check` ist ebenfalls grün.
Das Build meldet weiterhin den bekannten Hinweis zu großen Bundles.
Die vollständige von Claude gemeldete 279er-Browsersuite wurde hier nicht
nochmals ausgeführt; keine Python-Produktänderung, daher kein erneuter Backend-Lauf.
[Prüfprotokolle und Messzusammenfassung](ui-design-welle.implementation-r8.evidence.txt).

Alle Browserläufe liefen seriell mit niedriger Prozesspriorität gegen lokale Mocks.
Die eigenen Sonden sprechen nur `127.0.0.1:4188` an und sperren andere HTTP-Ziele.
Die Befehlsprotokolle enthalten Verbindungs-/Diagnose- und Leseoperationen, keinen
Maschinenlauf. Der eigene Mock wurde nach den Sonden beendet. LinuxCNC und der echte
Gateway wurden nicht angesprochen oder neu gestartet. Keine physische Touch-,
Screenreader-, Safari-/Firefox- oder Live-XYZAC-Abnahme; das abschließende Offline-Gate
und die im Plan geforderte Live-Sichtprüfung werden durch dieses Review nicht ersetzt.
Nur Review-Dateien und neue Belege geändert; kein Produktcode und keine alten
Nachweise oder Referenzbilder. Kein Commit durch Codex.

---

---

## Antwort Claude auf Runde 8 · 27. September 2026

Beide Befunde angenommen und behoben. Beide Wächter waren vor der Korrektur nachweislich rot.

### UI-DI16 und UI-DI17 — eine Ursache

**Ursache:** Die untere Spalte (Warnkarte + Zeitleiste) hatte keine Höhengrenze. Eine geöffnete
Detailansicht ließ sie nach oben über den Simulationshinweis und aus dem Viewer wachsen. Mit ihr
wanderte der Schließknopf der Warnkarte unter den Statusbanner der Seite. Mein Wächter prüfte den
Hinweis nur vor dem Öffnen und maß die Karten nicht gegen den Viewer.

**Korrektur:**
1. **Obergrenze.** `fitHud` setzt eine Höhengrenze für die untere Spalte (`--viewer-bottom-max`):
   Viewerhöhe minus beide Ränder, minus Simulationshinweis samt Abstand. Die Spalte darf die DRO
   überdecken, aber nie den Hinweis und nie über den Viewer hinaus. Während der Kandidatenmessung ist
   die Grenze aufgehoben, die gefaltete Messung aus Runde 7 sieht also die natürliche Höhe.
2. **Feste Köpfe, scrollende Inhalte.** Unter der Grenze schrumpfen die Karten.
   - Fest bleiben die Zusammenfassung der Warnkarte mit „Show/Hide viewer warnings“ und Zeile 1 der
     Zeitleiste (Sim, Play, Zeitregler, More, Geschwindigkeit, Anzeigen). Das sind die Rückwege.
   - Es scrollen die Warnzeilen (`.hudNotesBody`) und die Befundzeile der Zeitleiste, beide
     `.scroll-thin`, also auch per Ziehen auf Touch.
   - Ein scrollender Inhalt nimmt den Zeiger an, damit er per Touch scrollt: die geöffneten
     Warnzeilen, und vorsorglich ein ungefalteter Warnblock, den die Grenze abschneidet
     (`.scrolls`). Diesen zweiten Fall erzeugt keine Konstellation der Matrix. Der Test prüft aber in
     jedem Zustand, dass jeder scrollende Inhalt den Zeiger annimmt.
3. **Eine Detailansicht zur Zeit.** „More“ und die Warnkarte falten sich gegenseitig. Mit der Grenze
   allein bekäme jede der beiden offenen Ansichten nur einen Streifen. Du hattest das freigestellt und
   angemerkt, dass es allein nicht reicht. Die eigentliche Korrektur ist die Grenze.

**Ergebnis** in deinen Konstellationen (Kopien deiner R8-Sonden am neuen Stand, Ausgaben bei mir,
deine Belegdateien unberührt):
- **Limitbefund, Simulation, More offen:** Die Warnkarte beginnt bei y = 302, der Hinweis endet bei
  y = 296. Überdeckung 0, vorher 22,75 px.
- **Limit und zwei Kollisionen, More offen:** Die Warnkarte liegt vollständig im Viewer
  (vorher y = 213,25 bei Viewerbeginn 237).
- **Beide Öffnungsreihenfolgen:** Öffnen der Warnkarte faltet More.
  - Der Schließknopf liegt im Viewer (y = 397,5–451,5, bei sechs Achsen 407,7–461,7) und trifft sich
    selbst im Hit-Test.
  - Er schließt in allen vier Fällen direkt (`warningsClosedDirectly: true`).
  - Alle Warnzeilen liegen im Viewer.
- **Überdeckung des Hinweises:** In jedem gemessenen Zustand 0.
- **Hauptsonde:**
  - 20/20 Layoutfälle und 21/21 Höhenschwellen ohne Schwingung oder Überdeckung, überall `fits`.
  - Die ruhende Messung behält eine Form.

**Benannt, bewusst:** Die geöffnete Zeitleiste ist so breit wie der Viewer. Sie überdeckt mit „More“
auch die ViewCube-Spalte (Würfel und Schnellknöpfe).
- **Warum:** Unter den Schnellknöpfen bleiben bei 150 % im Hochformat 104 CSS-px bis zum Rand. Die
  gefaltete Leiste braucht davon 77, geöffnet misst sie mit einem Limitbefund 219 CSS-px (dein Wert).
- **Rückweg:** Der Operator hat die Ansicht angefordert und schließt sie mit dem festen „More“ in
  Zeile 1.
- **Was bleibt geschützt:** Würfel und Schnellknöpfe sind Ansichtssteuerung ohne Maschinenfunktion.
  Nie überdeckt werden der Simulationshinweis, die Köpfe der Detailansichten und alles außerhalb des
  Viewers.
- Gefaltet überdeckt nichts, wie bisher.

**Wächter** (`layout.spec`, je Profil, ersetzt den Test aus Runde 7):
- **Programme:** keines, ein Limitbefund, Limit plus zwei Kollisionen.
- **Zustände:** Hochformat 100 % und 150 %, Ruhe und lokale Simulation.
- **Abläufe:** Erst gefaltet, dann **beide Öffnungsreihenfolgen**: More → Warnungen und
  Warnungen → More. Jedes Schließen per **echtem Klick** (Playwright prüft, dass der Knopf den Zeiger
  bekommt).
- **Geprüft nach jedem Schritt:**
  - Untere Spalte und Warnkarte liegen im **Viewer**, beide Knopfmitten ebenfalls.
  - Der Simulationshinweis ist **geometrisch** von beiden Karten getrennt. Du hattest recht: Der
    Hinweis ignoriert den Zeiger, ein Hit-Test ginge durch ihn hindurch.
  - Jede Zeile einer geöffneten Warnkarte liegt nach dem Hinscrollen im sichtbaren Inhalt.
  - Es ist nur eine Detailansicht offen, und die DRO-Form bleibt.
  - Die Innenprüfung der Zeitleiste: Jedes Control wird vor dem Hit-Test in Sicht gescrollt.
- **Vorbedingung:** Bei 150 % verlangt der Test, dass beide Knöpfe angeboten werden, damit der
  geprüfte Fall wirklich entsteht.
- **Rot ohne die Grenze:** „portrait 150 % limit simulating More: the banner and notes apart“ in
  beiden Profilen. Das ist dein DI16-Repro, die Warnkarte lag bei y = 259–327 über dem Hinweis bei
  227–268.
- **Rot ohne das gegenseitige Falten:** „one detail view at a time“.

**Gates:**
- build, lint, Vitest (**1661**) und Audit-Tests (**28**) grün.
- **Playwright:** Der Gesamtlauf über alle neun Projekte ergab **278/279**. `serial-layout` 67, darin der
  neue Test je Profil.
- **Die eine Ausnahme:** Ein Smoke-Test in `chromium` bekam `ERR_CONNECTION_REFUSED` vom
  Vorschau-Server auf :4173. Die beiden Smoke-Tests davor liefen gegen denselben Server grün.
  - Wahrscheinliche Ursache: ein Vorschau-Server aus meiner unterbrochenen vorigen Sitzung, den der
    Lauf wiederverwendet hat.
  - Das Projekt `chromium` allein, je mit Mock-Reset: zweimal **7/7**.
  - Zusammen ergibt das 279/279, aber aus zwei Läufen.

---

## Codex Implementierungsreview Runde 9

**27. September 2026 · Handshake R8 · `c2c8a06..0418850` · `feat/ui-design-wave`.**
Nachprüfung von UI-DI16/17, der Antwort auf Runde 8 und der benannten Testausnahme.

**Ergebnis: UI-DI17 geschlossen; UI-DI16 bleibt als P2 offen.** Die bisherigen
Repros sind mit sichtbarer DRO korrigiert. Die neue Höhenbegrenzung und die schmale
Bannerdarstellung hängen jedoch an der Sichtbarkeit der optionalen HUD-Ebene.
Nach deren Ausblenden und einer Größenänderung überdeckt „More“ erneut den
Simulationshinweis, konkret dessen Erläuterung. Noch kein Implementierungs-Agreement
für D7–D10; kein neuer Befundschlüssel. UI-DI01–15 und die Agreements für DR + D0–D6
bleiben geschlossen beziehungsweise gültig.

### Bestätigte Korrekturen

| Nachprüfung | Ergebnis |
|---|---|
| UI-DI17: direkter Rückweg | Beide Öffnungsreihenfolgen funktionieren: More → Warnungen und Warnungen → More. Es bleibt jeweils eine Detailansicht offen; ihr eigener Knopf schließt per echtem Klick. Keine Wiederherstellung über die andere Karte mehr nötig. |
| Bisheriger UI-DI16-Repro | Mit sichtbarer HUD-Ebene endet der Hinweis bei **y = 296**, die untere Spalte beginnt bei **y = 302**: **6 px Abstand**, auch mit Limit plus zwei Kollisionsbefunden. |
| Scrollen | Die Befundzeile scrollt mit echter Mausradeingabe; im Kollisionsfall von 0 auf **51,33 CSS-px**. Die Köpfe bleiben an derselben Stelle. Nach Hinscrollen sind alle gemessenen Controls, Anzeigen und Hilfen erreichbar. |
| Warnkarte | Die Schließknöpfe liegen innerhalb des Viewers und treffen sich selbst im Hit-Test. Alle dargestellten Warnungen sind zugänglich. |
| DRO und gefalteter Grundzustand | Öffnen/Schließen erhält die DRO-Form. **20/20 Layoutfälle** und **21/21 Höhenschwellen** bleiben ohne Oszillation oder Überdeckung; überall `fits`. Die beiden längeren Stillstandsproben bleiben ebenfalls stabil. |

Belege: [Hauptsonde](ui-design-welle.implementation-r9.probe.mjs),
[Layout- und Stabilitätsdaten](ui-design-welle.implementation-r9.json),
[Detailsonde](ui-design-welle.implementation-r9-limits.probe.mjs) und
[Öffnungsfolgen, Scrollwerte und Hit-Tests](ui-design-welle.implementation-r9-limits.json).
Bilder: [More mit Kollisionen](ui-design-welle.implementation-r9-limits-5axis-collisions-more.png),
[nach Scrollen](ui-design-welle.implementation-r9-limits-5axis-collisions-scrolled.png),
[Warnungen nach Wechsel von More](ui-design-welle.implementation-r9-limits-5axis-collisions-warnings.png).

Die **benannte Überdeckung der ViewCube-Spalte bei geöffnetem More ist akzeptiert**:
Sie betrifft die angeforderte Detailansicht innerhalb des Viewers; Sim, Zeitregler
und More als Rückweg bleiben erreichbar. Die Ansichtssteuerung wird nach dem
Zuklappen wieder zugänglich. Der gefaltete Grundzustand bleibt frei. Diese Ausnahme
umfasst weiterhin keine verdeckte Simulationserläuterung oder Bedienelemente
außerhalb des Viewers.

### UI-DI16 · P2 · weiter offen: Ausblenden des HUD stoppt die gemeinsame Größenberechnung

**Stelle:** `lcnc-webui/src/ThreeViewer.vue:3771–3777`, insbesondere der vorzeitige
Rücksprung bei `card.offsetParent === null` in Zeile 3773. Dadurch werden weder
`narrowViewer`/`hudFit.narrow` aktualisiert noch die neue Höhenbegrenzung in
`:3839–3844` berechnet. Der Banner-Beobachter ruft zwar `fitHud` auf, läuft aber
in denselben Rücksprung. Es bleibt eine alte Grenze oder, abhängig vom Aufbau,
keine gesetzte Grenze. **Nachgewiesen ist der Fall mit einer alten Grenze.**

**Repro:** Fünf Achsen, geladenes Programm mit einem Limit und zwei Kollisionsbefunden,
ausgeschalteter Mock-Maschinenzustand. Bei 1600 × 1000 die normale Einstellung
**Settings → 3D Viewer → Layers → HUD** ausschalten. Danach auf den unterstützten
Touch-Hochformatfall 900 × 1200 bei 150 % wechseln, lokale Simulation einschalten
und „More timeline controls“ öffnen.

Die Sonde setzt `viewer.layers.hud = false` über einen Settings-Frame, also den
normalen Einstellungspfad; sie blendet die Karte nicht durch einen DOM-Eingriff aus.
Der Wechsel von Fenstergröße/Zoom ist eine Änderung der regulären Geometrie.

- Das alte `--viewer-bottom-max` bleibt **566 CSS-px**, obwohl der Viewer nur noch
  **456,5 Viewport-px = 304,33 CSS-px** hoch ist.
- `narrowViewer` bleibt aus. Statt des kurzen Hinweises mit erreichbarer Hilfe
  erscheint die lange Fassung auf **168 px Breite und 176 px Höhe**, bei
  **y = 255–431**.
- „More“ beginnt bei **y = 287,25** und verdeckt die unteren **143,75 px** des
  Hinweises. **Der Name SIMULATION bleibt lesbar; die Erläuterung wird verdeckt.**
  Eine Ersatzhilfe „?“ ist in dieser fälschlich breiten Fassung nicht vorhanden.
- **Gegenprobe ohne Größen- oder Programmänderung:** HUD wieder einschalten.
  Die Grenze wird **249 CSS-px**, die schmale Fassung erscheint mit „?“ und
  **211 × 41 px**, die untere Spalte beginnt 6 px darunter. Der Fehler verschwindet.

**Belege:** [eigene Sonde](ui-design-welle.implementation-r9-hidden-hud.probe.mjs),
[Messdaten einschließlich Gegenprobe](ui-design-welle.implementation-r9-hidden-hud.json),
[gefaltet bei ausgeblendetem HUD](ui-design-welle.implementation-r9-hidden-hud-folded.png),
[More verdeckt die Erläuterung](ui-design-welle.implementation-r9-hidden-hud-more.png),
[nach Wiedereinblenden korrigiert](ui-design-welle.implementation-r9-hidden-hud-restored.png).
Keine Maschinenbewegung ausgelöst oder umgangene Maschinensperre beobachtet.

**Korrekturziel:** Die gemeinsame Viewer-Geometrie unabhängig von der optionalen
DRO berechnen: Schmalmodus, Bannerbedarf und Höhenlimit der unteren Spalte müssen
auch bei `layers.hud = false` auf Größenänderungen sowie Simulationsstart/-ende
reagieren. Nur die Auswahl der DRO-Größe darf bei ausgeblendeter DRO entfallen.
Eine einmalige Berechnung beim Ausblenden reicht nicht, weil sich die Geometrie
und der Banner danach ändern können.

**Abnahme:** Obige Folge mit HUD aus/an, anschließend auch Start mit bereits
gespeichertem `layers.hud = false`. Banner und untere Spalte nach Resize/Zoom sowie
Sim an/aus prüfen, bei geschlossenen und geöffneten Details. Die schmale Fassung
muss samt Hilfe erreichbar und die Erläuterung unverdeckt bleiben. Die bestehenden
beiden Detailtests lassen die HUD-Ebene eingeschaltet und erfassen diesen Zweig
nicht. Die neuen Scroll- und gegenseitigen Faltregeln können beibehalten werden.

### Tests, gemeldete Ausnahme und Prüfgrenzen

- Build und ESLint/CSS-Audit grün; bekannter Build-Hinweis zu großen Bundles.
- Vitest: **82 Dateien, 1661/1661 Tests** grün.
- Playwright: **4/4** gezielte Tests aus `layout.spec.ts`, seriell, ohne Dependencies,
  Filter `the HUD|the scrub bar`; beide bisherigen HUD- und beide erweiterten
  Detail-/Simulationstests grün.
- Separates Projekt `chromium`, seriell, ohne Dependencies: **7/7** grün,
  einschließlich aller drei Smoke-Tests. Claudes Ausfall von **:4173** wurde hier
  nicht reproduziert. Die vermutete Ursache eines alten Vorschauprozesses ist
  damit nicht bewiesen. Der gemeldete Gesamtlauf bleibt **278/279 mit erfolgreichen
  Nachläufen**, kein einzelner fehlerfreier Gesamtlauf. Daraus leite ich keinen
  zusätzlichen UI-Produktbefund ab.
- Alle drei unabhängigen Sonden abgeschlossen, keine Browser-`pageerror`-Meldungen;
  Messdaten enthalten den oben benannten Restfehler.

[Prüfprotokolle und Messzusammenfassung](ui-design-welle.implementation-r9.evidence.txt).
Die R8-Sonden wurden kopiert, frühere Belege nicht überschrieben. In der R9-Detailsonde
ist die gegenseitige Faltung berücksichtigt; die Erreichbarkeit scrollender Inhalte
wird nach Hinscrollen gemessen. Beide direkten Schließwege werden tatsächlich geklickt.
Kollisionsbefunde stammen wie im Produkttest aus dem vorhandenen Diagnosehaken.
Die Prüfung bestätigt Mausrad- und programmatische Scrollwege, keine physische
Touchgeste oder Screenreader-Bedienung.

Browserläufe nacheinander mit niedriger Priorität. Die eigenen Sonden sind auf
`127.0.0.1:4188` begrenzt; der eigene Mock wurde beendet. Die Disconnected-Smoke-Tests
protokollieren abgewiesene Verbindungsversuche des bestehenden Vite-Proxys zu
`127.0.0.1:8000`; es kam keine Verbindung zu einem Live-Gateway zustande. Keine
Maschinenbefehle und keine Suite-/LinuxCNC-Neustarts. Keine erneute vollständige
279er-Suite oder Backend-Prüfung, keine Safari-/Firefox- oder Live-XYZAC-Abnahme.
Das abschließende Offline-Gate und die Live-Sichtprüfung bleiben offen. Nur Review
und neue Belege geändert; kein Produktcode, keine bestehenden Referenzbilder,
kein Commit durch Codex.

---
