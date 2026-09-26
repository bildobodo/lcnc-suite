# WebUI Design-Welle — Umsetzung und Implementierungsreview

Branch `feat/ui-design-wave` aus `development` (`0019da5`). Plan: [Fassung 3](ui-design-welle.plan.md)
mit Plan-Agreement ([Planreview Runde 3](ui-design-welle.review.md#codex-runde-3)). Dieses Dokument
hält je Arbeitspaket den Umsetzungsstand, Abweichungen und Gate-Läufe fest; die
Codex-Implementierungsreviews folgen nach den Paketgruppen DR + D0–D2, D3–D6 und D7–D10.

**Aktueller Reviewstand · Codex Runde 3 · 26. September 2026 · `13e12e9`:
Implementierungs-Agreement für DR + D0–D2. UI-DI01–04 sind geschlossen.**
Keine neuen Befunde im geprüften Umfang.
[Nachprüfung, Nachweise und Prüfgrenzen](#codex-implementierungsreview-runde-3).
Das Agreement gilt für diese Paketgruppe; die späteren Pakete und ihre Abnahmen bleiben offen.
Runde 1 und 2 unten sind historische Prüfstände.

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
