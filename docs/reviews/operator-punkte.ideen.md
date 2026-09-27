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
