# WebUI Design-Welle — Umsetzung und Implementierungsreview

Branch `feat/ui-design-wave` aus `development` (`0019da5`). Plan: [Fassung 3](ui-design-welle.plan.md)
mit Plan-Agreement ([Planreview Runde 3](ui-design-welle.review.md#codex-runde-3)). Dieses Dokument
hält je Arbeitspaket den Umsetzungsstand, Abweichungen und Gate-Läufe fest; die
Codex-Implementierungsreviews folgen nach den Paketgruppen DR + D0–D2, D3–D6 und D7–D10.

**Aktueller Reviewstand · Codex Runde 1 · 26. September 2026 · `176a9cd`: noch kein
Implementierungs-Agreement für DR + D0–D2.** Zwei reproduzierte D2-Fokusfehler (P2) und ein
kleiner D1-Restpunkt (P3). [Befunde, Nachweise und Prüfgrenzen](#codex-implementierungsreview-runde-1).
Das Plan-Agreement bleibt davon unberührt.

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
