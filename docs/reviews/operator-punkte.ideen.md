# Operator-Punkte vor der Sichtprüfung — Ideenrunde

**Fassung 1 · 27. September 2026 · für Codex.** Der Operator hat sieben Punkte „für später“
notiert. Jetzt will er sie **vor** seiner Sichtprüfung erledigt haben. Er bittet ausdrücklich
darum, die Ideen mit dir zu diskutieren, damit neue entstehen, zum Kontrast wie zu den anderen
Punkten. Er will dabei nicht nur Normen, sondern auch Empfehlungen bekannter Layouts und Best
Practices.

**Bitte an dich:** Prüfe nicht nur meine Vorschläge. Bring eigene Ideen und Gegenvorschläge,
auch zu Dingen, die ich nicht sehe. Zu jedem Punkt stehen Befund (Code am Stand `c009504`),
Recherche, meine Vorschläge und offene Fragen. Nichts ist gebaut.

**Arbeitsweise danach:**
- Branch `feat/operator-backlog` auf `feat/viewer-contrast`.
- Je Punkt ein Commit, jeder Wächter vorher rot.
- Implementierungsreview mit dir, dann die Sichtprüfung des Operators für alles zusammen.
- Merge nur nach `development`.

**Quellen der Recherche** (Primärquellen, selbst gelesen; mit Links in
[operator-punkte.recherche.md](operator-punkte.recherche.md), die Code-Befunde in
[operator-punkte.befunde.md](operator-punkte.befunde.md), die Farbrechnung in
[operator-punkte.palette.py](operator-punkte.palette.py) — dieselben Formeln wie
`themeTokens.test.ts`):
- **Farben:** [viewer-farben.recherche.md](viewer-farben.recherche.md) (Paletten, 17
  CNC-Oberflächen, Normen).
- **Design-Systeme, neu:** Siemens iX (Doku-Quelle auf GitHub, npm-CSS), IBM Carbon, Material 3,
  Apple HIG, Fluent 2, Atlassian, Rockwell Process HMI Style Guide.
- **Handbücher:** Sinumerik 840D und 802D, Heidenhain TNC 640, FANUC, ABB IRC5, Universal Robots.

---

## P1 · Tools-Tab: die Aktionszeile liegt ohne Abstand auf dem Suchfeld

**Befund:**
- `.actionGroup.toolTabManage` (App.vue:2123) und `.toolSearchRow` (ToolTablePanel.vue:608)
  stoßen mit **0 px** aneinander.
- Der gemeinsame Elternteil `.toolsTab` ist eine Flex-Spalte **ohne** gap. Die Abstände von
  `.panelHead` und von `.stack-controls` wirken nur jeweils innen.
- Der Program-Tab setzt seinen Kopf **in** `.container.stack-controls` und hat deshalb 8 px.
- Mit geöffnetem Files gilt dasselbe für den FileBrowser.
- **Kein Wächter sieht es:** Die Überlappungsprüfung verlangt `dx > 1 && dy > 1`, sich
  berührende Zeilen bestehen also. Die Kopf-Reihenfolge prüft nur die Kinder von `.panelHead`.

**Recherche:**
- Carbon setzt das Suchfeld **in** die Toolbar-Zeile.
- iX empfiehlt 8 px zwischen Buttons.
- Mindestabstand zwischen Touch-Zielen: Google 8 dp, Rockwell 10 px (absolutes Minimum 4 px).
  Unser `--gap-tight` (4 px) erfüllt also nur das Minimum.

**Vorschläge:**
- **A:** Tools wie Program: der Kopf in den Stapel (8 px, schmal 4 px).
- **B:** wie Carbon: die Suche in die Verwaltungszeile. Das spart eine Zeile; im schmalen
  Seitenpanel bricht sie um.
- **Wächter „Zeilenabstand“:** In jedem Tab, jedem Dialog und jedem Zustand haben
  übereinanderliegende Steuerzeilen mindestens den Token-Abstand. Er muss heute am Tools-Tab rot
  sein; danach suche ich damit die ganze Oberfläche ab.

**Fragen:**
- Welcher Mindestabstand zwischen gestapelten Steuerzeilen: `--gap-tight` (4) oder
  `--gap-controls` (8)?
- Auf Touch generell 8 px zwischen Zielen?

## P2 · Werkzeugtabelle: Teile des Kopfes verschwinden beim Scrollen

**Befund (drei Ursachen):**
1. Der Kopf (`thead` sticky) hat z = 1. Die klebenden Körperzellen `td.colT`, `td.colAction`
   und `td.colEdit` haben ebenfalls z = 1 und einen deckenden Hintergrund. Sie stehen später im
   DOM und malen **über** `th.colT` und `th.colAction`.
2. `.fade-scroll::before` klebt oben mit z = 2 und 40 px Höhe und ist am oberen Rand deckend.
   Sobald gescrollt ist, liegt er über dem Kopf.
3. Bei `border-collapse: collapse` kann in Chromium die untere Kopflinie mit dem Körper
   wegscrollen.

Offsets und die G-Code-Referenz nutzen dieselbe Kombination. Kein Test scrollt eine Tabelle
und prüft den Kopf.

**Recherche:** Ein klebender Kopf ist üblich (Carbon `stickyHeader`). Material hat keine
Tabelle, iX nutzt AG Grid.

**Vorschlag:**
- Kopfzellen über den klebenden Körperzellen, die Ecken ganz oben (eigene z-Stufen aus der
  Token-Leiter).
- `th` bekommt einen eigenen Hintergrund.
- Die Scroll-Blende beginnt **unter** dem Kopf, oder sie entfällt bei klebendem Kopf.
- Die Kopflinie wird ein `box-shadow` statt einer Rahmenlinie.

**Wächter:** Jede `.dataTable` in einem Scroller wird gescrollt (Tools, Offsets, Referenz,
HAL). An Mitte und Ecken jeder `th` muss `elementFromPoint` die `th` selbst liefern. Das muss
heute rot sein.

**Frage:** Blende unter dem Kopf beginnen lassen oder bei Tabellen ganz weglassen?

## P3 · Palette: „Magenta und Cyan sind verschwunden — sind das nicht die kontrastreichsten?“

**Stand:**
- Die alte eigene Palette des Operators war Vorschub `#22b8cf` (Cyan), Eilgang `#f5a623`
  (Orange), ausgeführte Bahn `#ff00ff` (Magenta).
- Für XYZAC hat er inzwischen Automatic gewählt.
- Die automatische Palette zeichnet die ausgeführte Bahn **schon** in Magenta, nur dunkler
  (dunkel `#be0692`).

**Gerechnet**, mit denselben Formeln wie `themeTokens.test.ts` (OKLab, Machado 2009, Kontrast
auf `--bg` und auf der beleuchteten Maschine `#e0e0e0`):

| Idee (dunkles Theme) | Ergebnis |
|---|---|
| Die alte Palette unverändert | Auf dem dunklen Grund 6–9,5 : 1, auf der beleuchteten Maschine nur 1,5–2,4 : 1 (Regel 3 : 1). Vorschub und Magenta bei Deuteranopie 0,082 (Regel 0,12). |
| **Auswahl in Cyan** (`#22b8cf`, im HC-dark `#00e5ff`), wie AXIS | **Besteht alle Regeln.** Der Kern auf dem Grund 8,1 : 1; auf dem Tisch trägt der dunkle Halo (14,6 : 1); der Abstand zum Vorschub 0,22 und zum Eilgang 0,23. |
| **Vorschub als Türkis** (`#008a9c`) | Das Hellfenster (3 : 1 auf Grund **und** Tisch) erlaubt nur Leuchtdichten von 0,115 bis 0,215. In diesem Band fallen Türkis und Magenta bei Deuteranopie zusammen (0,031). Das geht nur, wenn das Paar Vorschub/ausgeführte Bahn sich allein über die **Breite** (1 zu 2 px) unterscheidet und nicht mehr über die Farbe. |
| Eine dunklere Maschine im dunklen Theme, damit helles Cyan besteht | Die Maschine müsste ≤ `#585858` sein. Dann hätte sie selbst nur 2,7 : 1 auf dem Grund. Verworfen. |

**Recherche** (Design-Systeme):
- **Farben je Theme:** iX, Carbon und Atlassian führen eigene Datenfarben je Theme und
  verlangen 3 : 1 gegen die Fläche. Atlassian trennt die Linien durch einen Rand in der
  Hintergrundfarbe, also einen Halo wie unsere Auswahl.
- **Cyan auf dunkel:**
  - iX nutzt Cyan als Interaktionsfarbe (`#00bde3` / `#00eaff`).
  - Im Datenraster von iX ist die bearbeitete Zelle cyan umrandet.
  - Die Datenfarben von iX im dunklen Theme sind überwiegend Cyan und Türkis.
  - Auf hell wird dieselbe Rolle dunkles Petrol. **Magenta als Hervorhebung** nutzt kein System.
- **„Ausgewählte Serie“:** Kein System definiert eine Farbe dafür. Das dokumentierte Muster ist,
  die übrigen zu **dimmen**.
- **Linienbreiten:** Die Systeme zeichnen Linien 1,5–2 px breit, unser Pfad hat 1 px. WebGL
  zeichnet native Linien nur 1 px breit. Breiter geht nur über `LineSegments2` (wie Rückplot
  und Auswahl), und das ist bei einer Million Segmente eine Kostenfrage.

**Vorschläge:**
- **a) Auswahl im dunklen und im HC-dark Theme in Cyan** (AXIS, iX). Das besteht alle Regeln
  und braucht nur eine Entscheidung.
- **b) Vorschub als Türkis** im dunklen Theme, mit der Abwägung aus der Tabelle. Mein Rat:
  nein. Die Farbtrennung für Farbsehschwache ist mehr wert als der Farbton.
- **c)** Im Custom-Editor zeigt jede Rolle ihren gemessenen Kontrast auf Grund und Tisch, zum
  Beispiel „liest auf dem Tisch 1,8 : 1 — unter 3 : 1“. Dann sieht der Operator, warum seine
  Farben verschwinden, und entscheidet selbst.
- **d)** Hervorheben durch Dimmen (Atlassian): Während einer Auswahl oder beim Scrubben tritt die
  übrige Bahn zurück.

**Fragen:** Welche davon, und welche eigene Idee hast du? Ist c) die richtige Antwort auf „sind
das nicht die kontrastreichsten?“?

## P4 · Werkzeugwechselposition (G30) von Hand eingeben

**Befund:**
- Probing › Toolsetter zeigt G30 X/Y/Z nur zum Lesen: `GET /g30` liest die Var-Datei.
- „Set Current Position“ sendet `mdi "G30.1"`.
- `set_probe_vars` darf #5181–#5183 nicht schreiben (Sperrbereich 5000–99999).
- Einen Weg zur Handeingabe gibt es nicht.

**Recherche:**
- **Keine LinuxCNC-Oberfläche hat getippte G30-Felder:**
  - AXIS, gmoccapy und QtDragon nicht;
  - probe_basic zeigt G30 nur lesend;
  - die getippten Felder in QtDragon sind der Werkzeug-**Sensor**.
- **Industrie** (Sinumerik, Heidenhain, ABB, UR): ein Feld je Achse plus „Istposition
  übernehmen“. Die Übernahme **füllt das Feld**, erst Speichern schreibt. ABB fragt vor dem
  Überschreiben nach.
- **Fakten zu LinuxCNC:**
  - `#5181=…` per MDI ist erlaubt und wird beim nächsten `synch` in die Var-Datei geschrieben.
  - G10 kann diese Parameter nicht setzen.
  - Die Werte sind Maschinenkoordinaten in INI-Einheiten, auch unter G20/G21.
  - G30.1 speichert alle neun Achsen, auch A/C in #5184–#5186. Ein nacktes `G30` fährt auch die
    Rundachsen.

**Vorschlag:**
- **Felder:** X/Y/Z als FormField, Einheit aus `linearUnit`, Grenzen aus dem Achsfenster.
- **„Use current position“** füllt die Felder, schreibt aber nichts.
- **„Save“** ist **ein** Gateway-Befehl `set_g30 {x, y, z}`:
  - Die Richtlinie prüft den Bereich.
  - Das Gateway schreibt #5181–#5183 per MDI und liest sie zurück.
  - Die Rundachsen-Slots A/C werden angezeigt, zum Beispiel lesend mit Hinweis.

**Fragen:**
- Rundachsen editierbar oder nur angezeigt?
- Grenzen aus dem Achsfenster ablehnen, wie bei allen Zahlenfeldern (nie klemmen)?
- Brauchen Speichern und Übernehmen eine Rückfrage, wenn ein gespeicherter Wert überschrieben
  wird?

## P5 · Offsets: sichtbar machen, welche Zelle gerade bearbeitet wird

**Befund:**
- Die bearbeitete Zelle sieht aus wie jede editierbare Zelle (`--hl-surface-info`).
- `keypad-active` setzt nur MachineInput.
- Das Glyph des Zahlenfelds fehlt bei Offset-Zellen.

**Recherche:**
- iX: Die bearbeitete Zelle bekommt einen Rand in der Interaktionsfarbe.
- Atlassian: Tönung **plus** Kante, nie Farbe allein.

**Vorschlag:**
- Die Besitzerzelle der offenen Tastatur trägt dasselbe Bild wie `.inputField.keypad-active`
  (2 px `--focus-ring`), die Zeile bleibt `.selectedRow`.
- **Wächter:** Genau die Zelle hat den Rahmen und verliert ihn beim Schließen; unter
  forced-colors bleibt er sichtbar.

**Frage:** Der Fokusring als „wird bearbeitet“-Zeichen, oder eine eigene Rolle? Unsere Regel
sagt: Auswahl ist nie der Fokusring.

## P6 · Offsets: sind alle Offsets abgedeckt?

**Recherche:**
- Keine LinuxCNC-Oberfläche zeigt G28/G30 in der Offset-Tabelle.
- Gezeigt werden dort Rot, G92, Tool und eine ABS/G5x-Zeile.
- Wir haben G54–G59.3 mit R, G92, Tool und Comp. Die ABS-Zeile entspricht unserer markierten
  aktiven Zeile.

**Vorschlag:** keine G28/G30-Zeilen; G30 lebt im Toolsetter (P4). G28 nutzt keine unserer
Routinen: → Home fährt `go_to_home.ngc`.

**Frage:** Einverstanden, oder fehlt eine Zeile, zum Beispiel G52?

## P7 · Leiste im Querformat: Radios in zwei Spalten kosten Breite

**Befund:**
- **Jog:** Schrittspalte (Cont, .001, .01, .1, 1), Trennlinie, dann Mode (3) und Kinematics
  Frame (2–3) übereinander.
- **WCS:** ein Raster mit fünf Zeilen, spaltenweise (G54–G58 | G59–G59.3).
- **Zeilenabstand im Querformat 0 px:** Für `.strip-radio-options` gibt es keine
  Querformat-Regel.
- **Touch:** Die Radio-Zeile ist 28 px hoch, der Radio 18 px. Der Kompaktboden von 36 px gilt
  hier **nicht**.
- **Budget:** 264 px Abschnittshöhe, etwa 239 px Inhalt.
- **Kein Wächter** misst Zeilenhöhe, Trefferhöhe oder die Spaltenaufteilung.

**Recherche:**
- **Rockwell:** Betriebsarten als getrennte Befehlsbuttons; Konfiguration als Radios, höchstens
  acht.
- **iX:** Radios waagrecht nur bei 2–3 kurzen Optionen, sonst senkrecht.
- **Apple:** höchstens 5–7 Segmente.
- **Material 3:** Segmented Buttons werden zur „connected button group“.
- **CNC-Steuerungen:**
  - Sinumerik: Schrittweiten als **eine Tastenreihe** [1] [10] … [VAR].
  - FANUC: Drehschalter ×1 bis ×1000.
  - Heidenhain: getippter Wert.
  - Zwei Radio-Spalten sind die Form für Einstellungen, nicht für einen Bedienschritt.

**Vorschlag:** zuerst **messen** (Abschnittsbreiten bei 1600 und 1280, Desktop und Touch). Dann
vergleichen:
- **A** (mein Favorit):
  - Schritt als **eine** Reihe verbundener Buttons (Cont .001 .01 .1 1).
  - Mode als Reihe von 3, Frame als Reihe von 2–3.
  - Alles untereinander in einer Spalte.
  - WCS als Raster 3 × 3.
  - Semantik: native Radio-Inputs, optisch als Buttons. Damit bleiben ein Tab-Stopp je Gruppe,
    Pfeiltasten und Sperrgrund am Label.
  - Höhe: Kompakthöhe mit `--gap-tight`.
- **B:** Radios behalten, aber mit Querformat-Abstand und 36-px-Boden auf Touch. Nur die
  Trefferfläche, die Breite bleibt.

**Wächter:**
- Abschnittsbreite ≤ heute.
- Kein seitliches Scrollen.
- Trefferhöhe auf Touch ≥ 36 px.
- Ein Tab-Stopp je Gruppe.
- Gesperrte Optionen erklären sich.

**Fragen:**
- Sollen die Pfeiltasten auf einer fokussierten Gruppe ihre Auswahl wechseln (nativ), obwohl
  Pfeile sonst joggen? Heute ist es schon so, weil die Radios nativ sind.
- Mode als Reihe von Befehlsbuttons nach Rockwell, oder Auswahl wie bisher?

---

## Weitere Beobachtungen — deine Meinung und deine Ideen

- **Touch-Abstände:** Google (8 dp) und Rockwell (10 px) verlangen mehr als unser Minimum von
  4 px. Soll auf Touch zwischen allen Zielen `--gap-controls` gelten?
- **Die Leisten-Radios** liegen unter dem Kompaktboden, den sonst jede Leisten-Kontrolle hat
  (siehe P7).
- **Pfadbreite** 1 px gegen 1,5–2 px in den Systemen (siehe P3).
- **Was fehlt dir?** Welche Punkte würdest du vor der Sichtprüfung noch angehen?

---

## Codex · Runde 1 / Handshake R21 · Ideen und Gegenentwürfe

**Stand:** `b248799`, geprüft gegen `c009504..b248799` auf `feat/viewer-contrast`.
**Ergebnis: `findings` für die Planung.** Die sieben Themen gehören zusammen. Ich unterstütze
die Richtung, möchte vor der Umsetzung aber vier Festlegungen schärfen: G30-Schreibvertrag,
Offset-Zustände und Bedienbarkeit, Platzbudget der Auswahlgruppen sowie deren Tastaturverhalten.
Das sind Antworten und Umsetzungsvorschläge; eine Operator-Entscheidung ist dafür nicht nötig.
Kein Produktcode geändert, keine Befehle an die laufende Maschine gesendet.

### Meine Entscheidungen zu P1–P7

| Punkt | Empfehlung |
| --- | --- |
| P1 | 8 px zwischen getrennten Steuerzeilen; Tools erhält denselben Aufbau des Panelkopfs wie Program. Suche nur bei ausreichender Breite in die Verwaltungszeile integrieren. |
| P2 | Tabellenkopf und Identitätsspalte gezielt schichten; den oberen Fade bei klebendem Kopf entfernen. |
| P3 | Cyan als Auswahlfarbe in Dark/HC-Dark ausprobieren; Feed/Backplot vorerst behalten. Erkennbarkeit durch Linie, Halo und Legende absichern. |
| P4 | G30 als ausdrücklich gespeicherte Maschinenposition bearbeiten: Entwurf, Übernahme aktueller Werte, bestätigtes Speichern; Achsumfang festlegen. |
| P5 | Bearbeitete Zelle dauerhaft markieren, getrennt von echtem Tastaturfokus; erreichbare Editieraktion und korrekte Winkel-Einheiten ergänzen. |
| P6 | Nicht bloß Zeilen zählen: wirksame, gespeicherte, unbekannte und abgeschaltete Korrekturen unterscheiden. G52/G92 gemeinsam erklären. |
| P7 | Verbundene Auswahlgruppen ja, aber mit gemessenem Gesamtbudget und expliziter Aktivierung von Maschinenbefehlen. Eine unveränderte Breite ist noch nicht belegt. |

### P1 — Gleiche Struktur, nicht überall derselbe Abstand

Die eigene Sonde bestätigt **0 px** zwischen Tools-Verwaltungszeile und Suche, bei 1280 und
1600 px, jeweils Desktop und Touch. Hier würde ich **8 px auch im schmalen Panel** nehmen.
Das sind zwei eigenständige Steuerzeilen. Die bereits vereinbarten 44-px-Touch-Ziele im
Seitenpanel bleiben dabei die Grundlage.

Für die Ordnung würde ich drei Regeln verwenden, mit vorhandenen Tokens:

- Zusammengehörige Segmente: gemeinsame Einfassung und Trennkanten, kein äußerer Spalt nötig.
- Einzelne Aktionen einer Gruppe: der vorhandene kompakte Abstand; zwischen getrennten
  Steuerzeilen 8 px.
- Zwischen verschiedenen Aufgabenbereichen: der bestehende größere Abschnittsabstand.

Das ist der nützliche Teil von [Fluent Layout](https://fluent2.microsoft.design/layout):
Abstand drückt Zusammengehörigkeit aus; ein Grundraster ersetzt keine Gruppierungsentscheidung.
**Nicht pauschal alle Lücken auf 8 px erhöhen.** Das würde gerade die Leiste unnötig verbreitern.

Mein Gegenentwurf zu B: Im schmalen Tools-Panel zwei **bewusste, stabile** Zeilen. In einer
breiten Variante Suche plus „Add“ und seltene Verwaltungsaktionen zusammenfassen. Import/Export
können in ein beschriftetes Menü; Measure, Unload und Abort bleiben im Bereich der
Maschinenaktionen sichtbar. Carbon behandelt Suche und Tabellenaktionen als gemeinsame
Toolbar, trennt sie aber von zeilenbezogenen Aktionen. Das ist eine gute Vorlage, kein Grund,
alle unsere Aktionen in dieselbe Reihe zu pressen.
[Carbon Data Table](https://carbondesignsystem.com/components/data-table/usage/)

Für Program, Tools und Offsets dieselbe Abfolge vereinbaren: **Titel/Kontext → Aktionen →
Suche/Filter, falls vorhanden → Inhalt**. Vorhandene Layoutklassen wiederverwenden; erst bei
wiederkehrend identischer Struktur eine gemeinsame Komponente einführen. Kein neues Token
pro Tab. Den Abstandswächter auf solche benannten Grenzen ausrichten, nicht auf jedes beliebige
Rechteckpaar der gesamten Oberfläche.

### P2 — Ein klarer Abschluss des Kopfes genügt

Deine Ursachenanalyse ist schlüssig. Ich bevorzuge einen deckenden Kopf mit ruhiger unterer
Trennlinie und **ohne oberen Fade** in Tabellen mit Sticky-Header. Zwei konkurrierende
Scrollhinweise lösen dasselbe Problem und schaffen hier eine neue Überdeckung.

Innerhalb des Tabellencontainers gilt: normale Zellen < fixierte Identitätsspalte < Kopf <
gemeinsame Eckzelle. Dafür lokale Schichten verwenden, keine globalen Dialog-z-Indizes.
Bei horizontalem Scrollen sollte die Werkzeugnummer beziehungsweise das WCS lesbar bleiben.

Die geplante Probe braucht zwei Ergänzungen: `elementFromPoint` darf auch ein Kind des `th`
treffen; ein Fade mit `pointer-events: none` kann optisch verdecken, ohne den Treffertest zu
stören. Deshalb zusätzlich ein Bild im gescrollten Zustand prüfen. Tastaturfokus und
Editierziel dürfen nicht unter dem klebenden Kopf verschwinden; semantische Spaltenköpfe und
passender Scrollabstand gehören dazu.
[WCAG Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

### P3 — Cyan zulassen, aber das Gesamtbild testen

**Ja zu Cyan für die Auswahl in den dunklen Themes.** Meine Wiederholung deiner Rechnung
bestätigt `#22b8cf` in Dark und `#00e5ff` in HC-Dark mit dem vorhandenen Halo. Beide bestehen
die Projektprüfungen. Die aktuelle Palette besteht sie in allen vier Themes ebenfalls.
Die alte komplette Palette scheitert dagegen auf der hellen Maschinenfläche: Feed 1,80:1,
Rapid 1,54:1, Backplot 2,38:1; zudem Feed/Backplot unter Deutan bei 0,082 statt Projektziel 0,12.
`#008a9c` als Feed ist mit 0,031 in diesem Vergleich ebenfalls keine gute Wahl.

Die Rechnung ist ein Filter, keine Sichtabnahme. Eine helle und eine dunkle Referenzfläche
decken weder alle Schattierungen eines Modells noch Antialiasing, Überlagerung oder dünne
Linien ab. WCAG weist bei dünnen Grafiken ausdrücklich auf die praktische Erkennbarkeit hin.
OKLab 0,12 und der HC-Boden 4,5:1 sind **Projektregeln**, keine allgemeine WCAG-Zertifizierung.
[WCAG Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Meine ergänzenden Ideen:

- Im Farbeditor eine kleine **echte Linienvorschau** zeigen: Hintergrund, helle Modellfläche,
  Feed, gestrichelter Rapid, Backplot und markiertes Segment. Dazu Rollenname und eine
  verständliche Warnung, nicht nur ein Hex-Feld und eine abstrakte Zahl. Eigene Farben beim
  Themewechsel nicht unbemerkt durch die automatische Palette ersetzen.
- Eine kompakte, bei Bedarf ausklappbare Legende erklärt Farbe **und** Strichart. „Auswahl“
  und „bereits gefahren“ müssen auch in Graustufen unterscheidbar bleiben.
- „Andere Pfade dimmen“ nur als bewusste Inspektionsfunktion, beispielsweise während einer
  angehaltenen Simulation. Limits, Kollisionsmarker, Werkzeug und aktuelle Maschinenhinweise
  dürfen dabei nicht mit verblassen. Nicht als dauerhaften Ersatz für ausreichenden Kontrast
  einführen.
- Optional später eine **Kontrastansicht** mit zurückhaltender Modellfläche und klaren
  Konturen vergleichen. Nicht einfach das ganze Maschinenmodell dunkel färben und dadurch
  dessen räumliche Erkennbarkeit verlieren. Das ist eine eigene Gestaltungsoption, keine
  Voraussetzung für P3.

Die Aussage „kein Design-System definiert eine eigene Highlight-Farbe“ bitte zurücknehmen.
Atlassian hat beispielsweise eigene Hover-Tokens für Diagrammrollen; das beweist keinen
universellen Auswahlstandard, widerlegt aber die pauschale Ausschließlichkeit des Ausblendens.
Seine Diagrammempfehlungen betonen außerdem den Kontrast zum Untergrund und zusätzliche
Trennung benachbarter Elemente.
[Atlassian Data Visualization Color](https://atlassian.design/foundations/color/data-visualization-color)

Breitere komplette Werkzeugpfade würde ich separat mit großen Programmen messen. Für diese
Runde reichen die bestehenden breiten Auswahl-/Backplot-Linien plus eine reale Szene mit
kleinen, überlagerten und vor dem Modell liegenden Segmenten. Ein vollständiger Umbau aller
Segmente auf breite Geometrie ist keine kostenlose CSS-Änderung.

### P4 — G30 braucht zuerst einen klaren Schreibvertrag

Der Entwurf mit „Aktuelle Position übernehmen“ und anschließendem „Speichern“ ist besser
verständlich als ein sofort schreibender Capture-Button. Meine bevorzugte Darstellung:

1. Überschrift **G30 · gespeicherte Maschinenposition**, Einheit und Bezug sichtbar.
2. Gleichmäßig ausgerichtete Achsfelder; Übernahme aktueller Werte ändert nur den Entwurf.
3. „G30 speichern“ schreibt; danach bestätigte Werte beziehungsweise eine konkrete
   Fehlermeldung anzeigen. Kein Bewegungsbefehl beim Speichern.

**Achsumfang ausdrücklich festlegen.** G30 speichert native Maschinenkoordinaten; ein G30
ohne Achswörter kann alle konfigurierten Achsen bewegen. Deshalb ist „immer XYZ“ als allgemeine
G30-Oberfläche zu eng.
[LinuxCNC G30/G30.1](https://www.linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g30-g30.1)
Unsere Werkzeugroutine verwendet dagegen gezielt `#5181..#5183` für XY/Z-Bewegungen
(`tool_touch_off.ngc`). Das sind unterschiedliche Anwendungsfälle.

Mein Favorit: vorhandene lineare Achsen direkt, weitere konfigurierte Achsen in einem
aufklappbaren Bereich; auch dort echte Einheiten und keine erfundenen Nullwerte. Soll die
erste Fassung nur XYZ bearbeiten, muss sie „XYZ speichern“ heißen, übrige Werte erhalten und
den begrenzten Zweck erklären. „A/C nur anzeigen“ ist dann eine bewusste Umfangsgrenze.

Vor Implementierung bitte im Plan festhalten:

- Ein Gateway-Auftrag validiert Achsen, endliche Zahlen, Einheiten und aktuellen
  Maschinenzustand. UI-Prüfungen dienen der frühen Rückmeldung. Werte außerhalb zulässiger
  Grenzen ablehnen, nicht still begrenzen. Kinematik und Koordinatenbezug berücksichtigen;
  ein Zahlenvergleich mit Gelenkgrenzen ist nicht in jedem Frame korrekt.
- Kein optimistisches „gespeichert“. Der aktuelle `setG30()`-Pfad emittiert `G30.1` und
  übernimmt danach lokale Positionswerte. Das darf der neue Dialog nicht übernehmen.
  Nach einem unklaren/fehlenden Ergebnis bleibt der Zustand unbestätigt; eine möglicherweise
  noch alte VAR-Datei ist kein ausreichender Erfolgsbeleg.
- Aktuelle Werte aus einer frischen, konsistenten Maschinenaufnahme beziehen, nicht aus dem
  Werkstück-DRO. G20/G21, Werkzeugkorrektur und rotierende Achsen gehören in die Prüffälle.
  Bei zwischenzeitlicher Änderung gespeicherter Werte den Konflikt melden statt still
  mit einem alten Entwurf zu überschreiben.

Keine zusätzliche Bestätigungsfrage für jedes normale Speichern: Der explizite Speicherknopf
genügt. Übernehmen darf einen geänderten Entwurf rückgängig machbar ersetzen. Die Regeln zum
Verlassen eines ungespeicherten Entwurfs sollen dem bestehenden Dialog-/Eingabesystem folgen.
Das ist der einzige Punkt dieses Pakets, der eine neue Backend-Schreibfunktion braucht;
ihn als eigenes Arbeitspaket mit Fehlerfällen behandeln.

### P5 — Vier Zustände unterscheiden, ohne vier Hintergrundfarben

Die bereits vorhandene `cellOwner(wcs, axis)`-Bindung ist die richtige Grundlage. Ich würde
**nicht denselben Fokusrahmen dauerhaft an der Ursprungszelle belassen**, während der echte
Fokus auf dem Numpad liegt. Das täuscht sonst zwei Tastaturziele vor.

| Zustand | Sichtbares Merkmal |
| --- | --- |
| Maschinenaktives WCS | Beschrifteter Aktiv-Marker an der Zeile |
| Für Aktionen ausgewählte Zeile | Dezente Markierung am Zeilenrand |
| Zelle in Bearbeitung | Eigene Innenkante/Markierung, passend zum Kontext „G54 · X · mm“ des Editors |
| Tatsächlicher Tastaturfokus | Bestehender Fokusrahmen am fokussierten Bedienelement |

Die Bearbeitungsmarkierung kann eine bestehende Akzentfarbe verwenden; ein neuer Zustand
erfordert nicht automatisch eine neue Farbe. Ein Stift oder eine andere sichtbare Editierhilfe
macht auch vor dem Öffnen erkennbar, dass der Wert veränderbar ist. Auf Touch nicht nur Hover
verwenden. Atlassians Inline-Edit-Muster ist dafür eine brauchbare Vorlage: Lesen und Editieren
bleiben räumlich zusammen, die Editierbarkeit und die Übernahmeaktionen sind erkennbar.
Sein automatisches Speichern bei Blur würde ich für Maschinenwerte **nicht** übernehmen.
[Atlassian Inline Edit](https://atlassian.design/components/inline-edit/usage)

Zwei konkrete Ergänzungen aus `OffsetPanel.vue` gehören in dieses Paket:

- Die Zellen werden derzeit über `td @click` geöffnet, ohne eigene fokussierbare Editieraktion.
  Eine native, beschriftete Aktion in der Zelle ergänzen; ein ARIA-Grid nur dann, wenn auch dessen
  vollständige Tastaturbedienung umgesetzt wird. Kein rein optischer Rahmen als Lösung.
- `startEditCell()` setzt nur für `r` Grad, für A/B/C derzeit die lineare Einheit. **A/B/C und R
  brauchen Grad**, lineare Achsen mm/in. Das ist beim XYZAC-Profil sichtbar relevant.

Auch beim Wechsel zwischen zwei Zellen muss klar bleiben, zu welcher Zelle ein Entwurf gehört.
Eine reine Zeilenauswahl darf nicht das aktive Maschinen-WCS ändern. Enter/Space bedienen die
Editieraktion; **Escape bleibt gemäß bestehender Operator-Entscheidung global E-Stop** und
wird hier nicht nach einer allgemeinen Web-Konvention als harmlose Abbruchtaste umgedeutet.

### P6 — Abdeckung heißt auch: Was wirkt gerade wirklich?

G28/G30 gehören als gespeicherte Positionen nicht in die WCS-Tabelle. Die Begründung „keine
LinuxCNC-Oberfläche“ ist unnötig absolut; „in den untersuchten Oberflächen“ genügt. Auch die
Aussage „ABS entspricht unserer aktiven Zeile“ bitte korrigieren: absolute Maschinenposition
und gespeicherter Versatz des aktiven WCS sind verschiedene Größen.

**G52 nicht als zusätzlichen, unabhängig addierten Versatz einführen.** G52 und G92 nutzen
dieselben Register. Eine gemeinsame Beschriftung „G52/G92“ mit Erklärung ist ehrlicher, wenn
der Ursprung nicht zuverlässig feststellbar ist. Außerdem kann G92 zeitweise aufgehoben sein,
während gespeicherte Werte erhalten bleiben.
[LinuxCNC Coordinate Systems](https://www.linuxcnc.org/docs/stable/html/gcode/coordinates.html)

Ich würde eine kleine Zustandsübersicht mit folgenden klaren Bedeutungen definieren:

| Information | Anzeige/Abgrenzung |
| --- | --- |
| G54–G59.3, Achswerte und R | Gespeicherte WCS-Werte; aktiv/reserviert erkennbar; R als XY-Drehung erklären |
| G52/G92 | Wirksamer gemeinsamer Versatz; gespeicherte, aber aufgehobene Werte gegebenenfalls in Details |
| Tool | Tatsächlich wirksame Werkzeugkorrektur; nicht mit nomineller Länge aus der Werkzeugtabelle gleichsetzen |
| Comp / externe Offsets | Betrag und Aktivierungszustand; „abgeschaltet“, „0“ und „unbekannt“ nicht verwechseln |
| TWP/Kinematik, weitere modale Korrekturen | Bei Bedarf Statusverweis/Details; keine scheinbar addierbare zusätzliche WCS-Zeile |

Für G41/G42 wäre eine aktive Modalanzeige sinnvoll, keine erfundene konstante XYZ-Korrektur.
Auch eine pauschale „Summe aller Offsets“ wäre bei Drehungen und Transformationen irreführend.
Das kann eine spätere Detailansicht sein; für diese Runde mindestens Datenquelle, Bedeutung
und bekannte Grenze jeder vorhandenen Zeile dokumentieren.

Heute verschwinden G92 und Tool sowohl bei Null als auch bei unbekannten Daten aus der
Tabelle; `hasComp` berücksichtigt `eoffsetEnabled` nicht. Das beweist noch keine falsche
Gateway-Zahl, zeigt aber eine Lücke im UI-Vertrag. Mein Gegenentwurf: eine ruhige Zusammenfassung
„Keine zusätzlichen Korrekturen aktiv“ nur bei bestätigtem Zustand, sonst „Status unbekannt“;
Details zeigen bei Bedarf auch Nullwerte. So bleibt die Standardansicht kompakt, ohne fehlende
Daten als Entwarnung darzustellen.

### P7 — Die Variante A ist eine gute Skizze, noch kein Platznachweis

Eigene Messung am bestehenden Build, Profil XYZAC, 1280×800 und 1600×1000:

| Bereich | Desktop | Touch |
| --- | ---: | ---: |
| Jog-Auswahlbereich `.radioGrid` | 208 px breit | 211 px breit |
| Höhe eines Radio-Labels | 18 px | 28 px |
| WCS-Optionsraster | 117 × 90 px | 127 × 140 px |

Mit gemessener Schrift, 8 px Innenabstand je Seite und mindestens 36 px Zielbreite braucht
eine **gleichmäßig breite** Fünferreihe der Schrittweiten bereits 220 px. Ein gleichmäßiges
WCS-Raster mit drei Spalten benötigt rund 153 px statt 127 px. Das sind Rechenmodelle,
**keine implementierten Entwürfe**; Rahmen und weitere Abstände kommen gegebenenfalls dazu.
Die Werte sind an beiden Fensterbreiten gleich, weil die Leistenabschnitte ihre Breite halten.

Damit kollidiert „Abschnittsbreite ≤ heute“ mit „alle Optionen gleich breit in einer Reihe“.
Mein Vorschlag: **Gesamtbreite und Zugriff beurteilen**, nicht jeden Abschnitt künstlich auf
seine alte Breite begrenzen. Wenige zusätzliche Pixel in einer wesentlich verständlicheren
Gruppe können sinnvoll sein, wenn die ganze Leiste nicht mehr Platz benötigt.

Als erste Variante würde ich zeichnen/messen:

- Schrittweite als verbundene Reihe; kurze Werte dürfen unterschiedliche Breiten haben,
  die Trefferflächen bleiben groß genug. Einheit einmal an der Gruppe nennen.
- Darunter „Betriebsart“ und „Jog-Bezug“ als getrennte Gruppen mit denselben Außenkanten.
  Zustände wie „Plane veraltet“ in einer reservierten Hinweiszeile statt als immer länger
  werdendes Optionslabel.
- WCS 3×3 in nachvollziehbarer Reihenfolge: G54/G55/G56, G57/G58/G59, G59.1/G59.2/G59.3.
  Den Breitenpreis von etwa 26 px ausdrücklich gegen die gewonnene Höhe prüfen.

**INI-Schritte sind nicht auf fünf Optionen begrenzt.** Bei vielen/langen Schritten eine
beschriftete Auswahl mit stets sichtbarem aktuellem Wert und einem verankerten Auswahlfeld
anbieten, nicht Optionen kürzen oder eine weitere waagrechte Scrollleiste einbauen. Eine
solche adaptive Variante muss im Plan benannt und geprüft sein; kein stiller CSS-Fallback.
Variante B mit größeren Radios bleibt ein sinnvoller Vergleich. Bei ihrer Höhe müssen aber
auch Überschriften, Kinematik-Chip und Hilfen in das 239-px-Inhaltsbudget passen.

**Zur Tastaturfrage:** Lokale Schrittweite kann native Radio-Navigation behalten.
Betriebsart, Frame und WCS lösen Maschinenbefehle aus. Dort empfehle ich Pfeile zum
Navigieren, Klick/Space/Enter zum ausdrücklichen Aktivieren. Die WAI-ARIA-Empfehlung für
Radios innerhalb einer Toolbar kennt genau diese Trennung. Das gewählte Semantikmodell
muss vollständig umgesetzt werden; native Radios allein liefern diese Variante nicht.
[WAI-ARIA Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)

Der bestätigte Maschinenzustand bleibt ausgewählt, bis die Änderung tatsächlich bestätigt
ist; ein angeforderter Wechsel erhält gegebenenfalls einen separaten Pending-Hinweis.
Tab-Navigation ist hier das falsche Muster: Sie wechselt Inhaltsbereiche. Auch Carbon
unterscheidet Ansichtswechsel von gewöhnlichen Auswahl-/Eingabekontrollen.
[Carbon Content Switcher](https://carbondesignsystem.com/components/content-switcher/usage/)

Ein konkreter Integrationspunkt: `useKeyboardShortcuts.ts` schützt heute Inputs, Textareas,
Selects und Contenteditable vor Jog-Pfeilen. Ein Umbau auf Buttons/ARIA-Radios erhält diesen
Schutz **nicht automatisch**. Die neue Gruppe muss ihre Navigation abfangen; kein zusätzlicher
Jog-Befehl, keine ungewollte Maschinenumschaltung. Ein bereits gestarteter Jog muss beim
Loslassen weiterhin gestoppt werden. Den vorhandenen E-Stop-Vorrang erhalten.

Die Wächter sollten daher Breite **und Höhe** der Trefferfläche, Tastaturabläufe,
ausstehende/abgelehnte Wechsel, gesperrte Optionen sowie zusätzliche INI-Schritte abdecken.
„Kein seitliches Scrollen“ bitte auf die Auswahlgruppe beziehen und für die gesamte Leiste
einen eigenen Budgetvergleich angeben: Die bestehende Leiste scrollt bereits horizontal.

### Was ich darüber hinaus vereinbaren würde

1. **Eine kleine Mustertabelle statt weiterer Buttonklassen.** Navigation = Tabs;
   gegenseitige Auswahl = verbundene Gruppe; Befehl = Aktionsbutton; Rückmeldung = Status.
   Jeweils ein klarer aktiver, fokussierter, gesperrter und ausstehender Zustand. Die Gruppen
   dürfen sich optisch ähneln, aber nicht Maschinenstatus und Tastaturfokus gleich darstellen.
2. **Unbekannt ist kein Nullwert.** Dieselbe Darstellung für fehlende Werte, unbestätigte
   Schreibvorgänge und Fehler in G30, Offsets und Tool-Einstellungen verwenden. Hilfreicher
   als ein weiterer Farbton ist oft ein kurzer Text direkt am betroffenen Wert.
3. **Gezielt prüfen.** Layoutfälle mit Touch, schmalem Panel und 150 % Skalierung; zusätzlich
   lange INI-Schritte und ein Profil mit weiteren Achsen. Die Zahlenkorrekturen brauchen
   gezielte Zustands-/Gatewaytests, die Gruppierung eine Tastatur- und Sichtprüfung. Kein
   pauschaler Wächter für jeden denkbaren Abstand in jedem Dialog.

Noch zwei Korrekturen an der Recherche: Android-dp, Apple-pt und CSS-px sind keine austauschbare
Normangabe. WCAG 2.5.8 setzt für AA grundsätzlich 24×24 CSS-px mit definierten Ausnahmen an;
44×44 ist das erweiterte Ziel aus 2.5.5. Daraus folgt keine universelle 8-px-Lücke zwischen
allen ausreichend großen Zielen. Unser 36-px-Kompaktboden ist eine eigene Layoutentscheidung,
der 44-px-Seitenpanelboden die bereits vereinbarte Touch-Regel.
[WCAG Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[WCAG Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)

Auch „Material schafft Segmented Buttons ab“ bitte auf die zitierte Android-/Expressive-
Implementierung begrenzen. Das ist kein Verbot des Web-Musters und kein Argument, funktionierende
Radios durch andere Semantik zu ersetzen.
[Material Components Android](https://github.com/material-components/material-components-android/blob/master/docs/components/ToggleButtonGroup.md)

### Abschluss und Belege

Bitte Fassung 2 mit den vier Festlegungen **G30-Vertrag, Offset-Vertrag/Bedienung,
Gruppenbudget und Aktivierungsverhalten** erstellen. P1/P2 und die Cyan-Auswahl können in
dieser Richtung eingeplant werden. Die weitergehende Kontrastansicht und eine zusätzliche
Modal-/Transformationsdetailansicht sind optionale Ideen, keine neuen Abnahmebedingungen.
Der vorgeschlagene separate Branch ist passend; G30 bekommt wegen des Gateway-Anteils ein
eigenes Paket. Die finale Sichtprüfung bleibt beim Operator.

Eigene Belege, ausschließlich mit Mock auf `127.0.0.1:4188`:

- [Layout-Sonde](operator-punkte.r21.layout-probe.mjs),
  [vier Messfälle als JSON](operator-punkte.r21.layout-probe.json),
  [Protokoll](operator-punkte.r21.layout-probe.txt),
  [1280×800 Touch](operator-punkte.r21.1280-touch.png).
  Die Sonde misst den bestehenden Build, keinen umgebauten Entwurf. Der Screenshot belegt
  Abstände/Leistenlayout, keine vollständige Werkzeugdaten- oder Sticky-Header-Prüfung.
  `proposedEqualRowWidth` ist eine hypothetische gesamte Reihe; bei `.modeCol` enthält sie
  zwei verschiedene Gruppen und ist ausdrücklich **kein** Budget der vorgeschlagenen Mode-Reihe.
- [Reproduzierbare Farbrechnung](operator-punkte.r21.palette-probe.py),
  [acht Varianten als JSON](operator-punkte.r21.palette.json).
  Aufruf: `python3 docs/reviews/operator-punkte.r21.palette-probe.py`.
  Vier bestehende Themes und zwei Cyan-Varianten bestehen die bestehenden Projektregeln;
  die zwei Alternativpaletten zeigen die oben benannten Grenzen.
- Primärquellen oben am jeweiligen Argument verlinkt und für diese Runde erneut gelesen.
  Empfehlungen sind von Normanforderungen und eigenen Messungen getrennt.

Keine neue Implementierung vorhanden, daher kein erneuter kompletter Offline-Gate-Lauf.

---

## Fassung 2 · Claude · Antwort auf R21 · 28. September 2026

Deine Empfehlungen übernehme ich; die vier Festlegungen stehen unten. Neu gegenüber Fassung 1
sind drei Befunde am Code, die in deine Richtung zeigen:

- **G30:** Der Handler von „Set Current Position“ will nach `G30.1` lokale Werte setzen. Er liest
  dafür `status.position`; dieses Feld gibt es nicht (der Status führt `machine_pos`). Der Zweig
  läuft deshalb nie, und die Anzeige bleibt beim alten Wert.
- **`GET /g30`** macht aus einer fehlenden Var-Zeile still `0.0` und liest nur #5181–#5183.
- **Var-Datei:** Mehrere Kommentare sagen, LinuxCNC schreibe sie nur beim Herunterfahren. Das
  stimmt nicht: `Interp::synch()` schreibt alle Parameter (`rs274ngc_pre.cc` 2064). Task ruft
  `synch` bei jedem Wechsel nach MDI oder AUTO und auf `task_plan_synch()` auf
  (`emctask.cc` 289–297). Das ist der Rücklesebeleg für P4. Die falschen Kommentare korrigiere
  ich mit.

**Korrekturen an der Recherche, übernommen:**
- WCAG 2.5.8 verlangt für AA 24 × 24 CSS-px mit Ausnahmen; 44 × 44 ist das erweiterte Ziel aus
  2.5.5. Android-dp und Apple-pt sind keine CSS-px. Unser 36-px-Kompaktboden und der
  44-px-Seitenpanelboden sind eigene Entscheidungen.
- „Material schafft Segmented Buttons ab“ gilt nur für die zitierte Android-/Expressive-Umsetzung.
- „Kein Design-System definiert eine Hervorhebungsfarbe“ nehme ich zurück; Atlassian hat
  Hover-Tokens für Diagrammrollen. Richtig ist: Kein System legt eine allgemeine Auswahlfarbe
  fest.
- P6: „in den untersuchten Oberflächen“ statt „keine LinuxCNC-Oberfläche“. ABS ist die absolute
  Maschinenposition, nicht der gespeicherte Versatz der aktiven Zeile.

### Pakete und Reihenfolge

Branch `feat/operator-backlog` auf `feat/viewer-contrast`. Je Paket ein Commit, jeder Wächter
vorher rot.

| Paket | Inhalt |
|---|---|
| **K1 · P1** | Tools-Kopf in den Stapel wie Program. Abfolge Titel/Kontext → Aktionen → Suche/Filter → Inhalt für Program, Tools und Offsets. 8 px zwischen getrennten Steuerzeilen, auch schmal. Wächter an diesen benannten Grenzen, nicht für jedes Rechteckpaar. |
| **K2 · P2** | Deckender Kopf mit ruhiger unterer Linie. Kein oberer Fade bei Tabellen mit klebendem Kopf. Lokale Schichten: Zellen < fixierte Identitätsspalte < Kopf < gemeinsame Eckzelle. `scroll-padding-top` = Kopfhöhe. |
| **K3 · P3** | Auswahl in Cyan im dunklen und im HC-dunklen Theme (`#22b8cf` / `#00e5ff`), Halo wie bisher. Vorschub und Backplot bleiben. Im Custom-Editor zeigt jede Rolle ihren gemessenen Kontrast auf Grund und Tisch, mit Warnung unter 3 : 1. Linienvorschau, Dimmen und Kontrastansicht sind optional, nicht in diesem Branch. |
| **K4 · P5/P6** | Offset-Vertrag, siehe unten. |
| **K5 · P4** | G30-Vertrag, siehe unten. Eigenes Paket wegen des Gateway-Anteils. |
| **K6 · P7** | Auswahlgruppen, siehe unten. |

Danach dein Implementierungsreview, das Offline-Gate und die Sichtprüfung des Operators. Die
optionale Kontrastansicht und eine Detailansicht für Modal- und Transformationszustände bleiben
Ideen für später.

### Festlegung 1 · G30-Schreibvertrag (K5)

**Umfang:**
- Alle konfigurierten Achsen, in der Reihenfolge von `viewer_init.axes`. Lineare Achsen in der
  linearen Einheit, Rundachsen in Grad. Parameter #5181 + kanonischer Index (X 0 … W 8), wie
  `G30.1` sie schreibt (`interp_convert.cc` 2517–2527).
- Nicht konfigurierte Achsen werden weder angezeigt noch geschrieben.
- Kein Aufklappbereich: Bei höchstens neun Achsen passt ein Raster; die Rundachsen stehen nach
  den linearen.

**Lesen (`GET /g30`):**
- Gibt alle konfigurierten Achsen zurück; eine fehlende Zeile ist `null` und nie `0.0`.
- Die Oberfläche zeigt „—“ und „unbekannt“, nie eine Null.
- Die Quelle wird genannt: „gespeichert in LinuxCNC (Stand der letzten Synchronisierung)“.

**Entwurf:**
- Die Felder sind ein Entwurf, der mit den gelesenen Werten beginnt.
- „Use current position“ füllt den Entwurf aus `STAT.position` (kommandierte Weltposition im
  Maschinenrahmen, kanonische Reihenfolge). `G30.1` speichert genau das: Programmposition plus
  G92, WCS-Versatz und Werkzeugkorrektur, also die Maschinenposition des geführten Punkts.
  `GET /g30` liefert sie als `current` neben den gespeicherten Werten, frisch aus STAT gelesen.
  Nicht aus dem Werkstück-DRO und nicht aus `machine_pos` im Status: Das ist
  `joint_actual_position`, also Gelenkwerte in Gelenkreihenfolge und die Ist-Position. Unter
  Identitätskinematik ist das fast dasselbe, unter TCP nicht.
- Übernehmen schreibt nichts.
- Ein vom Gelesenen abweichender Entwurf ist als „nicht gespeichert“ markiert.
- Verlassen folgt dem bestehenden Eingabesystem: Der Entwurf bleibt, solange das Formular lebt.

**Speichern (neuer Gateway-Befehl `set_g30 {values, based_on}`):**
- **Richtlinie:** Stufe `ready` (MDI braucht eine eingeschaltete, referenzierte Maschine). Kein
  Bewegungsbefehl.
- **Validierung im Gateway:**
  - Nur konfigurierte Achsen.
  - Endliche Zahlen in Maschineneinheiten.
  - Innerhalb des Achsfensters `[AXIS_<L>] MIN/MAX_LIMIT` aus der INI (`read_axis_limits`).
    G30 adressiert den Maschinenrahmen, den G53-Bewegungen anfahren, und unsere G30-Routinen
    laufen nur in Identitätskinematik (Gate `machineFrame`).
  - Außerhalb wird abgelehnt, nicht geklemmt. Der Grund nennt Achse und Fenster.
  - Grenze: Gelenkfenster unter anderer Kinematik prüft das nicht. Das steht in der Hilfe.
- **Ablauf, ein Befehl:**
  1. `task_plan_synch()`, dann die Var-Datei lesen.
  2. Weicht der gespeicherte Wert von `based_on` ab (der Stand, auf dem der Entwurf beruht),
     wird abgelehnt: „G30 changed meanwhile — reload“.
  3. `#5181…=` per MDI, mit `RCS_DONE` gewartet.
  4. `task_plan_synch()`, Var-Datei lesen, jeden geschriebenen Wert auf 1e-6 in
     Maschineneinheiten vergleichen.
  5. Nur bei Übereinstimmung `ok` mit den zurückgelesenen Werten.
- **Fehlerfälle:** Unklares oder fehlendes Ergebnis, Abbruch oder Abweichung ergeben „G30 not
  confirmed“. Der Zustand bleibt unbestätigt, die Oberfläche zeigt die zuletzt gelesenen Werte
  als unsicher, und ein Refresh klärt es.
- **Kein optimistisches „gespeichert“:** Der alte Zweig in `setG30()` entfällt.
- **Keine Rückfrage** bei normalem Speichern; der Speicherknopf ist die ausdrückliche Handlung.

**Prüffälle:**
- mm- und inch-Maschine, G20 im Programm;
- aktive Werkzeugkorrektur beim Übernehmen;
- Rundachsen;
- ein Wert außerhalb des Fensters;
- Konflikt mit `based_on`;
- MDI abgelehnt;
- Abweichung beim Rücklesen;
- Abbruch mitten im Befehl;
- Live an der XYZAC-Sim: Wert schreiben, rücklesen, den alten Wert wiederherstellen.

### Festlegung 2 · Offset-Vertrag und Bedienung (K4)

| Zustand | Merkmal |
|---|---|
| Maschinenaktives WCS | Textmarke „active“ in der Namenszelle (`--ok-text`), dazu die bisherige Tönung — nicht Farbe allein |
| Für Aktionen ausgewählte Zeile | `.selectedRow` wie bisher (Rand und Tönung) |
| Zelle in Bearbeitung | Innenkante 2 px in `--info` an genau der Zelle, deren Owner die offene Tastatur hat; der Kontext „G54 · X · mm“ bleibt am Editor. Kein Fokusring. |
| Tatsächlicher Tastaturfokus | der globale Fokusring am fokussierten Element |

**Bedienung:**
- Jede editierbare Zelle enthält eine native Aktion: einen Button, der wie der Wert aussieht,
  benannt „Edit G54 X“. Enter und Space öffnen die Tastatur; `td @click` bleibt für Zeiger.
- Kein ARIA-Grid.
- Escape bleibt E-Stop.
- Eine Zeilenauswahl ändert nie das aktive WCS (heute schon so; der Wächter hält es fest).
- **Einheiten:** A/B/C und R in Grad, lineare Achsen in der linearen Einheit. Die Achsart kommt
  aus `useAxes`.

**Zusatzzeilen:**
- Die Zeile heißt „G52/G92“, mit Hilfe: gemeinsames Register, G92 kann aufgehoben sein.
- Die Werkzeugzeile heißt „Tool (in effect)“: die wirksame Korrektur, nicht die Tabellenlänge.
- Comp:
  - aktiv mit Betrag → Zeile;
  - aktiv mit 0 → Zeile mit 0;
  - abgeschaltet → keine Zeile;
  - Daten fehlen → unbekannt.

  `eoffsetEnabled` wird jetzt gelesen.

**Zusammenfassung unter der Tabelle:**
- „No G52/G92, tool or comp offset in effect“ nur, wenn alle drei Daten vorliegen und keine
  Korrektur wirkt.
- Fehlt eine Quelle: „Offset status unknown — <Quelle>“.
- Eine Detailansicht mit Nullwerten ist nicht Teil dieses Branches.

**Wächter:**
- genau eine Zelle mit der Bearbeitungsmarke, die beim Schließen verschwindet;
- der Button per Tab erreichbar, Enter öffnet;
- Grad an A/C (XYZAC);
- „active“ als Text;
- null und 0 unterscheiden sich in der Zusammenfassung;
- Comp abgeschaltet gegen 0.

### Festlegung 3 · Gruppenbudget (K6)

**Zuerst die ganze Leiste messen**, bei 1280 × 800 und 1600 × 1000, Desktop und Touch,
Profil XYZAC und TWP:
- Gesamtbreite des Leisteninhalts;
- Breite und Höhe jedes Abschnitts;
- Trefferflächen.

Das ist die Basislinie im Test.

**Budgetregel:**
- Die **Gesamtbreite** der Leiste wächst nicht.
- Ein Abschnitt darf breiter werden, wenn ein anderer schmaler wird.
- Innerhalb einer Gruppe gibt es kein seitliches Scrollen.
- Die Inhaltshöhe bleibt ≤ 239 px.
- Trefferflächen auf Touch sind ≥ 36 px hoch.

**Entwurf:**
- **Schrittweite:** eine verbundene Reihe mit unterschiedlich breiten Segmenten; die Einheit
  steht einmal an der Gruppe.
- **Viele INI-Schritte:** Mehr als sechs Optionen einschließlich „Cont“ werden **eine
  beschriftete Auswahl** (`MachineSelect`, aktueller Wert immer sichtbar). Das ist eine benannte
  Regel mit eigenem Wächter (TWP-Sim: 9 Optionen), kein stiller CSS-Rückfall.
- **Betriebsart und Jog-Bezug:** zwei getrennte Gruppen untereinander, gleiche Außenkanten.
  Zustände wie „Plane veraltet“ stehen in einer reservierten Hinweiszeile, nicht im Optionstext.
- **WCS:** 3 × 3 (G54 G55 G56 / G57 G58 G59 / G59.1 G59.2 G59.3). Der Breitenpreis wird gegen
  die gewonnene Höhe gemessen.
- **Variante B** (größere Radios) wird mitgemessen. Entscheidend ist die Messung, nicht die
  Vorliebe.

### Festlegung 4 · Aktivierungsverhalten (K6)

Eine neue Komponente `ChoiceGroup.vue`:
- `role="radiogroup"` mit `role="radio"`-Buttons und `aria-checked`;
- ein Tab-Stopp (roving tabindex);
- Sperrgrund je Option über `explainAt`.

**Zwei Aktivierungsarten:**

| Gruppe | Aktivierung |
|---|---|
| Schrittweite (lokal, kein Maschinenbefehl) | automatisch: Pfeile wählen sofort, wie heute die nativen Radios |
| Betriebsart, Jog-Bezug, WCS (Maschinenbefehle) | manuell: Pfeile bewegen nur den Fokus, Klick, Space oder Enter lösen aus |

**Pfeile:**
- Links/Rechts, Hoch/Runter, Home und End werden in der Gruppe abgefangen, auch mit
  Modifikator, nach dem Muster von TabNav.
- Die Tastenkarte kehrt bei `defaultPrevented` zurück. Kein Jog über eine fokussierte Gruppe:
  Buttons sind keine Inputs, der bisherige Schutz über den Tag-Namen greift nicht.
- Keyup von Jog wird nie gefiltert; ein laufender Jog stoppt beim Loslassen.
- Escape bleibt E-Stop.

**Zustand:**
- Ausgewählt ist immer der **bestätigte** Maschinenzustand (`task_mode`, `kins_type`, `g5x`).
- Eine angeforderte Änderung zeigt bis zur Bestätigung „pending“ an der angeforderten Option.
- Eine Ablehnung zeigt ihren Grund am Control; der bestätigte Zustand bleibt ausgewählt.

**Wächter:**
- keine Jog-Befehle bei Pfeilen auf jeder Gruppe, mit und ohne Modifikator;
- genau ein Befehl bei Enter/Space;
- keiner bei Pfeilen in manuellen Gruppen;
- pending, bestätigt und abgelehnt;
- gesperrte Optionen erklären sich;
- Schrittweite mit 9 INI-Werten als Auswahl;
- Budget wie oben.

### Bitte prüfen

Reichen die vier Festlegungen für die Umsetzung? Besonders:
- der G30-Ablauf mit `task_plan_synch` und Rücklesen;
- die Grenze „mehr als sechs Schritte → Auswahl“;
- die Budgetregel „Gesamtbreite wächst nicht“.
