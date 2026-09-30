# Viewer-Palette: feste Farben, Linien untereinander unterscheidbar

**Ideenrunde · 28. September 2026 · Branch `feat/operator-backlog`.** Anlass ist die Rückmeldung des
Operators zu P3 vor seiner Sichtprüfung. Belege:
- Rechnung: [viewer-palette-fest.rechnung.py](viewer-palette-fest.rechnung.py);
- Recherche: [viewer-palette-fest.recherche.md](viewer-palette-fest.recherche.md);
- frühere Recherche: [operator-punkte.recherche.md](operator-punkte.recherche.md).

## Anlass

Der Operator, 28. September:

> Es geht nicht nur um den Hintergrund. Es geht auch darum, dass diese Linien untereinander selbst
> häufig aufeinander oder nebeneinander liegen. Das ist tatsächlich der primäre Fokus. Ganz ehrlich
> sehe ich derzeit keinen farblichen Unterschied zwischen Backplot und Collision, Machine Bounds
> und Selected Line. […] Für die wichtigsten Farben können wir auch nicht zwischen Dark Mode und
> Light Mode unterscheiden. Das verwirrt zu stark, wenn beim Theme-Wechsel plötzlich andere Farben
> vorhanden sind.

Auf die ersten Ideen hin:

> Umrandung ist bei engen Linien vermutlich schwierig. Das wird doch zu dick? Bei den Machine
> Bounds kann ich es mir vorstellen. Das mit der gefahrenen Vorschau ausgrauen hört sich eigentlich
> nicht schlecht an.

## Befund

**Die Rechnung bestätigt ihn** (Abschnitt 1 des Skripts). Angegeben ist der OKLab-Abstand bei
normalem Sehen / der schlechteste Wert unter den drei simulierten Farbsehschwächen; die Regel ist
0,12:

| Paar | Hell | Dunkel |
|---|---|---|
| Eilgang / Werkzeugbahn-Box | 0,000 / 0,000 (dieselbe Farbe) | 0,000 / 0,000 |
| Grenze / Kollision | 0,147 / 0,020 | 0,162 / 0,020 |
| Backplot / Kollision | 0,165 / 0,081 | – |
| Backplot / Maschinen-Box | – | 0,230 / 0,012 |
| Auswahl / Maschinen-Box | Schwarz gegen Schiefergrau `#475569` | – |

**Ursache:**
- Die Palette wurde gegen den Hintergrund optimiert: 3 : 1 auf `--bg` und auf dem beleuchteten
  Tisch. Das folgt WCAG 1.4.11, und WCAG verlangt ausdrücklich **keinen** Kontrast der Linien
  untereinander („little overlap“).
- Für einen Bahn-Viewer ist diese Annahme falsch. Die Paartabelle (`palettePairs.ts`) trennt nur
  2 von 15 Bahnpaaren über die Farbe; 13 verlassen sich auf Form (1/2/3 px, gestrichelt, Halo).
  Bei 1–2 px dicht nebeneinander trägt das nicht.
- K3 hat die Auswahl theme-abhängig gemacht: Hell Schwarz, Dunkel Cyan. Genau das verwirrt beim
  Theme-Wechsel.

## Recherche (Kurzfassung)

- **LinuxCNC-Oberflächen** (Quelltext): Themes ändern die 3D-Farben **nie**.
  - glcanon (AXIS, gmoccapy, QtDragon): Vorschub weiß, Eilgang türkis, Auswahl Cyan 3 px.
  - Gefahrene Bahn: eigene 3-px-Spur nach Bewegungsart. Keine Strichelung (der Code ist tot).
  - probe_basic (VTK): Eilgang rot, Vorschub Lavendel, Cyan-Spur 2,5 px mit 50 %, keine Auswahl.
  - Alle haben einen dunklen Hintergrund; eine helle Variante hat nur AXIS, von Hand geladen.
- **Profi-CAM und Steuerungen** (Herstellerdoku, 13 Systeme belegt):
  - Die Eilgangfarbe ist uneinheitlich: rot (NX, Sinumerik, hyperMILL), gelb (Fusion, Mastercam),
    grün (Haas). Gemeinsam ist das **zweite Merkmal**: gestrichelt oder punktiert, oder
    ausblendbar.
  - Vorschub ist meist blau („kalt gegen warm“).
  - Kollision ist überall, wo dokumentiert, rot. Für Grenzverletzungen und Verfahrbereiche
    dokumentiert kein Hersteller eine Farbe.
  - **Keine Palette folgt einem hellen oder dunklen Theme.** Die Farben sind fest (Sinumerik,
    Heidenhain, Haas) oder vom Anwender gegen einen gewählten Hintergrund eingestellt.
  - **Gefahrene Bahn:**
    - Profi-Systeme zeigen einen Ausschnitt (Fusion: vor oder nach dem Werkzeug, „Tail“) oder
      eine Spur mit Löschen-Taste (Sinumerik, TNC, Haas).
    - **Ausgegraut** wird sie bei den Sendern CNCjs, UGS und Candle; PowerMill graut inaktive
      Bahnen aus.
  - Nur SURFCAM hat Regeln für Linie gegen Linie: Die Auswahl bekommt eine Ersatzfarbe, wenn die
    Linie selbst schon die Auswahlfarbe hat, und doppelte Strichstärke.
- **Normen:** Keine Norm legt Bahnfarben fest. IEC 60073 und 60204-1: Rot = Gefahr, Gelb =
  anormal, und „a single means of coding is often insufficient“. HMI-Praxis (ISA-101): eine Farbe,
  eine Bedeutung, Alarmfarben nur für Alarme, wenige Farben.

## Die Grenze

Eine **feste** Farbe, die 3 : 1 auf Weiß, auf `#0b0f14` und auf dem Tisch `#e0e0e0` hält, liegt in
einem schmalen Helligkeitsband (relative Leuchtdichte etwa 0,11–0,22). Dort unterscheiden sich
Farben fast nur im Farbton. Abschnitt 2 des Skripts, bester kleinster Abstand über alle vier
Ansichten:

| Farben im Band | bester kleinster Abstand |
|---|---|
| 2 bunte + Grau | 0,125 |
| 3 bunte + Grau | 0,094 |
| 4 bunte + Grau | 0,084 |

Schon **fünf** Rollen im Band (Vorschub, Eilgang, Gefahren, Grenze, Kollision) erreichen bei
normalem Sehen höchstens etwa 0,13. Der Engpass ist Ocker gegen Grau: Gelb wird im Band
zwangsläufig trüb.

**Also muss die Zahl der Linienfarben sinken.** Eine Umrandung jeder Linie scheidet für dichte Bahnen
aus: Kern plus Saum sind mindestens 3 px, benachbarte Bahnen verschmelzen. Das hat der Operator
bestätigt.

## Vorschlag

### F1 · Eine Farbe je Rolle, in Hell und Dunkel gleich

Jede Rolle hat in Hell, Dunkel und Auto-Dunkel **denselben** Wert. Die HC-Themes siehe F7.

### F2 · Drei Linienfarben

| Rolle | Wert | Form | Weiß / Dunkel / Tisch |
|---|---|---|---|
| Vorschub | `#395afa` Blau | durchgezogen, 1 px | 5,2 / 3,7 / 4,0 |
| Eilgang | `#d422e5` Purpur-Magenta | **gestrichelt**, 1 px | 4,1 / 4,7 / 3,1 |
| Grenzverletzung | `#9f6700` Ocker | durchgezogen, auf der Bahn | 4,8 / 4,0 / 3,6 |

**Eilgang-Optionen:** Die Kollisionsfarbe ist doch eine Linie (die Überlauf-Kanten, F6). Deshalb
wurde der Eilgang mit der Kollision im Ziel gewählt. Je Farbfamilie der beste Wert im Band,
Abstand normal / schlechteste Farbschwäche:

| Eilgang | zu Vorschub | zu Grenze | zu Kollision |
|---|---|---|---|
| **`#d422e5` Purpur-Magenta** | 0,259 / 0,034 | 0,344 / 0,111 | 0,265 / 0,128 |
| `#e118b6` Magenta (erster Entwurf) | 0,302 / 0,108 | 0,297 / 0,139 | **0,198** / 0,092 |
| `#c034ff` Violett | 0,214 / 0,005 | 0,362 / 0,100 | 0,304 / 0,175 |
| `#076b6f` Petrol | 0,233 / 0,095 | **0,198** / 0,127 | 0,292 / 0,113 |
| `#086f4e` Grün | 0,289 / 0,103 | **0,178** / 0,072 | 0,297 / 0,092 |

- Purpur-Magenta hält bei normalem Sehen zu allen dreien ≥ 0,259; das erste Magenta fiel zur
  Kollision auf 0,198. Das war genau das Paar, das der Operator bemängelt hat.
- Bei Farbschwäche trägt gegen den Vorschub die Strichelung.
- Vorschub / Grenze bleibt 0,357 / 0,214.
- Heute liegt das engste Linienpaar bei 0,000.

**Neue Paarregel** statt „Farbe oder Formmerkmal“:
- Zwei Linienrollen, die aufeinander oder nebeneinander liegen können, halten bei normalem Sehen
  **≥ 0,25**.
- Bei Farbschwäche halten sie ≥ 0,12. Nur wo ein benanntes Formmerkmal hinzukommt, darf dieser
  Wert darunter liegen (Eilgang: gestrichelt).
- Form ergänzt die Farbe, ersetzt sie nie.

### F3 · Gefahrene Bahn: die Vorschau blasst aus

- **Programmbahn:** Was schon gefahren ist, blasst zum Hintergrund hin aus, deckend gemischt. Das
  ist ein **Zustand**, keine Farbe. Es nimmt keinen Farbton aus dem Band und liest in beiden
  Themes als „erledigt“.
- **Nicht dasselbe wie „veraltet“:** Der heutige Stale-Zustand (`setStale`) graut die **ganze**
  Bahn, solange sie neu berechnet wird. Beides kommt zusammen vor: Antasten mitten im Lauf.
  „Gefahren“ braucht deshalb ein eigenes Mischverhältnis oder ein zweites Merkmal.
- **Nur eine vertraute Grenze:** `resolveCurrentLine` zeigt `motion_line` im Leerlauf nie und für
  nicht vertraute Zeilen nicht. Die Ausblendgrenze erbt das: lieber keine Grenze als eine geratene.
  - Im Lauf gilt die Laufposition (Zeitleiste, `motion_line` auf der Spur).
  - In der Simulation gilt die Scrub-Position (wie Fusions „nach dem Werkzeug“).
- **Daten:** `feedSrc` ordnet jedem gezeichneten Vertex seinen Index auf der Spur zu (aufsteigend).
  Ein Attribut je Vertex und ein Uniform „gefahren bis Index i“ kosten nur einen Shadervergleich.
  `rapidSrc` liegt im Track bereits vor.
- **Die Live-Spur (Backplot) als eigene Farbrolle entfällt.** Offen: Bewegungen außerhalb des
  Programms (Jog, MDI) als dünne neutrale Spur behalten oder weglassen.
- **Einordnung:** Profi-CAM graut nicht aus, die LinuxCNC-Oberflächen zeichnen eine Spur. CNCjs,
  UGS und Candle grauen aus. Der Operator zieht das Ausgrauen vor. Es macht das Bild ruhiger und
  löst Backplot gegen Kollision.

### F4 · Auswahl: Cyan auf dunklem Halo, in jedem Theme

- Kern `#22b8cf` (3 px) auf Halo `#0b0f14` (2 px je Seite), in allen Themes gleich.
  - Kern auf Halo 8,1 : 1.
  - Kern auf dunklem Grund 8,1 : 1.
  - Halo auf Weiß 19,2 : 1, auf dem Tisch 14,6 : 1.
- Die Auswahl ist **eine** Linie; ihr Halo stört nicht wie ein Saum um dichte Bahnen.
- Abstände zu den Linien (normal / Farbschwäche):
  - Vorschub 0,263 / 0,176;
  - Eilgang 0,355 / 0,122 (dazu Breite und Halo);
  - Grenze 0,275 / 0,235.
- K3s theme-abhängiges Schwarz/Cyan entfällt.

### F5 · Boxen: neutral, mit Saum

- **Maschinen-Box:** heller neutraler Kern mit dunklem Saum. Sie ist die einzige gesäumte Linie
  (der Operator hat zugestimmt). Die Doppellinie ist ihr Merkmal, keine Buntfarbe.
- **Werkzeugbahn-Box:** dieselbe Machart, dazu gestrichelt und mit Maßbeschriftung.
- Keine Box teilt eine Farbe mit einer Bahnlinie. Heute haben Eilgang und Werkzeugbahn-Box
  denselben Wert.

### F6 · Kollision: fester roter Körper

- `#c8102e` als Leuchtfarbe des Maschinenkörpers, in allen Themes gleich.
- **Überlauf-Kanten:** Die gestrichelten Kanten der Werkzeugbahn-Box außerhalb des
  Maschinenfensters (`toolpathOverflowEdges`) sind heute in der Kollisionsfarbe. Sie bedeuten
  „außerhalb der Verfahrgrenzen“, also Grenze. Sie werden Ocker. Die Kollision bleibt dann im 3D
  ein Körper.
- Grenze gegen Kollision bleibt bei Farbschwäche eng (0,031). Getrennt werden sie durch die
  **Objektart** (leuchtender Körper gegen Linie auf der Bahn) und die Glyphen in Zeitleiste und
  Code (▲ gegen ×). Das ist eine benannte Grenze.

### F7 · HC-Themes

- 4,5 : 1 auf Weiß **und** Schwarz hält ein einzelner Wert nur in einem Band von wenigen
  Hundertsteln Leuchtdichte, auf dem Tisch gar nicht.
- **Vorschlag:** HC behält die Farbtöne aus F2–F6 mit eigener Helligkeit. HC ist ein bewusst
  gewählter Sondermodus.
- Das entscheidet der Operator.

### F8 · Custom-Palette

- Gespeicherte Custom-Paletten bleiben erhalten.
- Die Rolle „backplot“ verliert ihre Bedeutung (F3). Offen: für die Nicht-Programm-Spur behalten
  oder bei der Migration fallen lassen.
- Die Kontrasttabelle im Custom-Editor bekommt eine Zeile je Linienpaar: „zu nah an Eilgang“, nach
  der Regel aus F2.

### F9 · Wächter

- **`themeTokens.test.ts`:**
  - Hell, Dunkel und Auto-Dunkel tragen für jede Viewer-Rolle denselben Wert.
  - Neue Paarregel F2 für jedes Linienpaar.
  - Die Auswahl als Kern auf Halo in jedem Theme.
- **`palettePairs.ts`:** Die Tabelle wird neu geschrieben. Für Linienpaare ist `colour: true`
  Pflicht; ein Formmerkmal darf nur ergänzen.
- **`scenes.viewer.spec`:**
  - Ausgeblendeter Teil vor der Lauf- und der Scrub-Position.
  - Box-Saum gemessen.
  - Gleiche Pixelfarbe einer Rolle in Hell und Dunkel.
- **Jeder Wächter** rot auf dem heutigen Stand.

## Fragen an Codex

1. **Band:** Trägt die Rechnung, und ist die Folgerung (drei Linienfarben) richtig? Gibt es eine
   Palette mit vier Linienfarben im Band, die normal ≥ 0,25 hält?
2. **F3:**
   - Ausblenden je Vertex über `feedSrc`/`rapidSrc` und eine Laufposition: Wo bricht das bei
     Schleifen, Unterprogrammen und LOD-Ebenen?
   - Genügt Zeilengenauigkeit (wie heute der Lauf-Playhead)?
   - Spur für Jog/MDI behalten?
3. **Eilgang Purpur-Magenta:** Die Industrie nimmt Rot oder Gelb. Beide sind bei uns belegt
   (Kollision, Grenze), und ISA-101 reserviert Alarmfarben. Ist Purpur-Magenta vertretbar, oder
   eine andere Zeile der Tabelle?
4. **F5:** Saum nur für die Boxen: Gibt es Fälle, in denen eine Box durch dichte Bahnen läuft und
   der Saum dort stört?
5. **Regel F2:** 0,25 bei normalem Sehen als Projektregel: begründbar? Die Belege nennen für kleine
   Flächen deutlich größere nötige Abstände (Stone, Szafir, Setlur 2014); für 1-px-Linien ist das
   eine Extrapolation.
6. **Weitere Ideen:**
   - Hilft ein Umschalter „Eilgänge ausblenden“? Das ist das zweithäufigste Industriemuster.
   - Oder Hervorhebung durch Abdunkeln der übrigen Bahn?

## Offen beim Operator

- **Umfang:** vor der Sichtprüfung auf `feat/operator-backlog` umsetzen, oder erst den abgenommenen
  Stand prüfen und mergen und die Palette danach auf einem eigenen Branch.
- F7: HC-Themes mit eigener Helligkeit, gleiche Farbtöne?
- F3: Jog-/MDI-Spur behalten?

---

## Review Codex · Ideenrunde R29 · 28. September 2026

**Stand:** `feat/operator-backlog`, `a750216`; gelesen `2c4b2b7..a750216`.
**Ergebnis: findings – Richtung unterstützt, Fassung noch nicht als Bauplan abgenommen.**
Feste Rollenfarben, neutrale Boxen, eine ruhigere Darstellung der abgearbeiteten Vorschau und
Ocker für die Überlauf-Kanten passen zur Rückmeldung. Es bleiben vier Punkte zu klären bzw. zu
korrigieren. Dafür braucht es jetzt keine Operator-Unterbrechung: unten stehen konkrete
Empfehlungen und ein kleiner Gegenentwurf zur Sichtprüfung. Kein Produktcode geändert.

### VP29-01 · Die Rechnung trägt die Kontraste, aber nicht die behauptete Farbanzahl-Grenze

Das Leuchtdichteband stimmt genauer als **0,11390 bis 0,21513** für die drei angegebenen
Hintergründe und 3:1. Claudes Skript läuft reproduzierbar. Seine Suche zieht jedoch 20 000
Zufallsgruppen aus einem Raster, nimmt zwingend ein bestimmtes Grau hinzu und optimiert über
vier Sehmodelle gleichzeitig. Der beste gefundene Wert ist keine obere Schranke. Er beantwortet
auch nicht die Frage nach vier Farben bei **normalem** Sehen ohne dieses zusätzliche Grau.

**Konkretes Gegenbeispiel auf dieselbe Frage 1:**

| Farbe | Weiß | Dunkel | Tisch |
|---|---:|---:|---:|
| `#24906c` | 3,977 | 4,833 | 3,012 |
| `#d800f0` | 4,056 | 4,739 | 3,072 |
| `#cc0000` | 5,887 | 3,265 | 4,459 |
| `#0048fc` | 6,301 | 3,050 | 4,774 |

Alle sechs Paare haben normal **mindestens 0,30914** OKLab-Abstand, also mehr als 0,25.
Das ist **keine empfohlene Produktpalette**: unter den simulierten Farbsehschwächen sinkt ihr
Minimum auf 0,02052. Es widerlegt aber „vier gehen nicht“; die behauptete Normal-Schranke für
fünf Farben ist ebenfalls nicht durch die vorliegende Suche bewiesen. Weniger gleichzeitige
Rollen bleiben eine gute Gestaltungsentscheidung, keine mathematisch erzwungene Anzahl drei.
Beleg: [eigene Rechnung](viewer-palette-fest.r29.probe.py) und
[alle Zahlen](viewer-palette-fest.r29.probe.json).

Auch den Normsatz korrigieren: WCAG befreit Linien nicht pauschal vom gegenseitigen Kontrast.
Das zitierte Diagramm-Beispiel setzt wenig Überlappung voraus; die allgemeine Prüfung betrachtet
relevante benachbarte Farben und die verbleibende Verständlichkeit. Eine OKLab-Schwelle ersetzt
diese Prüfung nicht. [W3C, SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

**Festlegungsempfehlung für F2/F9:** 0,25 normal als ambitionierten Such- und Regressionswert
verwenden, nicht als Nachweis der Erkennbarkeit jeder 1-px-Linie. Dass kleine Zeichen mehr
Farbabstand brauchen, ist belegt; das zitierte Modell untersucht CIELAB und andere Zielgrößen,
es liefert keine OKLab-Schwelle für unseren Viewer.
[Stone, Szafir, Setlur 2014](https://www.danielleszafir.com/2014CIC_48_Stone_v3.pdf)
Farbabstände, Hintergrundkontrast, sichtbares Formmerkmal und Verdeckungsfall getrennt prüfen.
`colour: true` bedeutet im heutigen `palettePairs.ts` ausreichenden Abstand in allen vier
Sehmodellen. Das würde für F2 nicht stimmen: Vorschub/Eilgang erreicht nur 0,033, Eilgang/Grenze
0,110. Die künftige Tabelle muss die Normal- und CVD-Bedingung ausdrücklich unterscheiden und
die Strichelung samt ihrer sichtbaren Grenzen nennen. Information weiterhin auch ohne
Farbunterschied vermitteln. [W3C, SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

### VP29-02 · F3 braucht einen Vertrag für Fortschritt, Überlagerung und Datenwechsel

**Zeilengenauigkeit genügt für „gefahren“ nicht.** `resolveCurrentLine` ist ein Text-Highlight,
kein Ausführungsnachweis für einen Bahn-Präfix. `ScrubBar.vue:462` führt die Live-Position über
`runWatcher`; dieser projiziert geometrisch und kann nach Start/Run-from-line bzw. Wiederanheften
auf einen späteren Track-Abschnitt springen (`runWatcher.ts:132`). Eine wiederholte identische
Kontur kann mehrere passende Positionen haben. Eine Zeile kann ein langer Bogen, ein Unteraufruf
oder mehrfach ausgeführt sein. Auch ein vertrauter Zeilentext beweist keine eindeutige Iteration.

**Mein Vorschlag für den Vertrag:**

- Simulation: nach Track-Segment und Scrub-Position darstellen; Rückwärts-Scrub darf wieder
  aufhellen. Mindestens nur vollständig passierte Segmente ausgrauen. Den noch laufenden
  Abschnitt nicht schon als erledigt behandeln. Eine anteilige Färbung ist möglich, aber ein
  eigener geometrischer Vertrag, nicht bloß `src <= index` am oberen Segmentende.
- Live: Programm-/Geometrieversion und Laufepoche binden, Startpunkt explizit führen.
  Run-from-line macht übersprungene Segmente nicht zu gefahrenen Segmenten. Pause hält den
  bestätigten Stand; Abbruch macht den Rest nicht fertig. Programmwechsel, Reconnect und
  Neuberechnung dürfen keinen Fortschritt auf neue Geometrie übertragen. Für identische
  Wiederholungen und Off-path muss die Gültigkeit ausdrücklich feststehen; aus dem nächsten
  geometrischen Treffer keinen gefahrenen Präfix ableiten. Wo das nicht belegbar ist, die
  Darstellung als geschätzte Ablaufposition benennen oder die Abschwächung aussetzen.
- **Ausgrauen und Ausblenden sind verschiedene Optionen.** Standard: abgeschwächt; vollständiges
  Ausblenden nur bewusst gewählt. Eine verblasste alte Passage darf eine noch offene, deckungsgleiche
  Passage nicht übermalen. Ausgeführt < offen < Auswahl ist eine Zeichenpriorität; Warnungen
  bleiben unabhängig sichtbar, auch auf ausgegrauten/ausgeblendeten Eilgängen. Ein sichtbarer
  Warnmarker neben der Auswahl verhindert, dass Auswahlfarbe die Grenzinformation ersetzt.
- Stale bedeutet „Vorschau nicht aktuell“, nicht „erledigt“. Dafür einen sichtbaren Statushinweis
  verwenden und die Fortschrittsbindung an diese Geometrie verwerfen; zwei kaum unterscheidbare
  Mischverhältnisse allein reichen nicht. „Alle Bahnen zeigen“ muss den Kontext zurückholen.

**Konkrete Umsetzungslücke im behaupteten Datenweg:** `rapidSrc` existiert im ursprünglichen
Track, wird aber im Part-Frame-Worker nicht mit `r.src` zurückgegeben
(`partFrameWorker.ts:99`, `ThreeViewer.vue:2234/2257`). Die transformierten Vertices können durch
Frame-Grenzen vermehrt sein. Der über `...g` verbleibende ursprüngliche Indexkanal darf dann nicht
als passend gelten. Beide Streams müssen durch Transformation, Frame-Split, Chunking und LOD
zuverlässig dieselben Original-Track-Indizes behalten. Ein LOD-Segment kann beide Seiten der
Fortschrittsgrenze überspannen: dort gezielt feiner zeichnen oder korrekt teilen. Lineare
Interpolation der Quellindizes über eine vereinfachte Sehne beweist keine genaue Laufposition.
Dazu Fälle mit Schleife, zweimaligem Unteraufruf, langem Bogen, reinen Eilgängen, Kinematikwechsel,
Run-from-line, Rückwärts-Scrub und Versionswechsel in F9 aufnehmen.

**Backplot nicht abschaffen, nur weil die Vorschau ausgraut.** Er ist die aufgezeichnete Live-Spur;
die Vorschau ist geplante Geometrie. Die eine kann die andere nicht ersetzen. Empfehlung:
Live-Spur als eigene, standardmäßig ausgeblendete Diagnoseebene behalten, ausdrücklich
„Live-Spur“, mit „Löschen“. Damit bleiben Jog, MDI und Abweichungen untersuchbar, ohne den
Normalblick zu überladen. Keine automatische Vermischung mit der Simulation. Den gespeicherten
Custom-Wert `backplot` dafür erhalten. Eine neutrale Farbe ist ein Kandidat, der bei der
Diagnoseansicht gegen beide Boxarten geprüft werden muss, kein automatisch gelöster Farbkonflikt.

### VP29-03 · F4 widerspricht „Umrandung nur für Boxen“; Auswahl braucht einen Gegenentwurf

3 px Kern plus zweimal 2 px Saum sind **7 px**. Auch eine Auswahl kann viele dicht nebeneinander
liegende Segmente umfassen. Dass sie nur eine Auswahl ist, schützt ihre Nachbarbahnen nicht vor
Verdeckung. F5 nennt zudem die Maschinen-Box als einzige gesäumte Linie, während F4 und die
Werkzeugbahn-Box weitere vorsehen. Den Umfang eindeutig machen.

Der bisherige Cyanwert ohne Halo hat auf Weiß nur **2,380:1**, auf dem Tisch **1,803:1**. Deshalb
ist schlichtes Weglassen des Saums mit demselben Cyan keine fertige Lösung. Ich empfehle für die
nächste Fassung zwei ausdrücklich auswählbare Entwürfe:

1. **Beide Canvas-Themes behalten:** Auswahl als 3-px-Linie ohne Saum, feste Farbe aus dem
   gemeinsamen Kontrastband plus Start-/Endmarkierung und sichtbare Zeilenbezeichnung. Den
   Farbton gemeinsam mit Vorschub und Eilgang suchen; Cyan nicht vorab als unveränderlich
   festschreiben. Der Projektwert 0,25 darf diese Suche steuern, ersetzt aber nicht die
   Unterscheidbarkeit durch Form und die Sichtprüfung dichter Bahnen.
2. **Technische Viewer-Fläche unabhängig vom UI-Theme:** optional durchgehend dunkler Grund;
   UI-Panels bleiben Hell/Dunkel. Dann kann vertrautes helles Cyan ohne Liniensaum bleiben.
   Das löst **nur den Canvas**, nicht den hellen Tisch: auch die Modellflächen brauchen dafür
   einen ausdrücklich abgestimmten, neutralen Darstellungsmodus oder einen anderen
   Auswahlfarbton. Kein stilles Umfärben des Modells bei jedem Theme-Wechsel.

Der [interaktive Vergleich](viewer-palette-fest.r29.vergleich.html) zeigt den Zielkonflikt,
zusätzlich als [Bild](viewer-palette-fest.r29.vergleich.png). Er verwendet synthetische SVG-Linien,
keinen Produkt-Renderer; seine Pixel sind kein WebGL-Abnahmebeleg.

### VP29-04 · Sichtbarkeit und F9 auch für dichte Überlagerungen festlegen

Palette und Strichelung helfen bei benachbarten Linien; eine vollständig verdeckte Linie bleibt
unsichtbar. Deshalb gehört **„Eilgänge zeigen“** in den Vorschlag, nicht bloß in die Fragen.
Ein kompakter Sichtbarkeitsbereich mit Vorschau, Eilgängen, Live-Spur und Boxen genügt. Vorhandene
Schalter dafür nutzen, keine zweite konkurrierende Viewer-Leiste. Ein ausgeblendeter Eilgang
löscht weder seinen Befund noch dessen Marker. Bei „Befund anzeigen“ den betroffenen Abschnitt
gezielt sichtbar machen und den temporären Zustand benennen. Autodesk begründet das gezielte
Ausblenden von Verbindungen ebenfalls mit der besseren Prüfung der Schnittbahnen.
[Fusion-Hilfe](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/Fusion_CAM_how_to_toolpath_display_simulation_show_hide_leads_and_links_html.htm)

Für Boxen den Saum schmal halten; nicht beide neutralen Boxen mit breitem, stets vorderstem
Saum über alle Bahnen zeichnen. Durchgezogen/gestrichelt plus Bezeichnung unterscheiden sie;
identische oder fast deckungsgleiche Boxen brauchen getrennte Sichtbarkeit. Eine kompakte
Linienlegende mit echten Strichmustern passt in denselben Bereich. Ein temporärer
„Auswahl isolieren“-Modus hilft zusätzlich; keine dauerhafte Abschwächung aller anderen Bahnen
bei jedem Hover, und Befunde bleiben erkennbar.

**F9 ergänzen:** reale Szenen mit Kreuzungen, Deckungsgleichheit und 1–3 px Abstand, kurzen
Eilgangstücken unter einer Strichperiode, schrägen Linien, hellem Tisch, verborgenen Kollisions-
körpern und markierten/abgearbeiteten Grenzsegmenten. DPR 1/2 und die relevanten Zoomstufen;
Palette und Form zusammen in der tatsächlich gerenderten Ausgabe prüfen. Kollision an einem
verborgenen Körper braucht weiter einen sichtbaren Befund mit Navigation.

„Gleiche Pixelfarbe“ ist nur für kontrollierte, deckende Innenpixel sinnvoll. Antialiasing,
Hintergrundmischung von erledigten Segmenten und beleuchtete Körper liefern absichtlich andere
Pixel. Die Invariante lautet **gleicher semantischer Basiswert**, nicht dass jedes Randpixel in
jedem Theme gleich ist. `MeshStandardMaterial.emissive` (`ThreeViewer.vue:3363`) ist zudem kein
fertiger flacher roter Pixel: Material und Beleuchtung wirken mit. Für den roten Körper
Szenenprüfung vorsehen, nicht allein den Hexwert der Emission prüfen.

### Antworten auf die übrigen Gestaltungsfragen und meine Priorität

- **Frage 3, Eilgang:** Magenta ist vertretbar; aus den recherchierten Systemen folgt keine
  einheitliche verbindliche Eilgangfarbe. Ich würde **`#e118b6` erneut als Kandidat A** nehmen.
  F2 begründet Purpur mit roten Überlauf-Linien, F6 macht genau diese Linien aber Ocker.
  Dieser Grund ist in der letzten Fassung überholt. Magenta verbessert das kritische
  Vorschubpaar unter Simulation von 0,033 auf 0,108; der geringere Rotabstand bleibt als
  bewusster Nachteil bei Linien über Kollisionskörpern zu prüfen. Purpur `#d422e5` bleibt
  Kandidat B, kein schon entschiedenes Optimum. Keine Überlegenheit bei jeder Sehschwäche
  behaupten; die Zahlen sind jeweils das Minimum der drei Simulationen.
- **Fragen 2/4/5/6:** Vertrag und Backplot-Empfehlung unter VP29-02, Boxen und Filter unter
  VP29-04, Grenzen der 0,25-Regel unter VP29-01. Sichtbarkeitsfilter und eindeutige
  Zustandsdarstellung haben hier mehr Nutzen als eine immer feinere Optimierung einzelner Hexwerte.
- **F7:** Für normale Hell/Dunkel-Themes gleiche Basiswerte. HC als expliziter eigener Modus mit
  gleichen Rollen/Farbfamilien, anderen Helligkeiten und verstärkten Formmerkmalen ist sinnvoll.
  Diese Ausnahme sichtbar dokumentieren; sie darf nicht automatisch mit dem gewöhnlichen
  Theme-Wechsel eintreten. Das Band für 4,5:1 auf reinem Schwarz und Weiß ist tatsächlich eng
  (`0,175…0,18333`), mit dem hellen Tisch ist die gemeinsame Forderung unerfüllbar.
- **F8:** Custom-Werte erhalten; für schwache Kombinationen konkrete Hinweise statt stiller
  Korrektur. Farb- und Linienmuster gemeinsam zeigen. Die neue Legende muss zu Custom-Werten
  passen. Eine neue Rollenpalette nicht beim Laden als bloßen Theme-Wechsel unterschieben.
- **Recherche präzisieren:** „Keine Theme-Anpassung dokumentiert“ ist durch die Recherche
  gedeckt; „keine Palette folgt einem Theme“ als allgemeiner Satz nicht. Ebenso Hersteller-
  defaults und Alarmkonventionen als Orientierung führen, nicht als Beweis für unseren Farbton.
- **Umfang:** Ich empfehle einen eigenen Folgebranch nach Sicherung des abgenommenen K1–K6-
  Stands. Palette/Boxen/Filter zuerst, Fortschrittsdarstellung separat dahinter: F3 ist eine
  Änderung der Laufsemantik und des Render-Datenwegs, keine kleine Farbkorrektur. Merge und
  Operator-Sichtprüfung nicht durch diese Ideenrunde vorwegnehmen.

### Nachweise und Übergabe

Claudes Rechnung ausgeführt; eigene nachrechenbare Gegenbeispiele in `.r29.probe.py/.json`.
Das eigenständige HTML wurde mit einem einzelnen niedrig priorisierten Browser in allen zwölf
Kombinationen aus drei Hintergründen und vier Sehmodellen geprüft; Eilgang-Umschalter funktioniert,
keine JavaScript-Fehler. HTTP(S) dabei blockiert, nur lokale Datei; Browser beendet. Kein Zugriff
auf die Simulation, keine Maschinenbefehle, kein Produktbuild und keine Produktänderung. Vorige
Belege und der bisherige Text dieser Datei bleiben unverändert.

**Nächste Runde:** VP29-01 bis VP29-04 in der Ideenfassung auflösen, insbesondere Auswahl ohne
ungeklärte Halo-Ausnahme und den F3-Vertrag. Dann kann der Umsetzungsplan abgenommen werden;
die endgültige Farbwahl bleibt Teil der Operator-Sichtprüfung.

---

## Operator-Entscheidungen · 28. September 2026 (nach R29)

1. **Umfang:** Erst prüft der Operator den abgenommenen Stand (Design-Welle, Viewer-Kontrast,
   XYZAC-Fix, P1–P7, Codex R28), dann wird nach `development` gemergt. Die feste Palette folgt auf
   einem **eigenen Branch**. Wie von Codex empfohlen, kommen zuerst Palette, Boxen und
   Sichtbarkeitsschalter, die Fortschrittsdarstellung (F3) separat dahinter.
2. **Viewer-Grund folgt dem Theme** (nicht dauerhaft dunkel). Die Rollenfarben sind trotzdem in
   Hell und Dunkel gleich und müssen auf Weiß, auf dem dunklen Grund und auf dem Tisch bestehen.
3. **HC-Themes:** gleiche Farbfamilien und Rollen, eigene Helligkeit (Codex' Empfehlung zu F7). Die
   Ausnahme wird dokumentiert.
4. **Live-Backplot bleibt**, sichtbar wie heute. Er ist die aufgezeichnete Spur, nicht die
   Vorschau. Damit bleibt die Rolle „backplot“ eine Linienfarbe im Band.
5. **Die Hervorhebung der aktuellen Zeile im 3D-Viewer entfällt.** Das ist die heutige
   „selection“-Rolle: die 3-px-Linie auf Halo, die `motion_line` bzw. der Scrub-Zeile folgt.
   Der Operator dazu: „nicht zwingend erforderlich und war mal am Anfang eine Idee, um sich
   abzuheben, aber ich denke mittlerweile überwiegen die Nachteile.“ Damit entfallen
   Auswahlfarbe, Halo und VP29-03. Die Werkzeugposition zeigt im Lauf und in der Simulation
   weiter, wo gerade gefahren wird. Der Zeilenbezug bleibt in der Codeanzeige.

**Folge für die nächste Fassung:** Linienrollen im Band sind Vorschub, Eilgang (gestrichelt),
Grenzverletzung und Live-Backplot. Dazu kommen die Kollision als Körper und die neutralen Boxen
mit Saum. Die Farbwahl zwischen Magenta (A) und Purpur (B) fällt bei der Sichtprüfung.

---

## Fassung 2 · Claude · 28. September 2026 (Antwort auf R29 und die Operator-Entscheidungen)

**Branch `feat/viewer-palette`** auf `661d5dd`. Er wird nach dem Merge des abgenommenen Stands auf
`development` nachgezogen. Evidenz R29 unverändert in `c14165b`. Die Zahlen stehen in Abschnitt 4
von [viewer-palette-fest.rechnung.py](viewer-palette-fest.rechnung.py).

### Antworten auf R29

| Befund | Antwort |
|---|---|
| VP29-01 | Angenommen. „Nur drei Farben“ ist zurückgenommen; die Suche war keine Schranke. Fassung 2 hat **vier** Linienfarben. 0,25 bei normalem Sehen ist Such- und Regressionswert, kein Erkennbarkeitsnachweis. Normal- und Farbschwäche-Bedingung stehen getrennt in der Paartabelle, das Formmerkmal mit seiner Grenze (unten). Der WCAG-Satz ist korrigiert: Das Beispiel in 1.4.11 setzt wenig Überlappung voraus, keine pauschale Befreiung. Der Recherche-Satz lautet jetzt „keine Theme-Anpassung dokumentiert“. |
| VP29-02 | Angenommen, und **aus diesem Branch herausgenommen.** Das Ausblenden der gefahrenen Bahn (F3) ändert Laufsemantik und Render-Datenweg. Es bekommt nach der Palette eine eigene Ideenrunde mit dem Vertrag aus R29 (Segment statt Zeile, Laufepoche, Run from line, Wiederholungen, `rapidSrc` im Part-Frame-Worker, LOD über der Grenze). Der Live-Backplot bleibt **sichtbar wie heute** (Operator-Entscheidung 4), nur seine Farbe kommt aus der neuen Palette. |
| VP29-03 | Durch Operator-Entscheidung 5 aufgelöst: Die Hervorhebung der aktuellen Zeile im 3D entfällt, mit ihr Auswahlfarbe und Halo. **Einzige gesäumte Linien sind die beiden Boxen**, schmal (unten). |
| VP29-04 | Angenommen. Sichtbarkeit und Legende sind Teil des Vorschlags (P3 unten), Szenen-Wächter in P5. |
| Frage 3 (Eilgang) | Magenta: in Fassung 2 `#ef0197`, nahe an Codex' Kandidat A `#e118b6`. Mit dem Backplot als vierter Linie ergab die Suche diesen Wert. |

### P1 · Rollenfarben, gleich in Hell, Dunkel und Auto-Dunkel

| Rolle | Wert | Form | Weiß / Dunkel / Tisch |
|---|---|---|---|
| Vorschub | `#0f86ba` Blau | durchgezogen, 1 px | 4,1 / 4,7 / 3,1 |
| Eilgang | `#ef0197` Magenta | gestrichelt, 1 px | 4,1 / 4,7 / 3,1 |
| Grenzverletzung | `#b06c02` Ocker | durchgezogen, auf der Bahn; Überlauf-Kanten | 4,2 / 4,6 / 3,2 |
| Live-Backplot | `#7c0bfa` Violett | 2 px | 6,4 / 3,0 / 4,8 |
| Kollision | `#c8102e` Rot | leuchtender Körper (keine Linie mehr) | 5,9 / 3,3 / 4,5 |

Abstände zwischen den Linien (normal / schlechteste Farbschwäche):

| | Eilgang | Grenze | Backplot |
|---|---|---|---|
| **Vorschub** | 0,334 / 0,112 | 0,251 / 0,213 | 0,252 / 0,140 |
| **Eilgang** | | 0,260 / 0,131 | 0,288 / 0,162 |
| **Grenze** | | | 0,394 / 0,200 |

- **Normal:** alle Paare ≥ 0,25.
- **Farbschwäche, Paare ohne Formmerkmal** (Vorschub/Grenze, Vorschub/Backplot, Grenze/Backplot):
  ≥ 0,140.
- **Farbschwäche, Eilgang-Paare:** ≥ 0,112; die Strichelung kommt hinzu. **Grenze der
  Strichelung:** Ein Eilgangstück kürzer als eine Strichperiode zeigt keinen Strich. Dort bleibt
  nur die Farbe (0,112).
- **Kollision gegen Eilgang/Grenze:** 0,161/0,160 normal. Mehr geben vier Linien im Band nicht
  her. Das Paar Backplot/Kollision, das der Operator bemängelt hat, liegt jetzt bei 0,351 / 0,282.
- **Einige Werte liegen am Bandrand** (3,0–3,2 : 1). Die Umsetzung darf sie leicht verschieben,
  solange jede Regel hält. Der Wächter prüft die Regeln, nicht die Hexwerte.

**HC-Themes** (Operator-Entscheidung 3): gleiche Farbfamilien, eigene Helligkeit für 4,5 : 1, dazu
verstärkte Form. HC-Hell dunkler, HC-Dunkel heller. Die Werte bestimmt die Umsetzung nach
denselben Paarregeln; die Ausnahme wird in CLAUDE.md benannt.

**Custom-Palette:** Die gespeicherten Werte bleiben, auch `backplot`. Die Kontrasttabelle bekommt
Zeilen je Linienpaar („zu nah an Eilgang“: normal < 0,25 bzw. Farbschwäche < 0,12). Es wird nichts
korrigiert und nichts beim Laden untergeschoben. Die Rollen `selection` und `selectionHalo`
entfallen; sie waren nie Custom-Rollen.

### P2 · Boxen neutral, schmal gesäumt

- **Beide Boxen:** heller neutraler Kern `#b8bec6`, 1 px, mit dunklem Saum `#3a3f45`, 1 px je Seite,
  also 3 px gesamt.
  - Kern auf Saum 5,7 : 1.
  - Kern auf dunklem Grund 10,3 : 1.
  - Saum auf Weiß 10,6 : 1, auf dem Tisch 8,0 : 1.
- **Maschinen-Box** durchgezogen, **Werkzeugbahn-Box** gestrichelt mit Maßbeschriftung. Beide sind
  wie heute einzeln schaltbar.
- **Tiefe wie heute,** nicht stets vorn: Eine Box verdeckt keine Bahn, die vor ihr liegt.
- **Überlauf-Kanten** (Werkzeugbahn-Box außerhalb der Verfahrgrenzen) in Ocker, gestrichelt.

### P3 · Sichtbarkeit und Legende

- **Neue Ebene „Rapids“** neben den vorhandenen (Toolpath, Backplot, Bounds, Toolpath Bounds), am
  selben Ort, keine zweite Leiste.
  - Ein ausgeblendeter Eilgang löscht weder seinen Befund noch dessen Marker in Zeitleiste und
    Code.
  - Springt die Navigation zu einem Befund auf einem ausgeblendeten Eilgang, wird dieser Abschnitt
    gezeigt und der temporäre Zustand benannt.
- **Kompakte Legende** mit echten Strichmustern (Vorschub, Eilgang, Grenze, Backplot, beide Boxen),
  im Ebenen-Bereich. Sie folgt den Custom-Werten.

### P4 · Die Hervorhebung der aktuellen Zeile im 3D entfällt

- `setHighlight` und `setHighlightTrackRange` samt Materialien (`LineSegments2`, Halo) werden
  entfernt, ebenso `SELECTION_WIDTH_PX`, `SELECTION_HALO_PX`, `--viewer-selection(-halo)` und
  `__viewerDiag.getSelection`.
- Die Zeile zeigt weiter die Codeanzeige (Lauf und Simulation). Die Position zeigt das Werkzeug.
- Die Kontrastzeilen „selection core/halo“ im Custom-Editor entfallen.

### P5 · Wächter

- **`themeTokens.test.ts`:**
  - Hell, Dunkel und Auto-Dunkel tragen für jede Viewer-Rolle denselben Wert.
  - HC: dieselbe Farbfamilie (Farbtonabstand begrenzt) mit 4,5 : 1.
  - Jede Linienrolle 3 : 1 auf `--bg` und Tisch.
- **`palettePairs.ts` neu,** mit getrennten Feldern:
  - `normal` (≥ 0,25);
  - `cvd` (≥ 0,12 oder ein benanntes Formmerkmal mit Grenze);
  - Objektart.
- **`scenes.viewer.spec`**, reale Szenen, DPR 1 und 2:
  - Kreuzungen, Deckungsgleichheit, 1–3 px Abstand;
  - Eilgangstücke unter einer Strichperiode;
  - schräge Linien;
  - heller Tisch;
  - verborgener Kollisionskörper mit Befund und Navigation.

  Geprüft wird der **gleiche semantische Basiswert** je Rolle in Hell und Dunkel an deckenden
  Innenpixeln, nicht jedes Randpixel. Der rote Körper wird in der Szene geprüft, nicht über den
  Hexwert der Emission.
- **Hervorhebung:** Kein Material mit Rolle `selection` bleibt übrig.
- **Jeder Wächter** rot auf dem heutigen Stand.

### Paketfolge

1. **P4:** Hervorhebung entfernen. Das ist klein und nimmt die Auswahlrolle aus der Tabelle.
2. **P1:** Palette, Paartabelle, `themeTokens`, HC, Custom-Tabelle.
3. **P2:** Boxen mit Saum, Überlauf-Kanten Ocker.
4. **P3:** Ebene „Rapids“, Legende.
5. **Szenen-Wächter und Doku,** dann Offline-Gate, Codex-Implementierungsreview, danach die
   Sichtprüfung des Operators (Eilgang A/B entscheidet er dort).

Das Ausblenden der gefahrenen Bahn (F3) folgt danach mit eigener Ideenrunde.

### Fragen an Codex

1. **P1:** Tragen die Werte und die getrennte Paarregel? Siehst du ein Paar, das in dichten Bahnen
   trotzdem kippt?
2. **P2:** Genügt ein Saum von 1 px je Seite? Oder soll die Werkzeugbahn-Box ohne Saum auskommen,
   weil Strichelung und Maße sie schon tragen?
3. **P4:** Übersehe ich einen Nutzer der Hervorhebung? Kandidaten: Befund-Navigation,
   Run-from-line-Dialog, Scrub-Zeile.
4. **P3:** Legende im Ebenen-Menü oder als eigenes kleines Overlay?

---

## Review Codex · Ideenrunde R30 / Fassung 2 · 28. September 2026

**Stand:** `feat/viewer-palette`, `af2468b`, Worktree `/home/cnc/lcnc-suite-backlog`;
Nachprüfung `c14165b..af2468b`.
**Ergebnis: agreement auf Planungsebene.** Die Operator-Entscheidungen sind übernommen und
VP29-01 bis VP29-04 für diesen Umfang aufgelöst. Palette, Boxen, Ebenensteuerung und Entfernen
der 3D-Zeilenhervorhebung können in der vorgeschlagenen Paketfolge umgesetzt werden. F3 bleibt
außerhalb dieses Branch-Umfangs und braucht seine eigene Ideenrunde. Dies ist keine Abnahme der
noch ausstehenden Implementierung oder ihrer visuellen Wirkung.

### Antworten auf die vier Fragen

**1. Palette und Paarregel: als Kandidat für die Umsetzung ja.** Die deterministische Nachrechnung
von Abschnitt 4 bestätigt alle sechs Normal-Abstände und alle Hintergrundkontraste. Es gibt
genau eine Ausnahme unter 0,12 in der CVD-Simulation: Vorschub/Eilgang mit **0,112234**. Sie ist
jetzt ausdrücklich benannt. Die übrigen fünf Linienpaare erreichen mindestens 0,131318; die
Paare ohne Eilgang mindestens 0,140029. Backplot/Kollision liegt bei **0,350704 / 0,281951**
(normal / schlechteste Simulation) und beseitigt damit den bisherigen Farbnähe-Konflikt deutlich.

Die knappen Reserven nicht durch Rundung verstecken:

| Prüfung | genauer Wert | Konsequenz |
|---|---:|---|
| Backplot auf Dunkel | 3,006709:1 | besteht rechnerisch knapp; keine Alpha-Abschwächung in der normalen Live-Spur |
| Vorschub auf Tisch | 3,095329:1 | gerenderte schräge/dünne Linien in P5 prüfen |
| Vorschub / Grenze normal | 0,250711 | vor Farbkorrekturen alle Paare neu messen |
| Vorschub / Backplot normal | 0,251917 | ebenso, nicht nur die Hintergrundprüfung wiederholen |

In dichten Bahnen bleiben zwei konkrete Grenzen: kurze Eilgangsegmente können kein erkennbares
Strichmuster zeigen oder in einer Strichlücke liegen; ein deckungsgleicher Backplot kann die
Vorschau oder ihre Grenzmarkierung verdecken. Der zweite Fall ist keine Farbabstandsfrage:
`backplotController.ts:90` zeichnet die 2-px-Spur mit `renderOrder=11`, der Grenz-Overlay in
`toolpathController.ts:422` mit 10. P5 sollte deshalb ausdrücklich **Backplot über einer
Grenzverletzung** enthalten und prüfen, dass der Befund weiter auffindbar ist. Bei der gezielten
Befundansicht muss der Warnabschnitt erkennbar werden; ein vorübergehend zurückgenommener
Backplot oder ein Befundmarker kann das leisten. Keine erneute allgemeine Zeilenauswahl dafür
einführen. Im Normalblick bleibt der Backplot gemäß Operatorentscheidung sichtbar.

Die neue Paartabelle sollte die 0,25-Regel auf die **vier Linienrollen** anwenden. Körper-/Linien-
Paare sind getrennte Fälle mit Objektmerkmal und Szenenprüfung; sonst würde der eigene Kandidat
bei Eilgang/Kollision (0,161386) und Grenze/Kollision (0,159862) durchfallen. „Mehr geben vier
Linien im Band nicht her“ weiterhin nur als Suchergebnis formulieren, nicht als bewiesene
Schranke. Das ändert meine Zustimmung zu diesem Kandidaten nicht.

**2. Boxen: 1 px Kern plus 1 px Saum je Seite ist ein sinnvoller Ausgangspunkt.** Beide Boxen
behalten den Saum. Bei der Werkzeugbahn-Box ersetzen Strichelung und Maße den Kontrast des
Strichs auf dem Hintergrund nicht. Die Rechnung bestätigt Kern/Saum **5,675:1**, Kern/Dunkel
10,268:1 sowie Saum/Weiß 10,623:1 und Saum/Tisch 8,047:1.

Die Breiten in **CSS-Pixeln** festlegen und bei DPR 1/2 prüfen. Kern und Saum der gestrichelten
Box müssen dieselben Strichlücken haben; ein durchgezogener dunkler Saum würde die Unterscheidung
wieder verwischen. Beide Durchgänge respektieren Tiefe und Verdeckung. Bei deckungsgleichen
Boxen helfen die getrennten Ebenenschalter. Eine klare Priorität an Ocker-Überlaufkanten verhindert,
dass der neutrale Kern darüberzeichnet. Erst die realen P5-Szenen entscheiden, ob 3 px Gesamtbreite
an engen Konturen zu dominant sind; vorher keinen dickeren Saum vorsehen.

**3. Nutzer der Hervorhebung: die Entfernung ist möglich, diese Nachbarn aber erhalten.**
Die produktiven Aufrufe von `setHighlight`/`setHighlightTrackRange` liegen im aktuellen
Viewer-Highlightblock (`ThreeViewer.vue:2111`). Eine zweite manuelle 3D-Auswahl für Run-from-line
habe ich nicht gefunden. Dessen `selectedLine` ist lokaler Zustand des `GcodePanel`
(`GcodePanel.vue:561`); die Codeauswahl und der Startdialog bleiben unabhängig davon erhalten.

- `trackHighlightRange` und seine reinen 3D-Publikationen können mit entfernt werden.
  **Nicht das ganze Modul `trackHighlight.ts` löschen:** `runLineState`, `subExecState` und
  `resolveCurrentLine` versorgen weiterhin die Hauptdatei und die Unterprogrammanzeige
  (`App.vue:656`). Auch der Run-Watcher bleibt für diese Anzeige nötig.
- **`_scrubLineNo` bleibt nötig**, obwohl der Name im Highlightpfad auftaucht: die Variable wird
  auch an `_updateClashTint` übergeben (`ThreeViewer.vue:2688/3327`). Ebenso Scrub-Pose, Track und
  Cum erhalten. Sonst ginge mit der Auswahl unbeabsichtigt die Kollisionsfärbung verloren.
- `ScrubBar.jumpTo` (`ScrubBar.vue:815`) setzt die Simulationsposition und ruft `applyPos` auf;
  die Befundnavigation hängt nicht vom Auswahlmaterial ab. Ihr Ergebnis weiter über Werkzeugpose,
  Befund und Codezeile prüfen. `LineSegments2` bleibt für den 2-px-Backplot erforderlich.
- P4-Wächter nicht nur auf „kein Material mit selection-Rolle“ beschränken: zusätzlich bestätigen,
  dass nach Scrub/Befundsprung die Werkzeugpose und Kollisionsfärbung stimmen, die Codezeile samt
  Unterprogramm weiter folgt und Run-from-line seine gewählte Zeile behält. Damit wird die
  beabsichtigte Entfernung gegenüber einem versehentlich größeren Funktionsverlust abgegrenzt.

**4. Legende: in den vorhandenen Ebenen-Bereich, kein weiteres dauerndes Overlay.** Am besten
Strichprobe und Rollenname direkt an derselben Ebenenzeile, statt eine zweite getrennte Liste.
Grenze und Kollision als erklärende Zeilen ergänzen; die Kollision fehlt noch in der aufgezählten
Legende, obwohl gerade ihre Bedeutung von den anderen Rollen unterschieden werden soll.
Die Symbole ▲/× aus Code und Zeitleiste dort wiederholen. Das verbraucht wenig zusätzlichen
Platz im Viewer und hält Sichtbarkeit und Erklärung zusammen.

Für den temporär gezeigten Eilgang empfehle ich einen **lokalen Befundzustand**, keine Änderung
der gespeicherten Ebenenwahl: neuer Befund ersetzt ihn, manuelles Scrubben, Simulationsende und
Programmwechsel räumen ihn auf; die Anzeige benennt ihn. Auch den Fall „Toolpath insgesamt aus“
berücksichtigen. Die Wiederherstellung darf eine inzwischen bewusst geänderte Nutzerwahl nicht
überschreiben. Das lässt sich innerhalb von P3/P5 ohne weitere Ideenrunde konkretisieren.

### Einordnung der R29-Punkte und des Prüfumfangs

- **VP29-01 geschlossen:** vier Rollen, getrennte Normal-/CVD-Regeln, benannte Ausnahme und
  berichtigter Normbezug. Die Werte sind Suchkandidaten; Zahlenwächter ersetzen keine Sichtprüfung.
- **VP29-02 aus diesem Umfang entfernt:** kein Ausblenden vermeintlich gefahrener Segmente;
  Backplot bleibt sichtbar. Der Vertrag für F3 ist als eigene Folgerunde übernommen.
- **VP29-03 durch Operatorentscheidung geschlossen:** Auswahlrolle und Halo entfallen;
  Viewer-Grund folgt dem Theme. Kein Rückgriff auf den verworfenen dauerhaft dunklen Grund.
- **VP29-04 auf Planungsebene geschlossen:** Rapids-Ebene, integrierte Legende, Navigation und
  reale Überlagerungsszenen sind enthalten; oben stehen die konkreten Prüfziele dazu.

HC mit eigener Helligkeit und erhaltenen Farbfamilien ist akzeptiert. Die bestehende Trennung
beibehalten: **4,5:1 zum jeweiligen HC-Hintergrund, mindestens 3:1 zum beleuchteten Tisch**
(`themeTokens.test.ts:104–107`), nicht versehentlich 4,5:1 zu beiden fordern. Auch bei HC sind
Paarabstand und Form gemeinsam zu prüfen. Custom-Werte bleiben unverändert; im Hinweis die
Farbprüfung und das ergänzende Strichmerkmal getrennt benennen, damit der eingebaute
Vorschub/Eilgang-Kandidat nicht zugleich als ungeklärter Konfigurationsfehler erscheint.

Belege: [viewer-palette-fest.r30.probe.py](viewer-palette-fest.r30.probe.py),
[viewer-palette-fest.r30.probe.json](viewer-palette-fest.r30.probe.json). Es wurden nur die
Formeldefinitionen und Fassung-2-Werte aus der vorhandenen Rechnung ausgewertet, nicht ihre
Zufallssuche erneut gestartet. Statische Verbrauchersuche für P4; kein Browser, Produktbuild,
Test-Gesamtlauf oder Zugriff auf `:5173`/`:8000`. Vorbereitung unter `/tmp`, Rechenlauf mit
`nice -n 19`; keine Maschinenbefehle. Im Palette-Worktree nur dieser Anhang und die zwei neuen
Belege, bisherige Texte/Belege unverändert. Der Live-Produktcheckout wurde nicht bearbeitet.

**Übergabe:** Plan-Agreement für Fassung 2 in diesem Umfang; keine weitere Ideenrunde vor P4/P1/P2/P3
nötig. Implementierungsreview, HC-/Szenennachweise und abschließende Operator-Sichtprüfung folgen
nach der Umsetzung. Die Handshake-Rückmeldung verwendet das bestehende gemeinsame Protokoll.

---

## Umsetzung · Claude · Anfrage Implementierungsreview · 28. September 2026

Branch `feat/viewer-palette` (Worktree `/home/cnc/lcnc-suite-backlog`) auf `661d5dd`. Umgesetzt
ist Fassung 2 mit deinem Plan-Agreement R30, in der Paketfolge. Evidenz R30 unverändert in
`11644dc`. Jeder Wächter lief vorher rot, gegen den Stand davor oder unter einer gezielten
Mutation.

| Paket | Commit | Inhalt | Wächter (rot vorher) |
|---|---|---|---|
| P4 | `fd60bde` | Keine 3D-Hervorhebung der aktuellen Zeile. Entfernt: Controller-Objekte, `setHighlight*`, `SELECTION_*`, Rollen und Tokens `selection(-halo)`, `trackHighlightRange`, `lineRunAround`, `getSelection`, die Custom-Zeilen und `motion_line` als Render-Diff. Erhalten wie in R30 gefordert: `runLineState`, `subExecState`, `resolveCurrentLine`, Run-Watcher, `_scrubLineNo` (Kollisionsfärbung), `jumpTo`. | Controller: keine Rolle `selection`, keine Bildschirmlinie, keine API (rot auf dem alten Controller). Tokens: kein `--viewer-selection`. Szene: kein Auswahlmaterial bei gesetzter Zeile. |
| P1 | `808b755` | Hell, Dunkel und Auto-Dunkel identisch: Vorschub `#0f86ba`, Eilgang `#ef0197`, Grenze `#b06c02`, Backplot `#7c0bfa`, Kollision `#c8102e`; Werkzeug und Schneide mit den hellen Werten. HC eigene Helligkeit, siehe unten. `palettePairs.ts` neu (Arten `line` / `object`, `cvd`, `cueLimit`), eine Farbmathematik in `viewer/colourMath.ts`, Paarzeilen im Custom-Hinweis (`customPairRows`). | `themeTokens`: Paarregel je Theme und „Hell, Dunkel, Auto-Dunkel gleich“ (6 rot auf den alten Tokens); HC-Familie rot unter mutiertem Farbton. `customContrast`-Unit-Test. |
| P2 | `2a10656`, `54fad93` | Gesäumte Boxen (`viewer/casedLines.ts`): Kern `#b8bec6` 1 CSS-px auf Saum `#3a3f45` 3 CSS-px, zwei `LineSegments2` über **einer** Geometrie (gleiche Strichlücken), Tiefe beachtet, der Saum schreibt keine. Maschinen-Box durchgezogen, Werkzeugbahn-Box gestrichelt mit Maßen (Paarart `form`). Überlauf-Kanten in Ocker, gestrichelt, über der Box. Reach-Umrisse mit eigenem Grau `--viewer-reach` (HC-Dunkel `#78808b`). | Controller: gesäumte, gestrichelte, geklippte Box (rot auf dem alten Controller). Tokens: Kern oder Saum auf Grund und Tisch, Kern auf Saum, alle fünf Blöcke. Custom-Hinweis mit Saumregel. |
| P3 | `bb91c6c` | Ebene „Rapids“: blendet die Eilgang-Linien aus, ihre Grenzmarkierung folgt nur der Toolpath-Ebene. Befund-Sprung auf ausgeblendeten Eilgang oder Toolpath: lokal gezeigt und benannt (`viewer/pathReveal.ts`, `.hudWarn`), gespeicherte Wahl unberührt; Ende durch manuellen Scrub, Simulationsende, Programmwechsel oder eigenen Schalter. Legende an den Ebenenzeilen (Strichprobe, gestrichelt oder gesäumt), dazu Zeilen für Grenze ▲ und Kollision ×. | Controller: Eilgänge aus, Befund bleibt (rot auf dem alten Controller). `pathReveal`-Unit-Tests. e2e `rapids.viewer.spec`: Ebene, Anzeige beim Sprung, Ende durch Scrub und Schalter (rot bei mutierter Anzeige). |
| P5 | `6960612` | Grenzmarkierung zeichnet über dem Backplot (`renderOrder` 12 > 11 > 10). | Szene DPR 1/2 Hell/Dunkel: Backplot entlang einer Verletzung, an der Linie liest man Ocker (rot mit alter Reihenfolge). Box-Kante: Kern 1 px und Saum 3 px als Material, beide im Bild. `viewer.spec`: Dunkel zeichnet Hells Werte, HC-Dunkel löst neu auf. Controller: Überlagerung über Backplot über Bahn. |

**HC-Werte** (gleiche Familie, Farbton höchstens 15° vom normalen Wert, Buntheit ≥ 0,08):

| Theme | Vorschub | Eilgang | Grenze | Backplot | Kollision | engstes Linienpaar |
|---|---|---|---|---|---|---|
| HC-Hell | `#0a7bc5` | `#d7079c` | `#7c4201` | `#320578` | `#d51713` | 0,277 |
| HC-Dunkel | `#048ab3` | `#f40793` | `#ad6302` | `#9741fe` | `#fb1903` | **0,244** |

HC-Dunkel bleibt unter 0,25. Die gezielte Suche mit 120 Starts kam nicht höher: 4,5 : 1 auf
Schwarz und 3 : 1 auf dem Tisch lassen ein Band von wenigen Hundertsteln Leuchtdichte. Das ist
als benannte Ausnahme `LINE_MIN_NORMAL_HC = 0,24` festgehalten, als Suchergebnis und nicht als
bewiesene Schranke.

**Beim Messen gefunden:** Der Eilgang der Breiten-Szene lief in der Draufsicht deckungsgleich über
die gemessene Vorschublinie zurück. Mit dem alten Grün zählte ein Strich noch halb als Vorschub,
mit Magenta nicht mehr. Die Szene führt den Eilgang jetzt seitlich weg. Deckungsgleiche Linien
zeigen oben die zuletzt gezeichnete; die Strichelung des Eilgangs lässt den Vorschub dazwischen
sichtbar.

Offline-Gate (`python3 scripts/test_suite.py offline`) auf `49a8b5f`: PASS, Backend 1069,
Vitest 1714, Playwright 341/341. Der erste Lauf scheiterte an einer Kontrollprobe in `tabs.spec`
(Pfeil rechts, bevor die geschützte Fokus-Rückgabe gelandet war; einzeln 1 von 3 rot). `49a8b5f`
lässt sie auf den Fokus am Settings-Knopf warten, danach 6 von 6 grün; das Produkt ist unverändert.

### Bitte prüfen

1. **P4:** Ist beim Entfernen ein Nutzer übersehen? Befundsprung, Kollisionsfärbung,
   Unterprogrammanzeige und Run-from-line sind erhalten und getestet.
2. **P2:** Die Box-Messung im Bild prüft das Vorhandensein von Kern und Saum. Die exakte
   Pixelfolge scheiterte, weil die Live-Box des Mocks Ober- und Unterkante innerhalb von 1–2 px
   überlagert. Genügt das zusammen mit der Materialprüfung?
3. **P3:** Die Befund-Anzeige endet beim eigenen Schalter der Ebene. Sie endet auch bei jedem
   neuen Programm-Payload (`viewerGcode`), also auch bei einer Neuberechnung desselben Programms.
   Ist das zu streng?
4. **HC-Dunkel 0,244:** Ausnahme so tragbar, oder eine andere Regel für HC?

---

## Review Codex · R31 · Implementierung P4/P1/P2/P3/P5 · 28. September 2026

**Stand:** `048e4d0`, Branch `feat/viewer-palette`, ausschließlich im Worktree
`/home/cnc/lcnc-suite-backlog`; geprüft gegen `661d5dd`. **Ergebnis: findings.**
Die festen Farben, die Entfernung der 3D-Auswahl und die gesäumten Boxen sind in diesem
Stand nachvollziehbar umgesetzt. Offen bleiben drei Fehler der temporären Befundansicht
und eine falsche Zuordnung im Custom-Kontrasthinweis. Keine Änderung am Produktcode.

### VP-I01 · P2 · Eine allgemeine Einstellungsaktualisierung beendet die Befundansicht

**Auslöser:** Rapids ausschalten, zum Eilgang-Grenzbefund springen, anschließend ausschließlich
das Theme von Hell auf Dunkel ändern. Die gespeicherte Ebenenwahl bleibt `rapids: false`.
**Ist:** Der eben eingeblendete Eilgang und sein Hinweis verschwinden. Die Simulation bleibt
an derselben Stelle aktiv. Eine Einstellung eines anderen Clients kann das ebenfalls auslösen.

Ursache: `ThreeViewer.vue:1097–1102` löscht `pathReveal` bei jedem Aufruf für Toolpath/Rapids,
auch wenn sich der Wert nicht ändert. `applyViewerDefaults` ruft diese Methode für **alle**
Ebenen auf (`:3666`); der Watcher auf `settingsVersion` tut dies bei jeder Aktualisierung
(`:3768`). Dieser Weg unterscheidet eine bewusste Ebenenänderung nicht von ihrer erneuten
Übernahme. Der Kommentar „operator's own switch“ beschreibt deshalb nicht die tatsächliche
Bedingung.

**Korrektur:** Das Ende an eine tatsächliche Änderung der betreffenden Ebenenwahl beziehungsweise
an den ausdrücklichen lokalen Schalter binden. Eine unveränderte Übernahme, ein Theme-Wechsel
oder eine fachfremde Einstellungsänderung erhält den Befundzustand. Eine tatsächlich geänderte
Wahl eines anderen Clients soll weiterhin gelten; keine alte Wahl zurückschreiben.

**Beleg:** [r31.settings.json](r31.settings.json), [Bild](r31.settings.png), erster Test in
[r31.review.spec.ts](r31.review.spec.ts). Vorher `rapidShown=true`, Hinweis sichtbar; nachher
`rapidShown=false`, Hinweis entfernt, `simulation=true`. Die Sonde erwartet das vereinbarte
Fortbestehen und ist am geprüften Stand rot.

### VP-I02 · P2 · Bei ausgeschaltetem HUD bleibt die temporäre Einblendung unerklärt

**Auslöser:** HUD und Rapids ausschalten, dann denselben Grenzbefund anspringen.
**Ist:** Der Eilgang wird eingeblendet, aber es gibt keinen Hinweis auf die Abweichung von der
gespeicherten Ebenenwahl. Das ist nicht nur ein außerhalb des sichtbaren Bereichs liegender Text:
`[data-path-reveal]` existiert im DOM überhaupt nicht.

Der Hinweis steht zwar außerhalb des inneren `template v-if="hudVisible"`, sein gemeinsamer
Elternblock wird aber durch `(hudVisible && hasHudNotes) || failedParts.length` ausgeschlossen
(`ThreeViewer.vue:4305`, Hinweis `:4351`). Zusätzlich enthält `hasHudNotes` (`:3882`) den neuen
Befundzustand nicht als eigenständigen Anzeigegrund.

**Korrektur:** Der temporäre Zustand braucht unabhängig vom DRO/HUD-Schalter einen sichtbaren
Hinweis, etwa bei der Befundnavigation oder als eigener Anzeigegrund der vorhandenen Karte.
Dabei auch die kompakte/faltbare Form berücksichtigen; ein eingeschalteter Layer darf nicht nur
hinter einer allgemeinen Warnungszahl erklärt werden. Die bestehende Begrenzung der unteren
Spalte erhalten.

**Beleg:** [r31.hud-off.json](r31.hud-off.json), [Bild](r31.hud-off.png), zweiter Test in
[r31.review.spec.ts](r31.review.spec.ts): `rapidShown=true`, `noticeCount=0`, Simulation aktiv.
Der vorhandene Rapids-Test erfasst diesen Zustand nicht; er prüft den Text bei eingeschaltetem
HUD.

### VP-I03 · P2 · Ein Befundsprung zeigt die gesamte ausgeblendete Ebene

Fassung 2 verspricht in P3 den betroffenen Abschnitt. Tatsächlich speichert `PathReveal`
nur zwei Ebenen-Booleans (`viewer/pathReveal.ts:11–24`). `applyPathLayers`
(`ThreeViewer.vue:1074–1076`) schaltet damit sämtliche Eilgänge beziehungsweise den gesamten
Toolpath ein. Das stellt gerade bei dichtem Programm die zuvor ausgeblendete Linienmenge wieder
her, obwohl nur eine konkrete Bewegung untersucht werden soll.

**Reproduktion:** Ein 90-mm-Eilgang liegt entfernt bei Y=80; der angesprungene Grenzbefund liegt
auf einer 7-mm-Bewegung bei Y=20. Vor dem Sprung sind Rapids aus. Danach ist auch der entfernte
90-mm-Eilgang wieder sichtbar: dieselbe projizierte Lage und Länge von **169,50 CSS-px** wie
bei vollständig eingeschalteten Rapids. Der vorhandene Wächter mit nur einem Eilgang kann
gezielte Einblendung und vollständiges Einschalten nicht unterscheiden.

**Korrektur:** Den temporären Bereich an den angesprungenen Track-/Bewegungsbereich binden und
nur dessen zuvor verborgene Geometrie ergänzen; übrige ausgeblendete Bewegungen bleiben verborgen.
Auch „Toolpath insgesamt aus“ abdecken. Hierfür weder die entfernte allgemeine Zeilenauswahl
noch eine neue Auswahlfarbe zurückbringen. Bei Unterprogrammen die Track-Identität verwenden,
nicht allein eine möglicherweise mehrfach vorkommende Quellzeilennummer.

**Beleg:** [r31.multirapids.json](r31.multirapids.json), [Bild](r31.multirapids.png), Test
„reveal contains only the requested rapid section“ in [r31.extra.spec.ts](r31.extra.spec.ts).

### VP-I04 · P3 · Custom zeigt den richtigen Warnbedarf an der falschen Zahl

Bei Custom-Boxfarbe `#3a3f45`, identisch zum festen Saum, ist der Kern/Saum-Kontrast **1:1**.
Die Tabelle zeigt stattdessen **„10.6 : 1 · low“** unter „On background“ und
**„8.0 : 1 · low“** unter „On the table“. Diese beiden Kontraste erfüllen ihre Schwelle;
der tatsächlich unzureichende Kern/Saum-Wert wird nicht gezeigt.

`customContrastRows` verknüpft `casingLow` mit `bgLow` und `tableLow`, liefert aber weiterhin
die guten Hintergrund-/Tischwerte zurück (`viewer/customContrast.ts:48–52`).
`SettingsPanel.vue:744–745` hängt „low“ unmittelbar an diese Werte. So kann der Nutzer aus der
Warnung nicht ableiten, welchen Kontrast er verbessern muss.

**Korrektur:** Hintergrund, Tisch und Kern/Saum getrennt bewerten und den misslungenen Vergleich
mit seinem Wert nennen. Dafür genügt bei Boxen eine ergänzende Zeile oder ein gezielter Hinweis;
keine stille Korrektur der Custom-Farbe.

**Beleg:** [r31.custom.json](r31.custom.json), [Bild](r31.custom.png), letzter Test in
[r31.extra.spec.ts](r31.extra.spec.ts).

### Antworten auf die vier Umsetzungsfragen

1. **P4 / verbleibende Nutzer:** Im Diff und in der Verbrauchersuche kein weiterer versehentlich
   entfernter produktiver Nutzer gefunden. `runLineState`, `subExecState`, `resolveCurrentLine`
   und der Run-Watcher bleiben; `App.vue:656` verwendet die Textauflösung weiterhin.
   `GcodePanel.selectedLine` und der Run-from-line-Dialog sind davon unabhängig. Scrub-Pose,
   `_scrubLineNo`, Cum und Track bleiben mit `_updateClashTint` verbunden. Die gezielten
   Track-/Run-Watcher-Tests bestehen. Das ist keine Behauptung eines neu ausgeführten
   Live-LinuxCNC- oder vollständigen Kollisions-/Unterprogramm-End-to-End-Tests.

2. **P2 / Boxenmessung:** Materialbreite plus bloßes Vorhandensein beider Farben ist allein
   ein schwacher Wächter für die CSS-Pixel-Breite. Dafür muss aber die überlagerte Mockkante
   nicht beibehalten werden: Meine ergänzende Szene blendet andere Körper/Markierungen aus
   und misst eine isolierte vertikale Boxkante. In Hell und Dunkel, jeweils DPR 1 und 2,
   ergeben die aufgenommenen Pixelprofile **1,00 CSS-px Kern und 3,00 CSS-px Gesamtbreite**.
   Die Anpassung an Hintergrund/Kern/Saum mit Viertel-Pixel-Abdeckung hat höchstens 0,75
   RGB-Stufen Restfehler. Damit ist die Umsetzung hier bestätigt; die isolierte Szene eignet
   sich als dauerhafter Wächter. Gemeinsame Geometrie und Strichabstände für Kern/Saum sowie
   die Tiefenprüfung sind im Code vorhanden. Die geschmackliche Bewertung der Boxen in sehr
   dichten realen Programmen bleibt Teil der Operator-Sichtprüfung.
   Belege: [Profile](r31.box-profiles.json), [Auswertung](r31.box-widths.json),
   [Auswertungsskript](r31.box-analyse.py), vier `r31.box-dpr*.png`.

3. **P3 / neuer Payload desselben Programms:** Das Beenden ist vertretbar. Nach einer
   Neuberechnung können Track und Befundzuordnung andere sein; den alten temporären Bereich
   ohne erneute Zuordnung zu behalten wäre irreführend. Diese Grenze muss nicht auf bloße
   Einstellungsübernahmen ausgedehnt werden (VP-I01). Weiterhin aufräumen bei manuellem Scrub,
   Simulationsende, Payloadwechsel und neuer bewusster Ebenenwahl; ein neuer Befund ersetzt
   den bisherigen.

4. **HC-Dunkel 0,244:** Als ausdrücklich benannte Ausnahme der eigenen Such-/Regressionsregel
   tragbar. 0,25 war kein normativer Grenzwert. Die Kontrast- und CVD-Wächter bestehen; die
   Farbfamilien bleiben erhalten. Daraus folgt kein Beweis der Unterscheidbarkeit jeder kurzen
   oder überlagerten Linie. Optional die Ausnahme im Wächter auf HC-Dunkel begrenzen, damit
   HC-Hell mit seinen erreichten 0,277 nicht unnötig denselben niedrigeren Mindestwert erhält.

### Eigene Prüfung und Übergabe

- Archiv des geprüften HEAD unter `/tmp`, keine Produktänderungen im Palette-Worktree oder
  Live-Checkout. Build und Typecheck erfolgreich; **194/194** gezielte Unit-Tests in zehn
  Dateien erfolgreich (Palette/Tokens, Controller, Custom-Kontrast, Reveal, Viewer-Settings,
  Track/Text und Run-Watcher).
- Vorhandene Browserprüfungen `rapids.viewer.spec.ts` und `scenes.viewer.spec.ts`:
  **3/3 bestanden**, einschließlich vier Themes und DPR 1/2 sowie Grenzmarkierung über Backplot.
- Eigene Browserprüfungen: Boxprofil-Aufnahme erfolgreich; die vier obigen Sollverhalten
  reproduzierbar **rot**. Das sind zusätzliche Review-Sonden, kein Widerspruch zum gemeldeten
  Offline-Gate. Ein erster Entwurf der Mehr-Eilgang-Sonde enthielt einen ungeeigneten NaN-
  Trennpunkt und wurde beendet; er wird nicht als Produktbefund gewertet. Die abgelegte Sonde
  und ihre Ergebnisse verwenden ausschließlich endliche Koordinaten und aufsteigende Sequenzen.
- Ein eigener Mock auf `127.0.0.1:4188`, ein Browser zur Zeit, `nice -n 19`.
  Keine Aufrufe der Live-Ports `:8000`/`:5173` und keine Maschinenbefehle. Kein erneuter
  Backend- oder vollständiger Offline-Gesamtlauf.

Ausführung und Grenzen: [r31.README.md](r31.README.md).
Ergebnisse: [r31.tests.json](r31.tests.json), [Build](r31.build.txt),
[Unit-Tests](r31.vitest.txt), [Browserlauf](r31.playwright.txt),
[Zusatzlauf](r31.extra-playwright.txt). Frühere Reviews und Belege bleiben unverändert.

**Übergabe an Claude:** VP-I01 bis VP-I04 bearbeiten; danach Nachprüfung der Änderungen und
angrenzenden Fälle. Handshake R31 erhält `findings`. Für diese Korrekturen ist keine neue
Operatorentscheidung erforderlich.

---

## Umsetzung · Claude · Antwort auf R31 · 28. September 2026

Branch `feat/viewer-palette` (Worktree `/home/cnc/lcnc-suite-backlog`). Deine Evidenz R31
unverändert in `bd4320e`. Alle vier Befunde sind behoben, jeder Wächter lief vorher rot. Deine
Sonden sind nicht wörtlich übernommen, sondern in `rapids.viewer.spec.ts` und die Unit-Tests
übertragen (normaler Mock, keine Belegdateien).

| Befund | Commit | Korrektur | Wächter (rot vorher) |
|---|---|---|---|
| VP-I04 | `f3ccc30` | Die Box-Zeile trägt den Kern-auf-Saum-Vergleich als eigenen Wert (`onCasing`, `casingLow`); die Tabelle hat die Spalte „On its casing“ (eine Linie: —). Hintergrund und Tisch werden allein bewertet. | `customContrast.test`: Kern = Saum `#3a3f45` → Hintergrund und Tisch nicht „low“, Saum `1.0 : 1 · low` (rot: `[true, true]`). `viewer.spec` wählt den Saumton für Machine Bounds und liest die drei Zellen (rot auf dem alten Build). |
| VP-I01 | `1f42226` | `setLayerVisible` beendet die Befundansicht nur, wenn sich der Wert von Toolpath oder Rapids tatsächlich ändert. Eine echte Änderung eines anderen Clients beendet sie weiter; nichts wird zurückgeschrieben. | `rapids.viewer.spec`: Theme zweimal wechseln bei gleichem `rapids: false` → Hinweis und Eilgang bleiben (rot: Hinweis weg); danach beendet eine echte Änderung. |
| VP-I02 | `eedbcc8` | Die Zeile ist in der Karte **angeheftet**, außerhalb des scrollenden Körpers: Die Karte rendert auch nur für sie, die Faltung lässt sie stehen (`flex: none` unter der Spaltenkappe), und die Warnungszahl zählt sie nicht mehr. | `rapids.viewer.spec` „… is told“: HUD aus (rot: kein `[data-path-reveal]` im DOM) und gefaltet bei 150 % Hochformat (rot: hinter der Zusammenfassung; die Zahl liest jetzt 3 statt 4). |
| VP-I03 | `904d1ca` | `pathReveal` trägt den **Abschnitt** des Befunds: den Lauf seiner Bewegung um das angesprungene Segment (`lineRunAround`, wieder da: Zusammenhang benennt das Vorkommen, das ein Unterprogramm oder eine Schleife wiederholt), in Indizes des Basis-Tracks (der Eintrittstrack stellt Punkte voran). `toolpathController.setReveal` zeichnet die Paare der ausgeblendeten Ströme, deren Quell-Tracksegment (`feedSrc`/`rapidSrc`) im Lauf liegt, im eigenen Material des Stroms (gestrichelt, Stale-Grau); bei ganz ausgeschaltetem Toolpath auch die Grenzmarkierung des Laufs. Die gespeicherten Ebenen zeichnen wie gespeichert. Keine Auswahloptik. Der Part-Frame-Worker liefert jetzt auch `rapidSrc` (vorher nur `feedSrc`); ohne das hätte der gebackene Pfad (Standard „Path on part“) keinen Eilgang zuordnen können. | Controller-Unit-Test „a finding's section on a hidden layer“ (rot: kein `setReveal`). `rapids.viewer.spec` „a finding shows its own move“ in der Draufsicht: ein entfernter 90-mm-Eilgang entlang X, ein 71-mm-Eilgang entlang X (Zeile 13), der Befund ein 7-mm-Eilgang entlang Y (Zeile 14). Gezeigt sein muss eine kurze Linie entlang Y; die ganze Ebene zeigt die 90 mm, ein Versatz um eins die 71 mm (rot: `dy = 0`, die 90 mm). Dann Toolpath aus, Befund auf einem Vorschub: nur seine Bewegung, seine Markierung darauf, kein Eilgang. |

**Beim Bau von VP-I03 gefunden, im selben Commit behoben:** Ein Trackpunkt trägt die Zeile der
Bewegung, die dort **endet**. `lineCumOf` (der erste Punkt einer Zeile) ist also das Ende ihrer
ersten Bewegung. Ein Sprung zu einer Grenzverletzung landete deshalb in der Bewegung der
**nächsten** Zeile: Die Zeitleiste las „L8“ für einen Befund auf L7, und der Abschnitt wäre der
falsche gewesen. Außerdem hatte das Band einer einsegmentigen verletzenden Zeile die Länge null,
und eine Werkzeugwechsel-Marke saß eine Bewegung zu spät. `lineSpanCum(t, line)` gibt die
Ausdehnung einer Zeile ab dem **Beginn** ihrer ersten Bewegung. Sprungziele, Bänder und
Werkzeugmarken lesen sie. Wächter: `scrubTrack.test` „lineSpanCum“ (rot: keine Funktion) und im
Browser-Test die Anzeige „L7“ nach dem Sprung (vorher „L8“, im Dump gesehen).

**Deine Antwort 4, übernommen** (`26104be`): Die Untergrenze 0,24 gilt nur noch für HC-Dunkel,
HC-Hell hält 0,25. Eine Regel `palettePairs.lineMinFor(theme)` für Token-Test und Custom-Hinweis;
der Hinweis sagt „0.24 in dark high contrast“.

**Deine Antwort 2, übernommen** (`992e637`): deine isolierte Szene als dauerhafter Test in
`scenes.viewer.spec.ts`. Alles außer der Maschinen-Box ist aus; eine Kante ohne anderes innerhalb
von 8 CSS-px. Jedes Gerätepixel wird auf Hintergrund, Kern und Saum in Viertelschritten
angepasst: Kern 1 CSS-px, Kern mit Saum 3 CSS-px, Hell und Dunkel, DPR 1 und 2. Rot unter
`CASED_CORE_PX = 2` (liest 2) und `CASED_TOTAL_PX = 5` (liest 5). Die Materialprüfung der
Breiten-Szene bleibt daneben.

Doku: CLAUDE.md (`9eba106`), Checkliste (`90d5715`).

Offline-Gate (`python3 scripts/test_suite.py offline`) auf `90d5715`: PASS, Backend 1069,
Vitest 1722, Playwright 344/344. Danach kam nur der Boxkanten-Test dazu (`992e637`); das Projekt
`serial-viewer` lief damit einzeln 13/13 grün.

### Bitte prüfen

1. **VP-I03:** Ist „die Bewegung um das angesprungene Segment“ (gleiche Zeile, zusammenhängend)
   der richtige Abschnitt, auch für Kollisionen? Eine Kollision, die über mehrere Zeilen anhält,
   zeigt nur die Bewegung ihres Beginns.
2. **Befundziel:** Die Korrektur verschiebt Grenzmarken und Werkzeugmarken auf der Zeitleiste um
   eine Bewegung nach vorn. Siehst du einen Nutzer, der das alte Ende erwartet?
3. **VP-I02:** Die angeheftete Zeile steht in der aufgeklappten Karte jetzt unter den übrigen
   Zeilen statt dazwischen. Passt das?

---

## Review Codex · R32 · Nachprüfung R31 und Befundziele · 28. September 2026

**Stand:** `6b0ed67`, Branch `feat/viewer-palette`, Worktree
`/home/cnc/lcnc-suite-backlog`; Bereich `bd4320e..6b0ed67`.
**Ergebnis: findings.** VP-I01 bis VP-I04 sind geschlossen. Bei der ausdrücklich mit
übergebenen Befundnavigation bleiben zwei weitere P2-Fälle: der erste Sprung mit Anfahrweg
und die festen Toleranzen bei kurzen Bewegungen beziehungsweise nahen Befunden.

### Nachprüfung der R31-Befunde

| Befund | Ergebnis | Eigener Nachweis |
|---|---|---|
| VP-I01 | **Geschlossen.** Unveränderte Ebenenwerte erhalten die Befundansicht über den Theme-Wechsel; eine tatsächliche Änderung beendet sie. | R31-Sonde als Kopie erneut grün, außerdem aktueller Rapids-Test mit Hin-/Rückwechsel und echter Ebenenänderung. [Daten](r32.settings.json) |
| VP-I02 | **Geschlossen.** Der Hinweis ist unabhängig vom HUD vorhanden und bleibt bei gefalteter Karte sichtbar. | R31-Sonde HUD aus grün; zusätzlicher vorhandener Test im Hochformat bei 150 % grün, einschließlich Warnungszahl ohne den angehefteten Hinweis. [Daten](r32.hud-off.json) |
| VP-I03 | **Geschlossen für die Abschnittsbildung.** Ein korrekt angesprungenes Segment zeigt nur seine zusammenhängende Bewegung. Die entfernte 90-mm-Bewegung bleibt verborgen; bei Toolpath aus erscheinen Bewegung und zugehörige Grenzmarkierung. | R31-Mehr-Eilgang-Sonde sowie der neue strengere Browserwächter (Richtung und Länge, Vorschubfall) grün; Controller-/Track-/Part-Frame-Tests grün. `rapidSrc` wird im Worker übertragen und beim Anwenden übernommen. Die unten beschriebenen Fälle betreffen die Auswahl des Sprungziels davor. [Daten](r32.multirapids.json) |
| VP-I04 | **Geschlossen.** Gute Hintergrund-/Tischkontraste tragen kein „low“ mehr; der eigene Kern/Saum-Wert zeigt `1.0 : 1 · low`. | R31-Custom-Sonde grün, gezielter aktueller Settings-Palettentest liest alle drei Zellen erfolgreich; Unit-Test bestätigt die getrennten Bewertungen. [Daten](r32.custom.json) |

Die Ausnahme für den Linienabstand gilt jetzt nur für HC-Dunkel; die zwölf ausgewählten
Unit-Testdateien einschließlich Tokens und Custom-Prüfung bestehen. Der neue dauerhafte
Test der isolierten Boxkante besteht bei DPR 1/2 in Hell/Dunkel. Die vorhandenen
Überlagerungsszenen bestehen ebenfalls.

### VP-I05 · P2 · Der erste Befundsprung verwendet nach dem Simulationseintritt die alte Track-Position

**Reproduktion:** Frisch geladenes Programm, erster Programmpunkt X=0; die tatsächlichen
Achspositionen stehen bei X=-100. Der Befund L7 liegt nach der ersten 10-mm-Bewegung.
Toolpath und Rapids sind ausgeschaltet. Ein Klick auf „Next limit violation“ aktiviert die
Simulation und deren 100-mm-Anfahrweg.

**Ist:** Die Zeitleiste zeigt **„L1 →“**, der Playhead steht im Anfahrweg. Der angeforderte
Programmabschnitt und seine Grenzmarkierung bleiben verborgen; auch der Reveal-Hinweis fehlt.
Erst der zweite Klick landet auf **L7** und zeigt den richtigen Abschnitt. Die Kontrollprobe
mit identischer Ausgangslage am Programmbeginn (X=0, kein zusätzlicher Anfahrweg) trifft L7
schon beim ersten Klick.

**Ursache:** `violationTargets` berechnet `cum` auf dem aktuell angezeigten Track
(`ScrubBar.vue:695–708`). `jumpTo` erhält dieses Ziel, ruft danach `enterSim()` auf (`:816–817`),
welches einen Eintrittstrack voranstellt (`:306–315`), und setzt anschließend unverändert
`target.cum + 1e-3` (`:822`). Die Basis des Wertes hat sich damit geändert. Die spätere
Indexkorrektur für den Reveal (`:828–833`) kann nicht reparieren, dass bereits das falsche
Segment gesampelt wurde.

**Korrektur:** Den konkret gewählten Befund über den Trackwechsel hinweg erhalten und sein
Ziel auf dem tatsächlich angezeigten Track auflösen beziehungsweise mit dessen Eintrittsversatz
umrechnen. Nicht einfach nach dem Eintritt erneut „Next“ wählen: Das könnte einen anderen
Befund auswählen. Die Track-Zuordnung auch bei Kollisionszielen berücksichtigen; ein echter
Befund im Eintrittssegment darf nicht wie ein Programmbefund verschoben werden.

**Belege:** [r32.target-entry.json](r32.target-entry.json),
[Bild nach erstem Klick](r32.target-entry.png),
[Kontrolle ohne Anfahrweg](r32.target-zero-entry.json).
Alle vier Varianten stehen in [r32.targets.spec.ts](r32.targets.spec.ts).
Der Standard-Mock liefert in den bisherigen Rapids-Tests keine `joint_pos`; damit entsteht
dort kein solcher Eintrittstrack. Die neue Sonde setzt diese Zustandsdaten ausdrücklich.

### VP-I06 · P2 · Feste Sprung- und Navigationstoleranzen überspringen kurze Befunde

Die Zeitachse verwendet Sekunden. Die beiden Konstanten `1e-3` beim Sprung und `NAV_EPS=0.01`
bei Vor/Zurück sind deshalb eine Millisekunde beziehungsweise zehn Millisekunden. Sie dürfen
nicht entscheiden, ob eine reale Bewegung oder ein eigener Befund überhaupt erreichbar ist.

**Zwei reproduzierte Fälle:**

- **Kurze verletzende Bewegung:** L7 läuft von 1,0000 bis etwa 1,0001 s und bewegt sich
  0,01 mm entlang Y. Ein Sprung auf ihren Anfang plus 0,001 s landet bereits in **L8**.
  Bei Toolpath aus erscheint dessen unauffällige 10-mm-X-Bewegung als „Toolpath shown for
  this finding“, während die eigentliche Grenzmarkierung fehlt. Auch ein zweiter Klick
  landet wieder auf L8. Der Zeilenversatz ist für diesen Fall also noch vorhanden.
- **Nahe aufeinanderfolgende Befunde:** L7 beginnt bei 1,000 s, L8 bei 1,005 s. Nach dem
  ersten Sprung auf L7 sucht `targetAfter` erst jenseits von ungefähr 1,011 s, überspringt
  L8 und fällt auf L7 zurück. Der nächste eigenständige Befund bleibt mit „Next“ unerreichbar.

**Stellen:** `ScrubBar.vue:693`, `:801–808` und `:819–823`. Die neue `lineSpanCum` liefert
in diesen Fällen den richtigen Anfang; verloren geht die Zuordnung erst beim Sprung oder
bei der Auswahl des nächsten Ziels. Die Befundansicht wird aus diesem falschen Sample
gebildet und macht den Fehler nun auch als falschen sichtbaren Abschnitt deutlich.

**Korrektur:** Das Sample an den gewählten Segment-/Kontaktbereich binden. Falls ein Versatz
vom Rand nötig ist, muss er innerhalb dieses Bereichs liegen. Die Vor-/Zurück-Navigation
soll den bereits ausgewählten Befund anhand seiner Identität überspringen, ohne weitere
Befunde in einem festen Zeit-/Abstandsfenster zu verwerfen. Bei manuellem Scrub weiterhin
relativ zur aktuellen Position navigieren. Zeit- und Distanzachse sowie Vor/Zurück absichern;
auch kurze Kontaktintervalle dürfen nicht durch den Versatz verloren gehen.

**Belege:** [kurze Bewegung](r32.target-short-time.json),
[deren Bild](r32.target-short-time.png), [nahe Ziele](r32.target-close-targets.json),
[r32.targets.spec.ts](r32.targets.spec.ts). Die Zeitwerte werden entsprechend dem Gateway
als Float32-Binärfeld `feed_tcum` übertragen; die Sonde bestätigt eine Zeitachse von 2 s.

**Einordnung beider neuer Befunde:** Die fehlende Umrechnung beim Simulationseintritt und
die festen Toleranzen standen bereits vor dieser Korrekturrunde im Sprungpfad. Ich werte sie
nicht als neu eingeführte Regressionen. Sie sind offene Fälle des hier ausdrücklich
mitgeprüften Zeilenversatzes und verhindern, dass die neue gezielte Befundansicht zuverlässig
den gewählten Befund zeigt.

### Antworten auf die drei Fragen

1. **Abschnitt einer Kollision:** Die zusammenhängende Bewegung um den tatsächlich
   angesprungenen Kontakt ist als lokaler Kontext passend. Für eine Kollision über mehrere
   Zeilen muss nicht die gesamte verdeckte Bahn eingeschaltet werden. Der Sprung zeigt den
   Erstkontakt; fortdauernder Kontakt bleibt Sache der bestehenden Band-/Code-Markierungen
   und Kollisionsfärbung. Die Einblendung nicht als vollständige Ausdehnung der Kollision
   bezeichnen. Die Begrenzung nach Track-Vorkommen statt nur Quellzeilennummer ist richtig.
   Voraussetzung ist das korrekte Sprungziel, insbesondere VP-I05/06.

2. **Grenz- und Werkzeugmarken:** Der Anfang der Bewegung ist bei der vorliegenden
   Endpunktzuordnung die richtige Grenze. Für M6/M600/M601 ohne eigene Bewegung ist der
   Beginn der nächsten Bewegung passender als deren Ende. In der Verbrauchersuche gibt es
   keinen weiteren produktiven `lineCumOf`-Nutzer, der das alte Ende voraussetzt; die drei
   Umstellungen sind Ziele, Grenzbänder und Werkzeugmarken in `ScrubBar`. Die Tests für
   `lineSpanCum` und der L7-Szenenfall bestehen. Ein neuer kompletter Werkzeugwechsel- oder
   Kollisionslauf auf LinuxCNC war nicht Teil dieser Nachprüfung.

3. **Angehefteter Hinweis unter den übrigen Zeilen:** Ja. Er steht dort direkt über der
   Befundnavigation, bleibt beim Falten sichtbar und wird nicht als zusätzliche Warnung
   gezählt. Das ist im geprüften Desktop und 150-%-Hochformat verständlich; die vorhandene
   Begrenzung der unteren Spalte bleibt bestehen.

### Prüfung, Belege und Übergabe

- Typecheck und Produktionsbuild erfolgreich.
- **235/235 Unit-Tests** in zwölf gezielt gewählten Dateien erfolgreich.
- **12/12 Browserprüfungen** aus R31-Gegenproben als Kopien, aktuellen Rapids-Tests und
  Viewer-Szenen erfolgreich. Dazu **1/1** gezielter aktueller Settings-Palettentest grün.
- Zusätzliche Zielsuite: **1 Kontrolle grün, 3 Reproduktionen rot** (Eintrittstrack,
  kurze Bewegung, nahe Folgebefunde). Zusammen belegen sie VP-I05/06. Die roten Prüfungen
  formulieren das gewünschte Verhalten; ihre Rohdaten werden vor der Assertion gespeichert.

Details und Wiederholung: [r32.README.md](r32.README.md).
[Ergebnisübersicht](r32.tests.json), [Build](r32.build.txt), [Unit-Lauf](r32.vitest.txt),
[Browserlauf](r32.playwright.txt), [Settings-Test](r32.palette-playwright.txt),
[Zielsuite](r32.targets-playwright.txt).

Geprüft wurde eine HEAD-Kopie unter `/tmp` mit eigenem Mock auf `127.0.0.1:4188`,
`nice -n 19` und einem Browser zur Zeit. Mock nach Abschluss beendet. Kein Zugriff auf die
Live-Ports `:8000`/`:5173`, keine Maschinenbefehle, keine Produktänderungen und kein eigener
Backend-/Offline-Gesamtlauf. Im Palette-Worktree nur dieser Anhang und neue `r32.*`-Belege;
frühere Reviewtexte und Belege unverändert.

**Übergabe:** R31-Punkte geschlossen, VP-I05 und VP-I06 offen. R32 erhält `findings`;
keine neue Operatorentscheidung erforderlich.

---

## Umsetzung · Claude · Antwort auf R32 · 28. September 2026

Branch `feat/viewer-palette` (Worktree `/home/cnc/lcnc-suite-backlog`). Deine Evidenz R32
unverändert in `a305a35`. VP-I05 und VP-I06 sind behoben (`8487dea`, ein Commit, weil beide
im selben Sprungpfad liegen). Deine Zielsonden sind in `e2e/findings.viewer.spec.ts`
übertragen (normaler Mock, keine Belegdateien).

**Neues reines Modul `viewer/findingNav.ts`:**

- **Wo ein Sprung sampelt:** `sampleCum` liegt innerhalb der Ausdehnung des Befunds, ein Stück
  hinter dem Anfang (höchstens `1e-3`) und nie über die Mitte hinaus.
  - Grenzziele: `scrubTrack.lineFirstMoveCum`, die erste Bewegung der Zeile mit Ausdehnung
    (Relabel und Nullbewegungen übersprungen).
  - Kollisionsziele: ihr Kontaktintervall (`clashTargets` trägt jetzt `cumEnd` und `key`).
- **Vor/Zurück ohne festes Fenster:**
  - Der gerade gezeigte Befund wird über seinen Schlüssel übersprungen, solange die Zeitleiste
    noch an der Sprungstelle steht (`NavSelection {key, pos}`).
  - Sonst entscheidet, wo ein Sprung landen würde.
  - Zwei Befunde an derselben Stelle erreicht man beide; am Ende wird umgebrochen.
  - Nach Scrub, Wiedergabe oder Lauf geht es wieder von der Position aus.
  - `NAV_EPS` ist entfernt, auch im Werkzeug-Countdown.
- **Sim-Eintritt (VP-I05):** `jumpTo` merkt sich den Track vor `enterSim()` und löst den
  **gewählten** Befund danach auf dem angezeigten Track auf.
  - Hat die neue Liste den Befund schon, wird er über den Schlüssel gefunden.
  - Sonst übersetzt `mapAcrossEntry` ihn: Ein Programmbefund verschiebt sich um die Länge des
    Eintrittswegs. Ein Befund **auf** dem Eintrittsweg bleibt dort und wird mit ihm skaliert.
  - Es wird nie erneut „Next“ gewählt.

**Wächter:**

- `findingNav.test`: Sampling, Identität, Umbruch, Position nach Scrub, Eintrittsabbildung.
  Rot vorher: Modul fehlt.
- `scrubTrack.test` „lineFirstMoveCum“. Rot vorher: Funktion fehlt.
- `clashTargets.test`: Ende und Schlüssel.
- `findings.viewer.spec` mit Toolpath aus, damit nur der Abschnitt des Befunds gezeichnet wird;
  L7 läuft entlang Y, die Nachbarn entlang X:
  - Kontrolle ohne Anfahrweg;
  - Anfahrweg 100 mm;
  - 0,1-ms-Bewegung auf der Zeitachse;
  - zwei Befunde 5 ms auseinander, mit Next und Previous.
  - Auf dem alten `ScrubBar` genau deine drei roten Fälle („L1 →“, „L8“, „L7“), die Kontrolle
    grün.

**Kollisionsziele auf dem echten Modell** (`8f9b50c`, auf Anregung des Operators):
`e2e/collisions.viewer.spec.ts` lädt `machine.json` und STLs der XYZAC-Config
(`examples/sim_config/machine-5axis-xyzac`). Der Sweep läuft im Browser gegen die echten Körper.
L7 fährt die Spindelnase bei Z −380 seitlich in die A-Wiege: innerhalb der Softlimits, in Ruhe-
und Startpose frei. Die Maschine steht bei X −100, der erste Sprung baut also den Eintrittsweg.
Der erste Klick auf „Next collision“ landet auf L7; bei ausgeschaltetem Toolpath zeigt er dessen
Bewegung entlang X. Rot mit dem alten `ScrubBar`: „L6“, 100 mm zu früh.

**Live auf der XYZAC-Sim** (Branch in `~/lcnc-suite`, echtes Gateway, keine Testdatei).
Programm `~/linuxcnc/nc_files/xyzac_collision_check.ngc`: dieselbe Kollision, G54 Z −220 der Sim
eingerechnet, G49.

- **Ablauf:** Scharfschalten, E-Stop-Reset, Einschalten, Referenzieren (LinuxCNC öffnet ein
  Programm nur referenziert), laden, Ausschalten.
- **Ergebnis:** Der echte Sweep meldet „2 collisions → L8 … through L10“. Der erste Klick landet
  trotz Eintrittsweg von 100 mm auf **L8**. Nach 3 s sind A-Wiege und Trunnions in der
  Kollisionsfarbe getönt.
- **Beobachtung, nicht geändert:** 300 ms nach dem Sprung fehlt die Tönung noch. Sie liest das
  Ergebnis des angezeigten (Eintritts-)Tracks, und das kommt erst mit dem Seiten-Sweep des
  Eintrittswegs. Das Verhalten bestand schon vorher. Soll die Tönung bis dahin aus dem
  Basisergebnis kommen?
- **Nebenbefund zum Ablauf, kein Produktfehler:** Ein Skript als einziger Client, das nach einem
  E-Stop-Reset trennt, lässt den HAL-Watchdog verriegeln. Der Herzschlag fließt nur mit
  verbundenen Clients, so ist es gebaut. Die Trips wurden nicht quittiert, die Sim wurde neu
  gestartet; Bündel unter `runlogs/trips/`. Für die weiteren Läufe hielt ein zweiter, nicht
  scharfer Browser die Verbindung.

Doku: CLAUDE.md (`ce0d048`).

Offline-Gate (`python3 scripts/test_suite.py offline`) auf `ce0d048`: PASS, Backend 1069,
Vitest 1728, Playwright 349/349. Danach kam nur `collisions.viewer.spec.ts` dazu (`8f9b50c`); das
Projekt `serial-viewer` lief damit 18/18.

**Arbeitsort für R33:** `feat/viewer-palette` ist jetzt in `~/lcnc-suite` ausgecheckt, und dort
läuft die Live-Sim für die Sichtprüfung des Operators. Der Worktree `~/lcnc-suite-backlog` steht
abgekoppelt auf `8f9b50c`.

### Bitte prüfen

1. **Schlüssel einer Kollision:** `C<line>|<a>|<b>|<interval>`. Ändert sich die Liste nach dem
   Eintritt (Eintrittsergebnis kommt dazu), bleibt der Schlüssel eines Programmbefunds gleich.
   Siehst du einen Fall, in dem zwei verschiedene Befunde denselben Schlüssel tragen?
2. **Identität nur an der Sprungstelle:** Der Vergleich `navSel.pos === sPos` ist exakt. Die
   Schreibpfade von `sPos` sind: Sim-Eintritt (0), Programmwechsel (0), Wiedergabe, Lauf-Playhead,
   Slider (manueller Scrub) und der Sprung selbst. Alle außer dem Sprung sollen die Identität
   beenden. Übersehe ich einen?

---

## Umsetzung · Codex · Nachprüfung R33 · 28. September 2026

Geprüft: `a305a35..b99b56c` auf `feat/viewer-palette`, als isolierte Archivkopie von
`b99b56c03c07288e863e3b114b9d5133068321d7`. **Ergebnis: findings.** Die bisherigen vier
R32-Zielsonden und Claudes neue XYZAC-Kollisionsszene bestehen. VP-I06 ist für die kurzen
und dicht aufeinanderfolgenden Befunde behoben. VP-I05 hat noch einen Fall mit einer
mehrfach vorkommenden ersten Quellzeile; hinzu kommen zwei Fehler der neuen Auswahlidentität.
Keine Operatorentscheidung erforderlich.

### VP-I05 · P2 · Rest: Die erste Quellzeile kann das Grenzziel auf den Anfahrweg ziehen

**Reproduktion:** Die Vorschau beginnt mit den Punkten `(0,0,0)`, `(0,10,0)`, `(10,10,0)`
und den Zeilen `[7,7,8]`. L7 verletzt das Y-Limit. Die Maschine steht bei `(-100,0,0)`;
beim ersten Sprung kommt der 100-mm-Anfahrweg hinzu. Wiederholte Quellzeilen sind ein
zulässiger Fall, beispielsweise bei einer in Segmente zerlegten Bewegung oder wiederholter
Ausführung. Der Gateway überträgt die Zeile je Bewegungsendpunkt
(`lcnc-gateway/gcode_parse_worker.py:630–644`).

Vor dem Simulationseintritt ist das L7-Ziel die Programmbewegung von 0 bis 10 mm auf der
Basisachse. Danach liefert `lineFirstMoveCum` für L7 bereits den **Anfahrweg von 0 bis
100 mm**. `jumpTo` findet denselben Schlüssel `L7` in der neuen Liste und übernimmt dieses
falsche Ziel, statt das ursprüngliche auf 100 bis 110 mm zu verschieben. Tatsächlich landet
das Sample bei 0,001 mm; der native Regler rundet seine Anzeige auf 0. Die Zeilenanzeige
lautet `L7 →` (Eilgang), und der Hinweis behauptet „Toolpath and rapids shown …“.
Die richtige Programmbewegung wird zwar als Teil des gleich benannten Abschnitts mit
gezeichnet, die simulierte Maschine steht aber noch am Anfang des Anfahrwegs. Auch der
zweite Klick korrigiert das nicht.

**Ursache/Stellen:** `scrubTrack.ts:922` übernimmt die erste Programmzeile für den Endpunkt
des Eintrittssegments; `lineFirstMoveCum` (`:824–831`) berücksichtigt diesen Endpunkt als
erste Bewegung der Zeile. `ScrubBar.vue:711–712` und `:830–832` behandeln das daraus
gewonnene Ziel als denselben Programmbefund. Eine passende Zeilennummer allein beweist
hier keine passende Bewegung.

**Korrektur:** Grenzziele an die Bewegung auf dem Basistrack binden und bei Eintritt in
den angezeigten Track umrechnen. Der hinzugefügte Anfahrweg darf nicht aufgrund seiner
Endpunkt-Zeilennummer zum ursprünglichen Programmbefund werden. Absichern: erste Quellzeile
mit mehreren Punkten, erster und zweiter Sprung, tatsächliche Position innerhalb der
Programmbewegung und deren Bewegungsart. Die vorhandenen vier R32-Fälle weiter behalten.

**Belege:** [Sonde](r33.limit-origin.spec.ts), [Messwerte](r33.limit-origin-entry.json),
[Bild](r33.limit-origin-entry.png), [roter Lauf](r33.limit-playwright.txt).

### VP-I07 · P2 · Eintritts- und Programmkollisionen erhalten denselben Navigationsschlüssel

Damit ist Rückfrage 1 beantwortet: **Ja, es gibt einen konkreten Gegenfall.** Der
Intervallindex wird je Treffer neu bei 0 begonnen. Eintritts- und Basis-Sweep sind getrennte
Prüfungen, können aber dieselbe Quellzeile und dasselbe Körperpaar melden. Beim Zusammenführen
bleiben sie eigenständige Befunde, sofern der Kontakt dazwischen unterbrochen war.

Die zusätzliche Browser-Sonde lädt das echte XYZAC-`machine.json` samt STLs. Der reguläre
Worker berechnet sowohl Eintritt als auch Programm; die Sonde beobachtet seine Antworten,
ohne Ergebnisse zu ersetzen. Die Mock-Pose ist `(300,0,-380)`, der Anfahrweg endet bei
`(0,0,-380)`, das Programm fährt zurück nach `(240,0,-380)` und hebt danach Z an.
Seine Punktzeilen sind `[7,7,8]`. Die anfängliche Pose hat in dieser gezielten Probe bereits
Kontakte; der Anfahrweg verlässt sie, das Programm tritt später erneut ein.

**Ergebnis:** neun getrennte Navigationsziele, aber nur sieben verschiedene Schlüssel:

| Schlüssel | Eintritt: Kontaktbeginn | Programm: Kontaktbeginn auf der Gesamtachse |
| --- | ---: | ---: |
| `C7\|spindle_nose\|a_yoke_casting\|0` | 0 mm | 425,000488 mm |
| `C7\|tool\|a_yoke_casting\|0` | 0 mm | 532,000122 mm |

Nach dem ersten Sprung zum Programmkontakt hält `selectedIndex` nun den früheren
Eintrittskontakt mit gleichem Schlüssel für ausgewählt. Wiederholtes „Next collision“
läuft in einer Teilfolge aus Eintrittskontakten und dem ersten Programmkontakt im Kreis.
Der spätere Werkzeugkontakt bei 532 mm bleibt dabei unerreichbar. Die aufgezeichneten
Reglerwerte sind auf dessen native Schrittweite gerundet; die exakten Kontaktwerte stehen
in den Worker-Ergebnissen.

**Stellen:** Schlüsselbildung `viewer/clashTargets.ts:32–35`, Auswahl per erstem Treffer
`viewer/findingNav.ts:31–40`; außerdem verwendet `ScrubBar.vue:831` denselben Schlüssel
bei der Auflösung über einen Trackwechsel. `mergeEntryResult` verschiebt die Basiswerte,
trennt aber keine Identitäten. Die Annahme „Eintritt hat immer Zeile 0“ hilft im aktuellen
Code nicht: nur der neu vorangestellte Startpunkt hat 0; der Endpunkt trägt L7 und bestimmt
die Zeile des Eintritts-Sweeps.

**Korrektur:** Die Herkunft Eintritt/Programm und das jeweilige Kontaktintervall eindeutig
benennen. Programmschlüssel müssen beim Hinzufügen des Eintrittsergebnisses stabil bleiben;
ein Index in der nachträglich sortierten Gesamtliste oder der verschobene `cum` allein
leistet das nicht. Prüfen, dass Vor/Zurück alle getrennten Ziele erreicht und eine gewählte
Programmkollision auch nach Ankunft des Seitenergebnisses dieselbe bleibt.

**Belege:** [Sonde](r33.collision-key.spec.ts),
[unveränderte Worker-Ergebnisse, Zielschlüssel und Klickfolge](r33.collision-key.json),
[Bild](r33.collision-key.png), [roter Lauf](r33.collision-playwright.txt).

### VP-I08 · P2 · Manuelles Weg- und Zurückbewegen reaktiviert die alte Auswahl

Zu Rückfrage 2: Der exakte Vergleich beendet die Identität **nicht dauerhaft**. `navSel`
wird nur durch einen weiteren Befundsprung ersetzt; weder `onScrubInput` noch die übrigen
Positionsschreiber löschen sie. Sobald die Position wieder exakt `navSel.pos` erreicht,
gilt die alte Auswahl erneut. Das ist kein Rundungsproblem und braucht keine Epsilon-Lösung.

**Browser-Reproduktion mit demselben echten Modell:** Zeitachse von 2 s, native Schrittweite
0,001 s. „Next“ wählt einen Eintrittskontakt bei 0,001 s. Am unveränderten Regler drücke ich
`ArrowRight` und `ArrowLeft`: 0,001 → 0,002 → 0,001 s. Nach der manuellen Bewegung soll die
Navigation von der aktuellen Position ausgehen; der nächste spätere Kontakt beginnt bei
1,260418 s, das Sprungsample wäre 1,261418 s. Tatsächlich springt „Next“ zu einem weiteren
Kontakt am alten Anfang und bleibt bei **0,001 s**. Der ausgewählte Ausgangsschlüssel ist
in dieser Probe eindeutig; dieser Fehler ist damit unabhängig von VP-I07.

**Stellen:** `ScrubBar.vue:447–452`, `:699`, `:838` und
`viewer/findingNav.ts:31–32`. Die vorhandene Unit-Probe für manuellen Scrub prüft nur eine
abweichende Position, nicht das Zurückkehren zur früheren Sprungposition.

**Korrektur:** Auswahl bei manueller Eingabe und den anderen ausdrücklich genannten
Wechseln der Positionssteuerung aktiv verwerfen; nur der Befundsprung setzt sie neu.
Programm-/Basiswechsel ebenfalls als neue Bindung behandeln. Das nachträgliche Hinzufügen
des Eintrittsergebnisses darf dagegen die noch gültige gewählte Programmkollision nicht
verlieren. Neben Weg/Zurück auch Wiedergabestart und Wechsel des Programms absichern.

**Belege:** [Sonde mit nativen Pfeiltasten](r33.selection-reset.spec.ts),
[Positions- und Zielmessung](r33.selection-reset.json), [Bild](r33.selection-reset.png),
[roter Lauf](r33.selection-playwright.txt).

### Kollisionsszene, Live-Nachweis und vorübergehend fehlende Tönung

Claudes neue `collisions.viewer.spec.ts` besteht mit dem echten XYZAC-Modell. Sie prüft den
ersten Sprung über den Eintrittsweg, L7 und dessen eingeblendete X-Bewegung sinnvoll. Für
mehrere Kontakte und die Lebensdauer der neuen Identität fehlen bislang die oben gezeigten
Fälle. Ein vollständiger LinuxCNC-Lauf oder eine erneute Live-Sichtprüfung wurde von mir
entsprechend der Arbeitsgrenze nicht durchgeführt; die Live-Angaben bleiben Claudes Nachweis.

Zur zusätzlichen Tönungsfrage: **Ja, das weiterhin gültige Basisergebnis sollte im
Programmteil bereits nutzbar sein.** Die aktuelle Wartegrenze ist im Code nachvollziehbar:
`ThreeViewer.vue:2429–2441` liefert für den Eintrittstrack erst nach beiden Ergebnissen ein
Resultat. Ein begrenzter Folgepunkt wäre, für Positionen im Programmteil dessen Sample um
die Eintrittslänge zurückzurechnen und nur das exakt dazugehörige, noch gültige Basisresultat
zur Tönung heranzuziehen. Der noch ungeprüfte Eintritt bleibt ausdrücklich ausstehend;
keine Freigabe-/„clear“-Aussage über die Gesamtroute und kein beliebiges altes Ergebnis
als Ersatz. Das ist eine Verbesserung des bereits bestehenden Zwischenzustands, kein
zusätzlicher Blocker dieser Navigationskorrektur.

### Prüfung und Übergabe

- Typecheck und Produktionsbuild erfolgreich.
- **185/185 Unit-Tests** aus neun gezielten Dateien erfolgreich.
- **13/13 Browserprüfungen** erfolgreich: vier R32-Zielsonden als Kopien, vier aktuelle
  Grenzbefundtests, vier Rapids-Tests und Claudes echter XYZAC-Kollisionstest.
- **Drei zusätzliche Browser-Sonden rot**, jeweils mit gespeicherten Daten vor der
  fehlschlagenden Assertion: VP-I05-Rest, VP-I07, VP-I08. Sie verlangen das gewünschte Verhalten.

[Wiederholung und Grenzen](r33.README.md), [Ergebnisübersicht](r33.tests.json),
[Build](r33.build.txt), [Unit-Lauf](r33.vitest.txt), [grüner Browserlauf](r33.playwright.txt).
Alle Ausführungen in `/tmp/codex-r33-iw8tie70`, mit `nice -n 19`, einem Browser zur Zeit
und eigenem Mock `127.0.0.1:4188`. Mock danach beendet. Keine Zugriffe auf `:5173`/`:8000`,
keine Maschinenbefehle und kein eigener vollständiger Offline-/Backend-Lauf. Im Live-Checkout
nur dieser Anhang, neue `r33.*`-Belege und die vereinbarte Handshake-Rückmeldung; Produktcode
und frühere Belege unverändert.

**Übergabe:** VP-I06 geschlossen; VP-I05-Rest, VP-I07 und VP-I08 offen. R33 erhält `findings`.

---

## Umsetzung · Claude · Antwort auf R33 · 28. September 2026

Branch `feat/viewer-palette` (in `~/lcnc-suite`). Deine Evidenz R33 unverändert in `c9c0922`.
VP-I05-Rest, VP-I07 und VP-I08 sind behoben (`cd8cf56`). Beim Übertragen deiner Grenzsonde fand
der neue Wächter einen vierten Fehler, im Regler selbst (`d8e6106`, eigener Commit).

**VP-I05-Rest: Grenzziele vom Basistrack**

- `lineFirstMoveCum(t, line, on)` und `lineSpanCum(t, line, on)` bekommen einen dritten
  Parameter: Die Bewegung wird auf `t` gesucht (dem Basistrack) und auf `on` gelesen (dem
  angezeigten Track).
- Gelesen wird über den Punktindex in den eigenen Cums des angezeigten Tracks (Versatz
  `on.count − t.count`), nie als Basis-Cum plus Float-Verschiebung. So bleibt der Fehler auch
  bei langen Programmen mit Float32-Cums unter dem Nudge. Ist `on` kürzer als `t`, ist das
  Ergebnis `null`.
- `violationTargets` und die Grenzbänder nutzen das. Der Eintrittsweg wird damit nie mehr das
  Ziel der ersten Zeile, nur weil er an deren erstem Punkt endet.
- **Werkzeugwechsel-Marken bleiben bewusst auf dem angezeigten Track:** Ein M6 vor der ersten
  Bewegung läuft vor dem Eintrittsweg, seine Marke gehört an dessen Anfang.

**VP-I07: Herkunft im Schlüssel**

- `mergeEntryResult` markiert die Records des Eintritts-Sweeps mit `entry: true` (neues
  optionales Feld in `CollisionHit`).
- `clashTargets` bildet daraus `E<line>|<a>|<b>|<k>` statt `C…`; `ClashTarget.entry` trägt die
  Herkunft weiter.
- Programmschlüssel sind unverändert und bleiben beim Hinzufügen des Eintrittsergebnisses
  gleich, weil die Zusammenführung Programm-Records nur verschiebt.
- Die Zielanzeige liest für Eintrittskontakte „→ entry“ statt „→ L7“. Vorher lasen deine sieben
  Eintrittskontakte und der Programmkontakt gleich.

**VP-I08: Lebensdauer der Auswahl**

- Ein synchroner Watcher auf der Position beendet die Auswahl, sobald die Zeitleiste die
  Sprungstelle verlässt, endgültig. Die Rückkehr auf denselben Wert ist dann eine Position,
  kein Befund.
- Ein synchroner Watcher auf dem angezeigten Track beendet sie bei jeder neuen Bindung:
  Sim-Eintritt, neu gebauter Eintrittsweg, anderes Programm.
- Ausdrücklich beendet wird sie außerdem bei manueller Eingabe am Regler und beim Start der
  Wiedergabe.
- Der Sprung setzt seine Auswahl erst nach dem Eintritt, den er selbst auslöst.
- Das Eintreffen des Eintrittsergebnisses ändert weder Position noch Track und lässt die
  Auswahl stehen.

**Neu gefunden: Der Regler klemmte einen Wert auf das alte Ende**

- **Befund:** Deine Grenzsonde als Test landete richtig (L7, Vorschub), der Regler zeigte aber
  19,98 von 120.
- **Ursache:** `MachineSlider` nutzte `v-model`. Das schreibt den Wert in `beforeUpdate`, also
  bevor der Render `min`/`max`/`step` setzt. Der Range-Input klemmte 100,001 auf das alte Maximum
  20 und quantisierte ihn danach auf den neuen Schritt.
- **Wann:** beim ersten Sprung, wenn das Ziel hinter dem alten Ende der Zeitleiste liegt. Pose,
  Zeilenanzeige und Bänder waren richtig, nur der Knopf stand falsch.
- **Korrektur:** `:value` gebunden (Vue setzt `value` nach allen anderen Props), Modell über
  `input`. Das Verhalten der übrigen 13 Regler ist gleich.

**Wächter, jeweils rot mit den alten Quellen:**

- Unit `scrubTrack.test` „a line's move and extent found on the base, read on the entry track“.
  Rot: `[0, 10]` statt `[100, 110]`.
- Unit `clashTargets.test` „the entry move's contacts are named apart …“ mit deinen Paaren aus
  der XYZAC-Sonde. Rot: vier Befunde, zwei Namen.
- e2e `findings.viewer.spec` „a limit on a first line of two points …“ (deine Sonde): erster
  und zweiter Sprung, L7 ohne Eilgangmarke, Regler in (100, 110), Hinweis nur „Toolpath shown“,
  Bewegung entlang Y samt Grenzmarke.
  - Rot mit altem `ScrubBar`: „L7 →“.
  - Rot mit altem `MachineSlider`: 19,98.
- e2e `collisions.viewer.spec` mit dem echten XYZAC-Modell (deine Pose X 300):
  - **VP-I07:** Der erste Sprung wählt den Programmkontakt der Spindelnase. Er bleibt nach
    Ankunft des Eintrittsergebnisses stehen. „Next“ führt zum späteren Werkzeugkontakt, und eine
    volle Runde erreicht jeden Kontakt genau einmal. Rot: „Next“ landet bei 0.
  - **VP-I08:** deine Sonde mit nativen Pfeiltasten. Rot: 0.001.
- Deine vier R32-Fälle und der bisherige XYZAC-Test bleiben grün.
- „Next collision“ erscheint schon mit dem Zwischenergebnis des laufenden Sweeps
  („… so far“). Die beiden neuen XYZAC-Tests warten deshalb, bis der Sweep fertig ist, und
  zählen erst dann. Eine erste Fassung las einmal „1“ statt „2“. Danach dreimal 3/3 grün, der
  Rot-Nachweis mit der fertigen Fassung wiederholt.

**Nicht in dieser Runde: Tönung aus dem Basisergebnis.** Deiner Antwort folgend ist das ein
begrenzter Folgepunkt, kein Blocker. Er bleibt mit deinen Grenzen notiert:
- Nur Positionen im Programmteil.
- Nur das exakt zugehörige, noch gültige Basisergebnis.
- Der Eintrittsweg bleibt ausstehend.
- Keine Aussage „clear“ über die Gesamtroute.

Doku: CLAUDE.md (`daa988b`), mit einer Lesson zum Range-Input.

Offline-Gate (`python3 scripts/test_suite.py offline --timeout 2400`) auf `daa988b`: PASS, Backend 1069, Vitest 1730, Playwright 353/353 (Browser-Schritt 2089 s).

- Der erste Gate-Lauf wurde im Browser-Schritt nach dem Standardlimit von 1800 s abgebrochen,
  ohne roten Test. Der unterbrochene Test lief erst 4,6 s.
- Die VM wurde währenddessen mehrmals angehalten: Uhrsprünge von 90, 15, 9 und 15 Minuten im
  Trace, vermutlich der Ruhezustand des Macs.
- Der Browserlauf brauchte zuletzt 1500–1650 s, der grüne Lauf hier 2089 s. Das Standardlimit
  reicht nicht mehr sicher.
  Den Runner habe ich nicht geändert, nur den vorhandenen Schalter benutzt.

**Arbeitsort für R34:** wie in R33. In `~/lcnc-suite` läuft die Live-Sim für die Sichtprüfung
des Operators (Vite lädt Quelländerungen dort sofort).
- Dort bitte nur an die Review-Datei anhängen und neue `r34.*`-Belege ablegen.
- Keine Builds, Tests oder Checkouts in `~/lcnc-suite`, keine Zugriffe auf `:5173`/`:8000`,
  keine Maschinenbefehle.
- Stattdessen eine Archivkopie des Heads nutzen, mit eigenem Mock auf einem freien Port. Der
  abgekoppelte Worktree `~/lcnc-suite-backlog` steht noch auf `b99b56c`.

### Bitte prüfen

1. **Zusammengeführter Kontakt:** Ein Programmkontakt, der mit einem Eintrittskontakt
   zusammengefasst wird (Kontakt am Ende des Eintrittswegs noch offen), wird zur Fortsetzung und
   verschwindet als eigenes Ziel. Das ist gewollt: Es ist derselbe Kontakt, sein Beginn liegt im
   Eintrittsweg.
   - War er gewählt, geht die Navigation danach von der Position aus; sie steht noch in diesem
     Kontakt, „Next“ führt also zum nächsten späteren Befund.
   - Ich halte das für richtig und will die Auswahl nicht auf den Eintrittsbefund umhängen. Sein
     Beginn liegt vor der Position, ein Umhängen würde „Previous“ verschieben.
   - Einverstanden?
2. **`MachineSlider`:** Der Wert wird jetzt bei jedem Render gesetzt, wenn der DOM-String
   abweicht. Siehst du für Jog-Geschwindigkeit, Overrides oder den Scrub beim Ziehen auf Touch
   einen Nachteil gegenüber `v-model`?

---

## Umsetzung · Codex · Nachprüfung R34 · 29. September 2026

Geprüft: `c9c0922..3d1b95c`, Archivkopie von
`3d1b95cdcf9e0c2bbc697c6721934a87cdd5a796`. **VP-I05-Rest, VP-I07 und VP-I08 sind geschlossen;
der Regler-Clamp ist behoben.** Die Nachprüfung erhält dennoch **findings**: Bei der ausdrücklich
angefragten Zusammenführung von Kontakten zeigt sich ein weiterer, bereits vorher bestehender
Fall mit verlorenen Wiederkontakten (VP-I09). Keine Operatorentscheidung erforderlich.

### Abnahme der R33-Korrekturen und des Reglers

- **VP-I05-Rest:** Die Bewegung wird auf dem Basistrack gesucht und über dessen Punktindex auf
  dem angezeigten Track gelesen. In der früher roten `[7,7,8]`-Sonde stehen beide Sprünge nun
  innerhalb der Programmbewegung hinter dem 100-mm-Anfahrweg; Anzeige `L7` ohne Eilgangmarke,
  Reglerwert 100,02 bei Maximum 120. Das ist die erwartete native Schrittquantisierung des
  Samples 100,001. Auch Grenzband und gezielt eingeblendete Y-Bewegung stimmen.
- **VP-I07:** Eintritts- und Programmbefunde erhalten unterschiedliche `E…`-/`C…`-Schlüssel.
  Die neun Ziele aus R33 haben neun Schlüssel. Der gewählte Programmkontakt bleibt nach
  Ankunft des Eintrittsergebnisses erhalten; „Next“ erreicht den späteren Werkzeugkontakt
  und alle neun Ziele in einer Runde. Eintrittsziele werden als `entry` benannt.
- **VP-I08:** Der synchrone Positions-/Track-Watcher und das ausdrückliche Verwerfen bei
  manueller Eingabe/Wiedergabestart schließen die bisherige Lücke. Die unveränderte R33-Sonde
  mit nativen Pfeiltasten kehrt auf 0,001 s zurück; „Next“ geht jetzt zum späteren
  Programmkontakt bei ungefähr 1,261 s. Das bloße Eintreffen des Seitenergebnisses ändert
  weder Track noch Position und verwirft die gewählte Identität nicht.
- **MachineSlider:** Der erste Sprung hinter das alte Maximum bleibt auch im nativen Regler
  korrekt. `onInput` übernimmt den numerischen Wert vor dem weitergereichten `input`-Handler;
  die beobachteten Werte erreichen die Eltern sofort. Bei Maus- und CDP-Touchbewegungen bleiben
  Jog-Geschwindigkeit, Feed-/Spindle-/Rapid-Override und Scrub auch während unabhängiger
  Statusmeldungen an der gewählten Position. Die Overrides senden im Mock während des Ziehens
  nichts und beim Loslassen genau einmal den endgültigen Wert.

Belege: [R33-Sonden als Kopien und aktuelle Wächter, 19/19 grün](r34.playwright.txt),
[Grenzziel](r34.limit-origin-entry.json), [Kollisionsschlüssel/Klickfolge](r34.collision-key.json),
[Auswahl nach manueller Bewegung](r34.selection-reset.json),
[Regler: Maus](r34.sliders-mouse.json), [Regler: Touch](r34.sliders-touch.json).

### VP-I09 · P2 · Wiederkontakte auf einer bereits kollidierenden Startzeile gehen verloren

Die Regel „ein über die Eintrittsgrenze durchgehender Kontakt zählt einmal“ ist richtig.
Sie darf aber keinen **späteren erneuten Kontakt nach einer Trennung** verschlucken.
Der Fehler lässt sich mit dem echten XYZAC-Modell und dessen regulärem Browser-Worker
reproduzieren, ohne Kollisionsantworten zu ersetzen.

**Browserfall:** Die Programmstartpose ist `(240,0,-380)` und berührt die A-Wiege mit
Spindelnase und Werkzeug. Auf derselben Quellzeile L7 fährt das Programm nach `(0,0,-380)`
aus dem Kontakt heraus und zurück nach `(240,0,-380)` erneut hinein. L8 hebt danach Z an.
Die Mock-Maschine steht bei `(0,0,-380)`; ihr 240-mm-Anfahrweg führt in den ersten Kontakt.
Damit gibt es pro Körperpaar einen Anfangskontakt und einen späteren Wiedereintritt:
**vier Ziele**, auch nach dem Zusammenfassen des ersten Kontakts mit dem Eintritt.

Tatsächlich meldet schon der fertige Basis-Sweep nur **zwei** Zielbereiche. Für beide
L7-Records steht `cum: 0`; `intervals` fehlen. Nach dem Zusammenführen verbleiben nur die
zwei Eintrittsziele. „Next“ läuft zwischen diesen hin und her, die späteren Wiedereintritte
sind keine eigenen Stopps. Die Kontrollszene stellt eine freie Startpose vor denselben
Hin-/Rückweg: Sie liefert vier Ziele mit getrennten Intervallen und bleibt auch nach dem
Eintritt bei vier. Beide Sweeps sind vollständig (`truncated: null`, nicht vergröbert).

**Erste Ursache:** `viewer/collision.ts:1476` überspringt für `h.cum <= 0` die gesamte
Intervallbildung. Der feste Anfang bei 0 benötigt zwar keine Rückwärtssuche, der Rest des
Records muss aber weiterhin auf Trennung und Wiedereintritt geprüft werden. Aktuell wird
daraus ein großer Bereich über die dazwischen freie Strecke.

**Zweite Ursache im ausdrücklich angefragten Merge:** Selbst wenn die Basis bereits
korrekte Intervalle liefert, markiert `viewer/sweepMerge.ts:38–45` den **ganzen Record** als
Fortsetzung. `viewer/clashTargets.ts:35–37` verwirft ihn anschließend vollständig. Eine
separate Sonde über diese unveränderten Produktfunktionen belegt das mit Eintritt `[2,10]`
und Basisintervallen `[0,4]`, `[20,30]`: Bei Verschiebung 10 darf nur das erste Intervall
mit dem Eintritt zusammenfallen; das zweite muss als Programmbefund bei 30 erhalten bleiben.
Es fehlt jedoch. Diese zweite Sonde verwendet gezielt vorgegebene Resultatdaten; sie ist
vom Nachweis mit dem echten Worker oben getrennt.

**Korrektur:** Auch Kontakte ab Achsenanfang in ihre tatsächlichen Intervalle aufteilen.
Beim Zusammenführen nur das an der Eintrittsgrenze fortdauernde Intervall als Fortsetzung
behandeln; spätere Intervalle als eigenständige Programmbefunde mit stabiler Identität
behalten. Zählung, Marken, Vor/Zurück und Kontaktbereiche müssen dieselbe Trennung abbilden.
Die neue Herkunftskennung aus VP-I07 dabei beibehalten. Wächter für den durchgehenden Fall
sowie Trennung/Wiedereintritt auf derselben ersten Zeile ergänzen.

**Einordnung:** Kein Rückschritt der R34-Commits; beide betreffenden Entscheidungen standen
bereits vor ihnen im Code. Der Befund gehört zur jetzt gezielt geprüften Rückfrage 1 und zum
Vertrag, jeden getrennten Kontakt navigieren zu können. Die drei übernommenen R33-Befunde
werden dadurch nicht wieder geöffnet.

**Belege:** [Browser-Sonde mit Kontrollfall](r34.merge-reentry.spec.ts),
[Start im Kontakt: Originalresultate und Klickfolge](r34.merge-start-contact.json),
[Kontrollfall](r34.merge-control.json), [Bild](r34.merge-start-contact.png),
[Browserlauf: Kontrolle grün, Startkontakt rot](r34.extra-playwright.txt),
[isolierte Merge-Sonde](r34.merge-contract.test.ts), [deren Ergebnisdaten](r34.merge-intervals.json),
[deren Lauf](r34.merge-contract.txt).

### Antworten auf die beiden Rückfragen

1. **Zusammengeführter, wirklich durchgehender Kontakt:** Einverstanden mit Navigation von
   der aktuellen Position, ohne die Auswahl nachträglich auf den früheren Eintrittsbeginn
   umzuhängen. Die ergänzte Kontrollprüfung bestätigt: Der alte Programmschlüssel ist kein
   eigenes Ziel mehr, „Next“ geht zum nächsten späteren Befund und „Previous“ zum Eintrittsbeginn
   ([Daten](r34.merge-continuous.json)). Das gilt für den durchgehenden Kontakt; spätere
   Wiedereintritte müssen nach VP-I09 eigenständig bleiben.
2. **`:value` statt `v-model` bei MachineSlider:** Im geprüften Einsatz sehe ich keinen neuen
   Nachteil. Der bisherige Vue-`v-model`-Pfad schützt gerade `type="range"` auch bei Fokus nicht
   vor Modellaktualisierungen; die Änderung korrigiert hier vor allem die Reihenfolge von
   Grenzen und Wert. Die Eltern übernehmen die lokalen Jog-/Override-/Scrub-Werte synchron.
   Die eigene Browser-Sonde prüft natives Ziehen mit Maus und CDP-Touch, Zwischenwerte während
   unabhängiger Statusmeldungen und einmalige Übernahme der Overrides beim Loslassen. Das ist
   kein Test auf dem physischen Touchscreen. Gleichzeitige Änderungen des eigentlichen
   Override-Werts durch einen anderen Client unterliegen weiterhin der vorhandenen
   Synchronisationsregel in `App.vue`; diese Änderung führt dafür keine neue Regel ein.

Der bereits vereinbarte Folgepunkt „Tönung aus exakt gültigem Basisergebnis während des
Eintritts-Sweeps“ bleibt außerhalb dieser Korrekturen und ist kein zusätzlicher Blocker.

### Prüfung, Belege und Übergabe

- Typecheck und Produktionsbuild des angefragten Stands erfolgreich.
- **187/187** vorhandene gezielte Unit-Tests in neun Dateien erfolgreich.
- **19/19** bestehende Browserprüfungen/R33-Kopien erfolgreich.
- Zusatz-Browserlauf: **3 grün, 1 rot** – Maus, Touch und freie Kollisionsstartpose grün;
  Wiederkontakt nach bereits kollidierender Startpose rot.
- Zusatzprüfung über die Merge-Funktionen: **1 grün, 1 rot** – durchgehender Kontakt korrekt;
  späteres unabhängiges Intervall geht verloren.

[Wiederholung und Prüfgrenzen](r34.README.md), [Ergebnisübersicht](r34.tests.json),
[Build](r34.build.txt), [Unit-Lauf](r34.vitest.txt).
Ausführung ausschließlich in `/tmp/codex-r34-hj_zp6yd`, `nice -n 19`, ein Browser zur Zeit,
eigener Mock `127.0.0.1:4188`; Mock danach beendet. Keine Zugriffe auf `:5173`/`:8000`, keine
Befehle an LinuxCNC, kein eigener vollständiger Offline-/Backend-Lauf. Im Live-Checkout nur
dieser Anhang, neue `r34.*`-Belege und die vereinbarte Handshake-Rückmeldung. Frühere Belege
und Produktcode bleiben unverändert.

**Übergabe:** VP-I05-Rest, VP-I07 und VP-I08 geschlossen; MachineSlider-Korrektur abgenommen.
VP-I09 offen. R34 erhält `findings`.

---

## Umsetzung · Claude · Antwort auf R34 · 29. September 2026

Branch `feat/viewer-palette` (in `~/lcnc-suite`). Deine Evidenz R34 unverändert in `05b47ad`.
VP-I09 ist behoben (`4080b25`), mit beiden Ursachen. Beim Nachstellen fand ich den
**gespiegelten Fall im Sweep selbst** und habe ihn mit derselben Regel behoben: Ein Kontakt
kommt aus der Vorzeile, trennt sich und tritt auf derselben Zeile wieder ein. Deine Antworten
zu den Rückfragen 1 und 2 sind übernommen; der Kontrollfall aus Antwort 1 ist jetzt Unit-Test.

**Eine Kennzeichnung für „das erste Intervall gehört einem früheren Befund“**

Neues optionales Feld `carried` in `CollisionHit`: Das erste Intervall eines Onset-Records setzt
einen früheren, nie getrennten Kontakt fort. `clashTargets` überspringt nur dieses Intervall. Die
späteren Intervalle behalten ihren Index `k` und damit ihren Schlüssel `C<line>|<a>|<b>|<k>`, mit
und ohne Eintrittsergebnis. Die Herkunftskennung aus VP-I07 bleibt: Eintrittsbefunde heißen
weiter `E…` (im Merge-Test geprüft).

**Ursache 1, Sweep (`collision.ts`):** Die Verfeinerung übersprang `h.cum <= 0`.
- Das stammt aus der ersten Verfeinerung vom August, die nur rückwärts zum Erstkontakt suchte;
  bei 0 gab es nichts zu suchen. Die spätere Intervallbildung kam in dieselbe Schleife, und der
  Überspring-Fall blieb stehen.
- Jetzt wird auch ein Kontakt ab Achsenanfang in Intervalle zerlegt. Sein Einstieg braucht keine
  Rückwärtssuche (Untergrenze = Zeilenanfang = 0).

**Ursache 2, Merge (`sweepMerge.ts`):** Hat der Programm-Record, der den Eintrittskontakt
fortsetzt, mehr als ein Intervall, wird er nicht mehr ganz zur Fortsetzung.
- Er bleibt Onset mit `carried`.
- Der Eintrittsbefund reicht bis zum Ende des ersten Intervalls (`spanCumEnd`, `spanEndLine` =
  dessen Zeile).
- Mit einem Intervall bleibt alles wie von dir abgenommen: Fortsetzung, Spanne des Programms.

**Gespiegelter Fall im Sweep (neu gefunden):**
- **Befund:** Die Wiedereintritts-Promotion (`delete ex.continuation`) machte den ganzen Record zum
  Onset. Sein erstes Intervall ist aber der aus der Vorzeile übernommene Kontakt. Im
  vorhandenen Test „intermittent contact on ONE line“ ergab das **drei** Ziele (C25, C26|0,
  C26|1) für zwei Kontakte; C26|0 doppelte C25.
- **Korrektur:** Die Promotion merkt sich die Onset-Zeile (`carriedFrom`, intern).
  - Nach der Verfeinerung gilt `carried` nur, wenn das erste Intervall ohne Trennung bis zum
    Zeilenanfang reicht: Rückwärtssuche nicht geklammert, Einstieg = Zeilenanfang.
  - Eine Promotion, deren übernommener Teil nur innerhalb der Marge, aber nie im Kontakt lag,
    markiert also nichts.
- **Spanne:** Das übernommene Intervall verlängert jetzt die Spanne des früheren Onsets
  (`spanCumEnd`, `spanEndLine`) wie ein Fortsetzungs-Record. Vorher endete die Spanne von L25 an
  der eigenen Zeile.
- **Verfeinerungs-Memo:** Seine Signatur enthält jetzt `carriedFrom`. Eine Promotion durch einen
  Wiedereintritt innerhalb der Marge, ohne neues Kontakt-Sample, ändert nur `carried`; ein in
  einem Park-Snapshot verfeinerter Record hätte sonst das alte Ergebnis behalten. Die Signatur ist
  der Vertrag des Memos, dafür gibt es keinen eigenen Test.
- **Nicht angefasst:** Zwischenergebnisse (`peek`, unverfeinert) kennen `carried` nicht. Ein
  laufender Sweep kann den übernommenen Teil also kurz mitzählen, bis das Ergebnis verfeinert ist.

**Wächter, jeweils rot mit den alten Quellen:**
- **Unit `collision.test`:**
  - Der vorhandene Test „intermittent contact on ONE line“ prüft jetzt auch: zwei Ziele mit den
    Schlüsseln C25|0 und C26|1, `carried`, Spanne von L25 bis zum Ende des übernommenen
    Intervalls. Rot: `carried` fehlt, es bleiben drei Ziele.
  - Neu: „a program that starts in contact, separates and comes back on the same line“. Zwei
    Intervalle ab 0, zwei Ziele, L27 bleibt Fortsetzung. Rot: keine Intervalle.
- **Unit `sweepMerge.test`:** deine Merge-Sonde.
  - Eintritt [2, 10] bei Verschiebung 10, Basis [0, 4] und [20, 30] ergeben die Ziele E7|0 (2),
    C7|1 (30) und C9 (60).
  - C7|1 hat denselben Schlüssel wie vor dem Merge (20).
  - Der Eintritt reicht bis 14.
  - Dein durchgehender Kontrollfall gilt unverändert: zwei Ziele, „Next“ 60, „Previous“ der
    Eintritt.
  - Rot: zwei statt drei Ziele.
- **e2e `collisions.viewer.spec` mit dem echten XYZAC-Modell,** deine Browser-Sonde über die
  Oberfläche:
  - **Kontrolle** (freier Start, 100 mm davor) und **Start im Kontakt** (Maschine 240 mm entfernt).
  - Programm allein vier Befunde, mit Eintrittsweg weiter vier.
  - Eine Runde „Next“ erreicht vier verschiedene Stopps, der fünfte Klick kehrt zum ersten zurück.
  - Rot mit allem alt: 2 statt 4 schon ohne Eintritt; die Kontrolle bleibt grün.
  - Rot mit neuem Sweep und altem Merge: 4 ohne, **2 mit Eintritt**. Damit ist jede Ursache
    einzeln belegt.
  - Im Startkontakt-Fall wählt der erste Sprung den Kontakt am Startpunkt. Der gehört nach Ankunft
    des Eintrittsergebnisses zum Eintrittsbefund, danach geht „Next“ von der Position aus (deine
    Antwort 1). Der Test prüft deshalb die volle Runde ab dem ersten Stopp, nicht ab dem
    Startpunkt.

Doku: CLAUDE.md (`9ac6b3f`).

Offline-Gate (`python3 scripts/test_suite.py offline --timeout 2400`) auf `9ac6b3f`: PASS, Backend 1069, Vitest 1732, Playwright 355/355 (Browser-Schritt 1634 s).

**Arbeitsort für R35:** wie bisher. In `~/lcnc-suite` läuft die Live-Sim für die Sichtprüfung
des Operators.
- Dort bitte nur an die Review-Datei anhängen und neue `r35.*`-Belege ablegen.
- Keine Builds, Tests oder Checkouts dort, keine Zugriffe auf `:5173`/`:8000`, keine
  Maschinenbefehle.
- Stattdessen eine Archivkopie des Heads, mit eigenem Mock auf einem freien Port.

### Bitte prüfen

1. **Kriterium für `carried` im Sweep:** Nur wenn das erste Intervall eines promovierten Records
   ohne Trennung bis zum Zeilenanfang reicht. Mein Standpunkt: Ein erster Durchstoß, der erst
   nach dem Zeilenanfang beginnt (übernommen war nur Kontakt innerhalb der Marge), ist ein eigenes
   Intervall wie jeder Durchstoß in einem gewöhnlichen Onset-Record und bleibt ein Ziel.
   Einverstanden?

---

## Umsetzung · Codex · Nachprüfung R35 · 29. September 2026

Geprüft: `05b47ad..02b9448`, Archivkopie von
`02b9448ac455378671efd8417dc2d64836dc67e4`. **Ergebnis: agreement. VP-I09 ist geschlossen.**
Im angefragten Umfang keine weiteren offenen Befunde. Die früher abgenommenen
Navigationskorrekturen bleiben in den Gegenproben erhalten.

### VP-I09: Startkontakt, Zusammenführung und Wiederkontakt

Die beiden zuvor roten R34-Nachweise bestehen als Kopien ohne Änderungen ihrer Erwartungen:

- **Echter XYZAC-Sweep im Browser:** Sowohl bei freier als auch bereits kollidierender
  Programmstartpose entstehen vier getrennte Kontaktziele. Nach Ankunft des Eintrittsergebnisses
  bleiben es vier. In der zuvor fehlerhaften Szene sind die beiden Eintrittsziele bei etwa
  125 und 232 mm sowie die Programmrückkontakte bei etwa 605 und 712 mm getrennt vorhanden.
  Die Programmrückkontakte behalten ihre `C…|1`-Schlüssel. Claudes ergänzter Oberflächentest
  erreicht alle vier Stopps in einer Runde und kehrt beim fünften Klick zum ersten zurück.
- **Isolierter Merge-Vertrag:** Bei Eintritt `[2,10]` und Basisintervallen `[0,4]`, `[20,30]`
  wird nur der erste Kontakt zusammengefasst. Der spätere Programmbefund bei 30 bleibt ein
  eigenes Ziel; der weitere unabhängige Befund bei 60 ebenfalls. Der durchgehende Kontrollfall
  zählt weiterhin einmal und navigiert wie vereinbart von der aktuellen Position aus.

Belege: [Browser-Sonde](r35.merge-reentry.spec.ts),
[Start im Kontakt](r35.merge-start-contact.json), [Kontrolle](r35.merge-control.json),
[Bild mit vier Befunden und getrennten Bereichen](r35.merge-start-contact.png),
[Merge-Sonde](r35.merge-contract.test.ts), [Merge-Ergebnis](r35.merge-intervals.json),
[durchgehender Kontrollfall](r35.merge-continuous.json).

### Gespiegelter Fall und Antwort zum `carried`-Kriterium

**Einverstanden:** Nur der tatsächlich ohne Trennung bis an den Zeilenanfang reichende
Kontakt gehört zum vorherigen Befund. Eine bloße Annäherung innerhalb der Marge begründet
keinen übernommenen Durchstoß. Beginnt der erste tatsächliche Kontakt erst später auf der
Zeile, bleibt dieses erste Intervall ein eigenes Navigationsziel.

Der ergänzte bestehende Sweep-Test bestätigt den durchgehenden Fall über L25/L26:
`carried` unterdrückt nur das übernommene erste Intervall, L26s späterer Wiederkontakt bleibt
`C26|…|1`, und die Spanne von L25 reicht bis zum Ende des übernommenen Intervalls.
Die Anwendung in `clashTargets` bewahrt dabei die ursprünglichen Intervallindizes.

Zusätzlich habe ich drei unabhängige Fälle über echte Box-Geometrien geprüft
([Sonde](r35.carried.test.ts)):

1. **Nur Annäherung auf der Vorzeile:** Am Anfang von L26 beträgt der Abstand 1 mm bei
   Marge 2 mm. Das erste tatsächliche Eindringen erfolgt später. Es bleibt ohne `carried`
   als `C26|spindle|vise|0` erhalten
   ([Daten](r35.margin-near-only.json)).
2. **Früher tatsächlicher Kontakt, vor L26 bereits getrennt:** Auch hier beträgt der Abstand
   am L26-Anfang 1 mm. Der spätere Durchstoß wird korrekt eigenständig geführt;
   die frühere Berührung allein setzt kein `carried`
   ([Daten](r35.margin-earlier-contact.json)).
3. **Pausierter Sweep und Änderung ohne neues Kontaktsample:** Nach dem Ende des übernommenen
   Kontaktintervalls wird bei Achsenposition 80 von 109 ein verfeinertes Pausenresultat
   erzeugt. Danach nähert sich L26 erneut nur bis auf 1 mm an. Es entstehen keine neuen
   Kontaktsamples; dennoch muss die Umstufung `continuation` → `carried` berücksichtigt werden.
   Das fortgesetzte Endergebnis stimmt vollständig mit dem ununterbrochenen Referenzlauf
   überein und enthält nur den ursprünglichen Kontakt als Ziel
   ([Daten einschließlich Pausenresultat](r35.parked-promotion.json)).

Damit ist auch die zusätzliche Abhängigkeit von `carriedFrom` in der Memo-Signatur durch
eine konkrete Gegenprobe abgedeckt. Die internen Herkunftsdaten verlassen den Sweep nicht;
für die Verbraucher genügt das neue Kennzeichen am ersten Intervall.

### Benannte Grenzen

Unverfeinerte laufende `peek`-Ergebnisse können den übernommenen Anteil vorübergehend noch
mitzählen. Sie sind als laufendes Zwischenergebnis gekennzeichnet; das verfeinerte Pausen-
bzw. Endergebnis ersetzt sie. Diese von Claude ausdrücklich benannte Grenze ist kein
Blocker der vorliegenden Korrektur. Sie ist keine Zusage einer schon während jedes
Zwischenstands unveränderlichen Befundanzahl.

Die bereits vereinbarte Verbesserung der Tönung aus dem exakt gültigen Basisergebnis,
während der Eintritts-Sweep noch läuft, bleibt ein separater Folgepunkt. Dieses Agreement
betrifft die geprüfte Implementierung; die Sichtprüfung des Operators an der Live-Sim
wurde von mir nicht vorweggenommen.

### Prüfung, Belege und Übergabe

- Produkt-Typecheck und Produktionsbuild erfolgreich.
- **195/195** vorhandene gezielte Unit-Tests in neun Dateien erfolgreich.
- **5/5** ergänzende Vertrags-/Sweep-Prüfungen erfolgreich: beide R34-Mergefälle und die
  drei oben beschriebenen Abgrenzungs-/Pausenfälle.
- **18/18** Browserprüfungen erfolgreich: fünf aktuelle Kollisionsszenen, fünf Grenzbefund-
  und vier Rapids-Tests sowie vier Fälle aus kopierten R34-Sonden. Darunter weiterhin
  eindeutige Eintritts-/Programmschlüssel und das Verwerfen der Auswahl nach manuellem Scrub.

[Wiederholung und Arbeitsgrenzen](r35.README.md), [Ergebnisübersicht](r35.tests.json),
[Build](r35.build.txt), [vorhandene Unit-Tests](r35.vitest.txt),
[ergänzende Prüfungen](r35.review-vitest.txt), [Browserlauf](r35.playwright.txt).
Alle Ausführungen ausschließlich in `/tmp/codex-r35-a4r6xa6c`, `nice -n 19`, ein Browser zur
Zeit, eigener Mock `127.0.0.1:4188`; Mock danach beendet. Keine Zugriffe auf `:5173`/`:8000`,
keine Befehle an LinuxCNC, kein eigener vollständiger Offline-/Backend-Lauf. Im Live-Checkout
nur dieser Anhang, neue `r35.*`-Belege und die vereinbarte Handshake-Rückmeldung. Frühere
Reviewtexte/Belege und Produktcode unverändert.

**Übergabe:** VP-I09 geschlossen, keine neue Operatorentscheidung. R35 erhält `agreement`.

---

## Fassung 3 · Claude · Ideenrunde R38 · 29. September 2026 (der Operator verwirft die gedämpfte Palette)

Die feste Palette aus R29–R35 ist live. Der Operator hat sie heute angesehen und verwirft sie in
der Wirkung. Die Zusammenarbeit an Befundnavigation und Sweep (R31–R35) bleibt davon unberührt.
Diese Runde ist eine **Ideenrunde ohne fertigen Code**; bitte um deine Einschätzung und
Gegenvorschläge.

### Was der Operator gesagt hat (wörtlich, 29.09.)

- „bevor wir die änderungen vorgenommen haben waren die liniestärken und kontraste besser.
  warum verwenden wir für farben die häufig zusammen an der gleichen stelle vorkommen nicht
  komplementärfarben? kann man die farben besoders hell und leuchtend machen? magenta cyan
  gelb? die farben müssen besonder leuchtend und poppend sein.“
- „wir sollten auch die umrahmenungen bleiben lassen, diese sehen seltsam aus. wenn dann für
  die machine bounds einfach etwas dicker“
- „dinge wie blau orange / rot grün / violett gelb. farbschwäche können wir vielleicht mal
  aussen vor lassen. die maschinenlimiten können sich an das theme anpassen … aber die
  backplot werkzeugpfad und rapids sollten das besser nicht“
- Nach meinem Vergleich (unten): „wie wäre es mit backplot magenta 2px, pfad die
  komplementärfabre dazu? hellgrün? rapids blau und wo wir die bound überschreiten orange?
  kannst du vielleicht mal eine version machen, wo alles pfade 2px sind? kann man noch was
  bei den fabrkanälen machen, damit sie mehr herauspoppen? mehr sättigung, mehr helligkeit?“
- „wir sollten ausserdem darauf schauen, dass unsere mashinenmodelle keine poppenden farben
  enthalten und nicht zu nahe an unseren farben liegen. aber natürliich auf nicht ein
  regebogeneinhorn ist. eher gemutete metallische farben, die guten kontrast liefern.“
- „ausserdem die limiten. das grau ist denke ich nihct schlecht aber du hast es bisher nur auf
  ein limit angewendet“
- „es gibt ja nicht nur die reine farbe, was den kontrast angeht sonder auch sagen wir mal die
  helligkeit, damit die pfade klar im vordergrund der maschine bleiben“

Kontext: Der Operator arbeitet im **hellen Theme**. Seine gespeicherte eigene Palette sind die
alten Standardfarben (Vorschub `#22b8cf`, Eilgang `#f5a623`, Backplot `#ff00ff`).

### Schon umgesetzt (`248ef5e`, Operatorentscheidung, kein Review-Gegenstand dieser Runde)

- Die Boxen sind je eine Linie ohne Saum (`viewer/boxLines.ts`): Maschinengrenze durchgezogen
  2 px, Werkzeugpfad-Box gestrichelt 1 px.
- Beide in einem Neutralgrau **je Theme**: `#4b5563` hell, `#cbd5e1` dunkel, `#2b3138` /
  `#e6e9ee` HC.
- Die Farbschwäche-Simulation ist aus Paartabelle, Custom-Hinweis und `colourMath` entfernt.

### Was der Operator gesehen hat

[Renderings](viewer-palette-fest.r38.claude-renders.jpg), verkleinert auf 60 %: echtes
XYZAC-Modell im Mock, eine Tasche auf dem Rohteil, Eilgänge, die ersten Zeilen als Backplot
und ein Bohrbild außerhalb der Maschinengrenze.

Varianten:
- **A:** vor der Design-Welle.
- **B:** R35-Automatik.
- **C1:** Vorschub Blau `#1e90ff`, Backplot Orange `#ff7a00`, Eilgang Magenta, Limit Gelb /
  Gold.
- **C2:** Cyan / Orange / Magenta.
- **C2 mit Backplot 1 px.**
- **C3:** CMY, gelber Backplot, auf Weiß unsichtbar.

Daraufhin kam sein eigener Vorschlag (D).

### Vorschlag D (Operator) und meine Rechnung

| Rolle | Operator | Kandidat | OKLCH L / C | auf Weiß | auf `#0b0f14` |
|---|---|---|---|---|---|
| Backplot | Magenta 2 px | `#ff00ff` | 0,70 / 0,32 | 3,1 | 6,1 |
| Vorschub | Komplementär, „hellgrün“ | `#22dd44` | 0,78 / 0,24 | 1,8 | 10,5 |
| Eilgang | Blau (gestrichelt) | `#3d8bff` | 0,65 / 0,19 | 3,3 | 5,8 |
| Überschreitung | Orange (Overlay und Box-Überhang) | `#ff7a00` | 0,72 / 0,19 | 2,6 | 7,4 |

OKLab-Abstände: Vorschub/Eilgang 0,35, Vorschub/Backplot 0,54, Vorschub/Limit 0,34,
Eilgang/Backplot 0,32, Eilgang/Limit 0,38, Backplot/Limit 0,33. Damit liegen alle Paare über
0,25. Komplementär sind Backplot auf Vorschub (Magenta/Grün) und Limit auf Eilgang
(Orange/Blau).

**Helligkeit (sein letzter Punkt), aus meiner Sicht der eigentliche Hebel:**
- Die Pfade liegen fast immer vor der Maschine; in den Nahaufnahmen ist kaum Hintergrund zu
  sehen.
- Unsere Modelle sind hell: Lack `#ccd1cf`, Stahl `#a6b2b8`, Planscheibe Stahl. Eine
  beleuchtete Oberseite rendert ≈ `#e0e0e0` (OKLab L ≈ 0,9).
- Helle, satte Pfadfarben (L 0,65–0,88) haben dort kaum Helligkeitsabstand. Farbton allein
  trägt eine 1-px-Linie schlecht.
- Mein Vorschlag: Die Maschinenmodelle werden **gedämpft metallisch und dunkler**, beleuchtete
  Flächen etwa bei L 0,40–0,55. Die Pfade stehen dann über die Helligkeit vorn, in beiden
  Themes.
- Dazu kein Türkis (heute Akzent `#1f666e`, nahe Blau/Cyan) und kein Gold am Rohteil
  (`#b89e6e`, nahe Orange).
- Umsetzung über die sechs Farbklassen der Generatoren (`scripts/freecad_5axis_xyzac.py`,
  `scripts/freecad_twp_gantry.py`: cast / paint / dark / steel / accent / stock) und
  `viewer/palette.ts` `MACHINE_PALETTE` (Standardmodell 3-Achs, Altfixtures). Heute trägt
  diese Palette gedämpfte Achsfarben rot/grün/blau, genau die Pfadfarbtöne.
- Blau ist der schwächste Kandidat: Ein sattes Blau kann nicht hell sein (`#0000ff` L 0,45,
  `#3d8bff` L 0,65 bei C 0,19).

**„Mehr Sättigung, mehr Helligkeit“:**
- In sRGB ist die Grenze erreicht: Reines Magenta ist `#ff00ff`, Grün, Orange und Blau liegen
  am Gamut-Rand.
- Mehr gibt nur ein Wide-Gamut-Canvas (Display-P3, WebGL `drawingBufferColorSpace`). Der
  Operator nutzt Firefox auf macOS; ob Firefox das für WebGL kann, weiß ich nicht sicher.
- Der Renderer hat kein Tone-Mapping, die Linien sind unbeleuchtet und deckend. Dort ist
  nichts verloren.
- Die übrigen Hebel sind Helligkeitsabstand zur Maschine und Breite.

**Alle Pfade 2 px:**
- Heute sind Vorschub, Eilgang und Overlay `LineSegments` (GL-Linien, immer 1 px), in 64
  räumlichen Chunks. Die LOD-Stufen sind Index-Teilmengen über einer gemeinsamen
  Positionsliste.
- `LineSegments2` ist instanziert und braucht die Segmente physisch je Chunk und Stufe
  geordnet.
- Das heißt: neue Puffer je Stufe, mehr Speicher, sechs Vertices je Segment statt zwei, und
  das bei bis zu 1,2 M Segmenten.
- Fürs Bild rendere ich es mit einem Hilfsaufsatz (siehe unten). Für das Produkt wäre das ein
  eigener Schritt mit Messung am Mac (viewerPerf).

**Boxen:** Ich lese „nur auf ein Limit angewendet“ so:
- Beide Boxen sollen gleich sichtbar grau sein, also auch die Werkzeugpfad-Box 2 px,
  gestrichelt.
- Der Überhang der Werkzeugpfad-Box außerhalb der Maschinengrenze bleibt in der
  Überschreitungsfarbe (Orange).

### Fragen an Codex

1. **Farbwerte D:** Trägst du die Rollen (Magenta / Hellgrün / Blau / Orange) mit, und welche
   Werte würdest du nehmen?
   - Besonders Blau für den Eilgang: hell genug vor einer dunkleren Maschine, trotzdem blau.
   - Kollision bleibt ein roter Körper (`#c8102e`); ist Orange vs. Rot dort ausreichend?
2. **Maschinenmodelle:** Ein Vorschlag für die gedämpfte Metallpalette, also Zielhelligkeit
   und Chroma-Grenze je Klasse, Rohteil und Planscheibe.
   - Welche Paare sollen Wächter halten (Modellfläche beleuchtet vs. jede Pfadlinie: ΔL? ΔE?)?
   - Soll das Rohteil heller oder dunkler als die Planscheibe sein, wenn die Pfade darauf
     liegen?
3. **Helles Theme:** Die Szene ist weiß. Grün und Orange haben dort nur 1,8–2,6 : 1, wo ein Pfad
   vor dem Hintergrund liegt (Eilgänge über dem Teil).
   - Hinnehmen, weil die Pfade meist vor der Maschine liegen?
   - Oder die Szene im hellen Theme leicht getönt oder dunkler, und wie weit?
4. **2 px für alle Pfade:** Siehst du einen Weg, der die Chunk/LOD-Architektur behält?
   Welches Messkriterium setzt du?
5. **Wide-Gamut (P3):** Lohnt ein Versuch, und kannst du den Stand für Firefox/macOS bei WebGL
   prüfen?
6. **Wächter:** Was ersetzt „3 : 1 auf Hintergrund und Tisch“ für die festen Pfadrollen?
   Mein Vorschlag:
   - Paarabstand ≥ 0,25;
   - ΔL gegen die beleuchteten Modellflächen ≥ x;
   - auf dem Hintergrund nur noch benannt, nicht gefordert.

**Parallel:** Ich rendere D (gedämpftes und dunkles Modell, 1 px und alle 2 px) für den
Operator und lege sie als `viewer-palette-fest.r38.claude-renders-d.jpg` daneben, sobald sie
fertig sind. Die Hilfsaufsätze fürs Rendern (nie im Produkt):
- Backplot-Breite, Boxbreiten;
- `__viewerDiag.fatten(px)`, ersetzt Vorschub-, Eilgang- und Overlay-Linien durch
  `LineSegments2`;
- Spec `palettecmp.viewer.spec.ts`.

Diese liegen im Worktree `~/lcnc-suite-backlog` (detached auf `248ef5e`, nur lokal).

**Arbeitsort:** wie in den Palette-Runden.
- In `~/lcnc-suite` nur an diese Datei anhängen und neue `viewer-palette-fest.r38.*`-Belege
  ablegen.
- Keine Builds, Tests oder Checkouts dort, keine Zugriffe auf `:5173`/`:8000`, keine
  Maschinenbefehle; eigene Archivkopie mit eigenem Mock.

---

## Review Codex · Fassung 3 / Handshake R38 · 29. September 2026

**Stand:** `3237f5e`, Ideenrunde `248ef5e..3237f5e`. **Ergebnis: findings.**
Die Richtung – klare Farbfamilien, ruhiges Modell, kräftigere Linien – trage ich mit.
Vor einer Umsetzungsfreigabe fehlen drei Festlegungen: Hintergrund/Modellkontrast
(**VP38-01**), Verhalten bei deckungsgleichen 2-px-Linien (**VP38-02**) und der
Breiten-/Leistungsvertrag (**VP38-03**). Das sind Planpunkte, keine neuen Befunde
gegen die in R35 abgenommene Navigation. Die Änderungen aus `248ef5e` wurden nicht
nachträglich als Implementierung geprüft.

### 1. Rollen und Farbwerte: D vergleichen, für Weiß zusätzlich E

**Magenta für Backplot, Grün für Vorschub, Blau für Eilgang und Orange für Grenzen:
ja.** Die beiden starken Gegenpaare sind nützlich. Ich würde nicht auf ein exakt
mathematisches Komplement optimieren, sondern auf die tatsächlich gemeinsam
sichtbaren Linien. Bei deckungsgleichen Linien entscheidet ohnehin die Überlagerung.

| Rolle | D: kräftige helle Variante | D auf Weiß | E: Gegenentwurf für Weiß | E auf Weiß |
|---|---|---:|---|---:|
| Backplot | `#ff00ff` | 3,14:1 | `#ff00ff` | 3,14:1 |
| Vorschub | `#22dd44` | 1,83:1 | `#00a83c` | 3,15:1 |
| Eilgang | `#3d8bff` | 3,31:1 | `#3d8bff` | 3,31:1 |
| Grenzbefund | `#ff7a00` | 2,61:1 | `#e66b00` | 3,25:1 |

**Mein Ausgangsvorschlag bei beibehaltenem weißen Viewer ist E**, ebenfalls mit
2 CSS-px. Grün und Orange bleiben gesättigt, werden aber dunkler. **E gilt dann in
beiden Themes**, ebenso würde D in beiden gelten; kein automatischer Austausch
von E gegen D beim Themewechsel. D ist der sinnvolle Gegenvergleich, wenn der
Operator die leuchtendere Wirkung auf einer deutlich dunkleren Szene bevorzugt.
Ein dunkler Viewer im hellen UI wäre eine Änderung der bisherigen Entscheidung
„Viewer-Grund folgt dem Theme“, kein stiller Ersatz dafür.

Die eigene Rechnung bestätigt große Abstände zwischen den vier Linienrollen:
kleinster OKLab-Abstand D **0,317**, E **0,277**, jeweils auf der 0..1-Skala.
Einige Einzelwerte aus Claudes Tabelle weichen ab, ohne die Richtung zu ändern
(z. B. D Vorschub/Eilgang **0,383**, Vorschub/Backplot **0,567**).
[Rechnung](viewer-palette-fest.r38.codex-rechnung.py),
[Zahlen](viewer-palette-fest.r38.codex-rechnung.json).

**Rot für Kollisionskörper beibehalten**, Orange für den linearen Grenzbefund.
Form und benannte Befundart tragen die Unterscheidung mit. Die Grenze 0,25 nicht
auf jedes Körper-/Linienpaar ausdehnen: Orange/Rot liegt bei D nur bei 0,216, bei
E bei 0,165. Außerdem addiert `_tintMesh` Emissive-Rot auf das beleuchtete Material;
der reale Körper sieht anders aus als das Farbfeld `#c8102e`. Deshalb eine echte
Szene mit gleichzeitig orangefarbenem Grenzpfad und rotem Kollisionskörper prüfen.

Kleine Korrektur zur Sättigung: `#22dd44` liegt noch **innerhalb** des sRGB-Würfels;
mehr Sättigung ist dort möglich. Ein helleres Grün verbessert allerdings den
Kontrast auf Weiß nicht. P3 ist für diesen Zielkonflikt keine Voraussetzung.

### 2. Maschine: fertige Flächen messen, nicht nur Materialwerte

**Gedämpfte neutrale Metalle statt Achsfarben, Türkis und Gold: einverstanden.**
Die Modellgruppen brauchen hier keine zusätzliche Farblegende. Form, Fugen,
Abstufungen und das Achsgizmo reichen zur Orientierung als Ausgangspunkt.

**VP38-01, Teil Modell:** L = 0,40–0,55 als beleuchtete Zielhelligkeit ist zu breit
und oben deutlich zu hell. Auf neutralem L ≈ 0,55 hat D-Blau nur **1,47:1** und
Magenta **1,56:1**. Selbst L ≈ 0,40 ergibt für Blau nur **2,76:1**.
Damit wird „dunkler als bisher“ noch nicht zu „Pfade klar im Vordergrund“.

Für beide Kandidaten erlaubt der schwächste Linienwert als dunklen Untergrund
höchstens **Y ≈ 0,0556** für nominal 3:1; neutral entspricht das **OKLab L ≈ 0,382**.
Das sind berechnete Grenzen, keine Forderung, jeden Oberflächenpunkt schwarz zu
machen. Mein **Startentwurf für gerenderte, pfadtragende Flächen**:

| Klasse | Ziel-L, grob | Chroma-Obergrenze | Beispiel eines fertigen Bildtons |
|---|---:|---:|---|
| Guss / `cast` | 0,27–0,34 | 0,025 | `#303438` |
| Lack / `paint` | 0,32–0,38 | 0,025 | `#3c4043` |
| dunkle Teile / `dark` | 0,20–0,27 | 0,015 | `#202326` |
| Stahl, Planscheibe / `steel` | 0,28–0,34 | 0,020 | `#32363a` |
| Abdeckungen / `accent` | 0,27–0,33 | 0,025 | `#2d3135` |
| Rohteil / `stock` | 0,34–0,38 | 0,015 | `#393d40` |

**Rohteil etwas heller als die Planscheibe**, damit es als Arbeitsobjekt erkennbar
bleibt, aber innerhalb dieses dunklen Bereichs. Helle Gravuren/Kanten können die
Geometrie erklären; sie sollen keine großen hellen Flächen unter den Pfaden bilden.
Die Tabelle ist ein Gestaltungsstart, kein bereits visuell abgenommenes Maschinenmodell.

Die Hexwerte sind **Zielpixel nach Beleuchtung**, keine blind zu übernehmenden
Materialfarben. Das aktuelle Lichtsetup (Hemisphere 2,5 plus gerichtete Lichter
3/2/2) und Glanz beeinflussen die Ausgabe stark. Daher auch Lichtintensität und
Rauheit abstimmen; etwa 0,65–0,8 Rauheit als Rendervergleich, bevor pauschal alle
Materialfarben abgesenkt werden. Kein höheres `metalness` nur wegen des Wortes
„metallisch“: Es ersetzt keine passende Beleuchtung. Details/Silhouette bleiben
Teil der Sichtprüfung. Vorhandene Farben des Werkzeugs und der Zustandsanzeigen
nicht als gewöhnliche Maschinenlackierung mit entsättigen.

**Folgewirkung für beide Boxen:** Das bisherige Hell-Theme-Grau `#4b5563` erreicht
auf der vorgeschlagenen Fläche `#393d40` nur **1,45:1**. Es genügt also nicht, nur
das Modell zu ändern und beide Boxen auf 2 px zu setzen. Als Startwert wäre im
hellen Theme **`#909090`** vor Weiß und diesen dunklen Flächen geeigneter; die dunkle
Szene kann ein helleres Grau behalten. Durchgezogen/gestrichelt unterscheidet weiter
Maschinen- und Pfadbox. Das ist eine Konsequenz des neuen Modellentwurfs, kein
nachträglicher Befund gegen `248ef5e`.

### 3. Helles Theme: leichte Tönung löst das Problem nicht

**VP38-01, Teil Szene:** Hintergrundkontrast nicht streichen, weil Pfade „meist“
vor Metall liegen. Luftwege, ausgeblendete Maschine, Zoom und Überschreitungen
liegen gerade häufig vor dem Szenengrund. Auf `#f2f3f5` sinkt D-Grün von 1,83 auf
**1,65:1**, Orange von 2,61 auf **2,35:1**; auch Blau/Magenta fallen unter 3:1.
Eine mittlere graue Szene gerät noch näher an die Linienhelligkeit.

D braucht für alle vier Rollen eine **deutlich dunkle** Szene; `#202428` ist ein
brauchbarer Vergleichswert (schwächste Rolle **4,71:1**). Wer Weiß beibehalten will,
sollte E anschauen. Eine geringe Tönung ist hier kein Kompromiss zwischen beiden.
Die bisherigen Aussagen „Helligkeit erhöhen“ und „auf Weiß besser erkennbar“ stehen
für Grün/Orange in einem echten Zielkonflikt; diesen sichtbar entscheiden statt
durch gelockerte Wächter verdecken.

[Interaktiver Vergleich D/E](viewer-palette-fest.r38.codex-vergleich.html),
[unverkleinertes Bild](viewer-palette-fest.r38.codex-vergleich.png): Hintergrund,
Modellfläche, Breite und Überlagerung lassen sich getrennt ändern. Schematische
SVG-Linien, keine Simulation der Maschinenbeleuchtung.

### 4. 2 px: machbar mit Chunks und LOD, mit klarer Bedeutung

**2 CSS-px für Vorschub, Eilgang, Backplot und Grenzmarkierung: als Prototyp ja.**
Die gleiche Breite ist visuell ruhiger. Ebenso beide Boxen mit 2 px ausprobieren;
die Maschine durchgezogen, die Pfadbox gestrichelt, der Überhang weiterhin Orange.
Keine Säume, kein Glow und kein künstlicher geometrischer Versatz der Pfade.

**VP38-02 – Deckung:** Eine deckende 2-px-Linie über einer deckungsgleichen
2-px-Linie verdeckt sie vollständig. Ein größerer Farbabstand verhindert das nicht.
Die bestehende Reihenfolge ist bereits sinnvoll und soll ausdrücklich erhalten
bleiben: **Grenzbefund (12) vor Backplot (11) vor Vorschau (10)**. An deckungsgleichen
gefahrenen Stellen liest man somit Magenta, an beanstandeten Stellen Orange.
Die untere Rolle wird dort nicht gleichzeitig sichtbar versprochen. Bei Bedarf
Backplot über seine vorhandene Sichtbarkeit ausblenden, statt Halos einzuführen.
Konkrete Gegenproben: exakte Deckung, 1-px-Nachbarschaft, Kreuzung und dichtes
Schlichten, jeweils mit/ohne Grenzmarkierung sowie vor Rot am Kollisionskörper.
Rapids behalten ihre Strichelung; ob Orange sie im Befundbereich bewusst ersetzt,
als bestehende Priorität benennen. Fortschrittsgrau/Stale und Befundnavigation bleiben
weiter dieselben Zustände und Datenquellen.

**VP38-03 – Architektur:** Chunks, Frustum-Culling, Quellindizes, Brüche, Raum-/
Tisch-Frames und die bestehende LOD-Auswahl behalten. Nur den Zeichenpuffer pro
sichtbarer LOD/Chunk in Endpunktpaare für `LineSegments2` umsetzen. Die vollständige
Geometrie bleibt Quelle für Scrub, Sweep und Navigation. Die Distanzattribute für
Rapids aus den ursprünglichen Pfaden übernehmen; nach dem räumlichen Sortieren
nicht neu über die Chunk-Reihenfolge summieren. Sonst ändern sich Striche beim LOD-Wechsel.

Die Speicherbegründung präzisieren: Three r182 hat ein **gemeinsames Grundmesh mit
acht Vertices / sechs Dreiecken**, dazu je Segment sechs Float32-Endpunktwerte
(24 Byte), nicht sechs volle Positionsvertices je Segment. **1,2 Mio. Segmente
bedeuten 27,5 MiB Endpunkte pro Stufe**; drei unverkürzte Stufen 82,4 MiB, jeweils
noch ohne GPU-Kopie, Distanzen und Metadaten. Der Aufwand bleibt real.
[Three r182 Quelltext](https://raw.githubusercontent.com/mrdoob/three.js/r182/examples/jsm/lines/LineSegmentsGeometry.js).

Zuerst den einfachen gepackten Ansatz messen. Gemeinsame Puffer für Grundpfad und
Overlay nutzen; nicht alle Positionen für jeden Farbpass nochmals speichern.
Falls er zu teuer ist: begrenzter Cache von Chunk-/LOD-Puffern oder als zweiter
Ansatz instanzierte Endpunktindizes mit Vertex-Texturzugriff auf die gemeinsame
Positionsliste. Letzteres erhält die Indexstruktur direkter, kostet aber einen
eigenen Shader und weitere Prüfungen. Kein pauschales `linewidth = 2` am bisherigen
GL-Linienmaterial und kein stiller Rückfall auf 1 px bei großen Programmen.

**Mein vorgeschlagenes Messbudget**, ausdrücklich noch kein Messergebnis:

- Einheit **CSS-px** festlegen; DPR 1/2 und 100/150 % prüfen. Native GL-Linien mit
  einem Framebuffer-Pixel sind nicht automatisch eine CSS-px-Linie auf Retina.
- Zielgerät Mac/Firefox, dieselbe Szene, kleine Datei und 1,2-Mio.-Segment-Datei,
  Fit/Detailansicht, Orbit/Scrub, Backplot voll und Limit-Overlay an/aus; je drei
  vergleichbare 30-s-Läufe nach Aufwärmen.
- Bei 60-Hz-Ausgabe: p95-Frameabstand höchstens 33,3 ms und höchstens 20 % schlechter
  als derselbe Ausgangslauf; keine neuen wiederkehrenden >100-ms-Aussetzer oder
  durch den Renderer verursachten >50-ms-Eingabeblockaden. Auf anderem Refresh
  die absoluten Framegrenzen entsprechend formulieren.
- Als erster Speicherrahmen: höchstens 128 MiB **zusätzliche** Pfadpuffer jeweils
  auf CPU und GPU bei 1,2 Mio. Segmenten; Aufbaupeak getrennt ausweisen. Echte
  Array-/Buffer-Bytes zählen, nicht nur Geometrieobjekte. Nach wiederholtem Laden
  keine anwachsenden alten Puffer. Überschreiten führt zur Optimierung oder einer
  ausdrücklich neu vereinbarten Grenze, nicht zum versteckten Breitenwechsel.
- `viewerPerf` dafür nutzen, aber richtig lesen: `renderMs` ist CPU-Submission,
  GPU-Fences messen Rückstand. Zusammen mit rAF-Abständen, Allokationen und
  gezählten Pufferbytes bewerten, nicht als direkte GPU-Zeit ausgeben.

### 5. Wide-Gamut: möglich, nach den Grundentscheidungen

**Firefox/macOS unterstützt P3-WebGL seit Firefox 132.** Mozillas Release Notes
nennen macOS/Windows und P3 mit 8 Bit; die heutige Unsicherheit im Plan ist damit
aufgelöst. Die ältere Exposition in Firefox 127–129 war noch funktionslos.
[Firefox 132](https://www.firefox.com/en-US/firefox/132.0/releasenotes/),
[MDN-Kompatibilitätsdaten](https://github.com/mdn/browser-compat-data/blob/main/api/WebGLRenderingContext.json).

Ein kleiner separater Versuch lohnt **nach** Farbe/Fläche/Breite. P3 erweitert den
Farbumfang, ist kein HDR-Helligkeitsregler. Bestehende sRGB-Hexwerte sehen bei
korrekter Umrechnung weiter gleich aus; nur den Canvas auf P3 zu stellen und die
Zahlen anders interpretieren zu lassen wäre eine Farbverschiebung.

Für den Versuch: tatsächliche Monitorfähigkeit (`color-gamut: p3`), Setzen und
Rücklesen von `drawingBufferColorSpace`, Three-Farbraumkonvertierung und wirklich
als P3 definierte Kandidaten zusammen prüfen. Die installierte Three-Version hat
entsprechende `ColorSpaces`-Erweiterungen; der aktuelle Produktresolver akzeptiert
aber nur `#rrggbb`. Daher kein ungeprüfter P3-String in bestehende Custom-Daten.
Ein benannter sRGB-Zweig bleibt erforderlich. Die Standardsicht muss auch dort
bestehen; P3 entscheidet weder über die 2-px-Freigabe noch über lesbare Grenzen.

### 6. Wächter: drei unterschiedliche Aufgaben getrennt halten

Ich würde **3:1 nicht durch ΔL oder ΔE ersetzen**. Die Werte beantworten andere
Fragen. Für relevante grafische Information nennt W3C Kontrast gegen angrenzende
Farben; Antialiasing dünner Linien kann trotz passender Nominalfarbe die Erkennbarkeit
verschlechtern. [W3C, Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

1. **Sichtbarkeit:** Vier Pfadrollen und beide neutralen Boxen gegen tatsächlichen
   Szenengrund sowie repräsentative beleuchtete Flächen prüfen. Für die gewählte
   Standardkombination nominal ≥3:1 beibehalten. An identischer Kamera zusätzlich
   Renderpaare ohne/mit Pfad aufnehmen, um den tatsächlichen Untergrund und die
   Linienmitte zu prüfen; nicht jeden Antialias-Randpixel mit 3:1 verwechseln.
2. **Unterscheidbarkeit:** ≥0,25 OKLab als eigenes Entwurfsziel für die **vier
   Pfadrollen**, keine allgemeine Zugänglichkeitsgarantie. Strichelung, Boxform,
   benannte Befundarten und vereinbarte Zeichenreihenfolge mitprüfen. Keine
   erneute Farbschwäche-Simulation gegen die Operatorentscheidung einführen.
3. **Konstanz und Bedienung:** Farbbedeutung beim Themewechsel gleich, 2 CSS-px
   auch nach Resize/DPR-Wechsel, keine LOD-bedingten Strichsprünge, keine falschen
   Verbinder, Befundnavigation unverändert. Automatik und gespeicherte Custom-
   Farben getrennt zeigen; zum Vergleich keine Operatorfarben überschreiben.

Die aktuellen 60-%-JPEGs sind als Stimmungseindruck hilfreich, können aber weder
2-px-Breite noch subtile Überdeckung belegen. Nächster Vergleich: native PNGs mit
identischer Kamera und DPR, zunächst **nur Breite**, dann **nur Modell/Licht**,
dann D gegen E. Jeweils Nahansicht **und** freie Luftwege; zuletzt tatsächliche
Kollision plus Limitbefund. Das angekündigte D-Bild lag bei dieser Nachprüfung
noch nicht im Live-Checkout vor; seine konkrete Maschinenwirkung ist nicht abgenommen.

### Übergabe

**Meine Empfehlung:** E auf dem bestehenden weißen Szenengrund als Standard-
Gegenentwurf zu D zeigen; in beiden Fällen ruhige dunkle Modellflächen und 2 CSS-px
prototypisieren. D mit deutlich dunkler Szene als ausdrücklich alternative Richtung
zeigen. P3 folgt optional. Vor Produktarbeit VP38-01 bis VP38-03 mit der gewählten
Kombination, Überlagerungsregel und dem akzeptierten Messbudget konkretisieren.

[Quellen und Prüfumfang](viewer-palette-fest.r38.codex-quellen.md),
[Rechnung](viewer-palette-fest.r38.codex-rechnung.json),
[interaktiver Vergleich](viewer-palette-fest.r38.codex-vergleich.html).
Reine Ideenprüfung, eigene deterministische Rechnung und Prüfung des eigenständigen
HTML-Belegs. Keine Produkt-Builds/Tests oder Zugriffe auf die Live-Suite, keine
Maschinenbefehle. Frühere Belege bleiben unverändert. **Handshake R38: findings.**

---

## Operator-Entscheidungen · 29. September 2026 (nach R38)

Grundlage sind Renderings in Originalgröße auf dem XYZAC-Modell (Vergleichsseite des Operators,
Runden 2–4; Renderhilfen nur lokal im Worktree `~/lcnc-suite-backlog`, nie im Produkt).

1. **Zwei Schemen, gleicher Farbton je Rolle.**
   - Im hellen Theme kräftigere Töne (Codex' Entwurf E), im dunklen leuchtende (D, mit Hellgrün).
   - Eilgang und Backplot sind in beiden gleich.
   - Die frühere Regel „ein Wert je Rolle in hell und dunkel“ (R29/R30) ist damit abgelöst. Sie
     gilt jetzt als „gleiche Farbfamilie je Rolle, Farbton ≤ 15°“, dieselbe Regel wie für HC.

   | Rolle | hell / `:root` | dunkel / Auto-dunkel | hc-light | hc-dark |
   |---|---|---|---|---|
   | Vorschub (Pfad) | `#00a83c` | `#5cff5c` | `#236508` | `#5cff5c` |
   | Eilgang (gestrichelt) | `#3d8bff` | `#3d8bff` | `#1f5fe0` | `#6aa6ff` |
   | Backplot | `#ff00ff` | `#ff00ff` | `#c000c0` | `#ff5cff` |
   | Überschreitung (Overlay, Box-Überhang) | `#e66b00` | `#ff7a00` | `#c85100` | `#ff8a1a` |
   | Kollision (Körper) | `#c8102e` | `#c8102e` | `#b0001e` | `#ff3344` |

   Kleinste Paarabstände der vier Linien (OKLab): hell 0,277, dunkel 0,317, hc-light 0,262,
   hc-dark 0,254. Hell und dunkel halten ≥ 3 : 1 auf dem Hintergrund, HC ≥ 4,5 : 1.

2. **Pfad Grün** statt Cyan. Cyan lag am blauen Eilgang: 0,10 hell und 0,22 dunkel.
3. **Alle Pfade 2 px:** Vorschub, Eilgang, Überschreitung und Backplot. Das ist Teil B, mit
   Codex' Messbudget (VP38-03) als eigene Runde.
4. **Maschinenmodelle in Graustufen** statt Türkis, Gold und gedämpfter Achsfarben:
   Säule/Schlitten/Kopf hell, Führungen mittel, Rohteil und Planscheibe im Mittelfeld,
   Bett/Abdeckungen/Wiege dunkel.
   - Materialfarben: Lack `#575a5e`, Stahl `#44484c`, Planscheibe `#2e3235`, Rohteil `#363a3d`,
     Guss `#262a2d`, Abdeckung `#1d2023`, dunkel `#121417`.
   - Gerendert (heutiges Licht): Rohteil-Oberseite `#5d6165` (L 0,49), Planscheibe `#53585b`
     (L 0,46).
   - Der Operator fand das Einheitsdunkel aus R38 („deutlich dunkel“, L 0,27–0,38) zu dunkel
     und wünschte mehr Stufen. Die Pfade stehen trotzdem über die Helligkeit vorn: hell
     1,9–2,3 : 1 gegen Rohteil und Planscheibe, dunkel 1,9–5,5 : 1.
5. **Maschinengrenze zweifarbig:** abwechselnd dunkle und helle Striche (`#15181c` / `#f0f2f4`),
   wie die Auswahlkante in Zeichenprogrammen.
   - 2 px, keine Umrandung, in allen Themes gleich; Strichlänge in Bildschirmpixeln.
   - Die Werkzeugpfad-Box ist ebenso zweifarbig, mit kürzeren Strichen und ihren Maßangaben.
   - Der Überhang außerhalb der Maschinengrenze bleibt in der Überschreitungsfarbe.
   - Ein einzelnes Grau (auch Codex' `#909090` aus R38) geht vor einem grau gestuften Modell an
     wechselnden Stellen unter; das ist damit abgelöst.
6. **Überdeckung (VP38-02):** Gleich breite, deckungsgleiche Linien zeigen nur die obere.
   Reihenfolge bleibt Überschreitung (12) über Backplot (11) über Pfad (10). Der Operator hat
   das in den Renderings gesehen.

Offene Punkte für die Umsetzung:
- Teil B (2 px, VP38-03) als Planrunde R39.
- Die Schneide des Werkzeugs ist heute gold (`#d4a800`) und liegt nahe am Orange; dem Operator
  genannt, nicht still entschieden.

---

## Planrunde R39 · Claude · Teil B: alle Pfade 2 px (VP38-03) · 29. September 2026

Der Operator hat 2 px für alle Pfade entschieden (Abschnitt oben). Teil A (Farben, Modelle,
zweifarbige Grenzen) setze ich parallel um und lege ihn dir danach zur Implementierungsprüfung
vor. Diese Runde betrifft nur Teil B und ist eine **Planprüfung ohne Code**.

### Heute (`toolpathController.ts`)
- `makeSet` baut je Strom (Vorschub/Eilgang) und Rahmen (Tisch/Raum) eine gemeinsame
  Positionsliste (`posAttr`).
- Je Chunk (≤ 64 räumliche Zellen) und LOD-Stufe gibt es ein `THREE.LineSegments`: eigener
  Index-Bereich (`setDrawRange`) über dieselbe Indexliste der Stufe, explizite Bounding Sphere.
- Eilgänge sind gestrichelt über `lineDistance` (`distAttr`, kumulativ in Stromreihenfolge,
  vom Worker vorberechnet).
- Überschreitungs-Overlays: je Chunk und Stufe eine eigene Indexliste der markierten Paare
  (`buildOverlays`), Reihenfolge 12.
- Die Befundansicht (`setReveal`) zeichnet Paare einer Spur-Teilmenge.
- `updateCulling` wählt je Bild die LOD-Stufe und blendet Overlays aus.

### Plan
1. **Zeichenpuffer:** Je Chunk × Stufe ein `LineSegments2` mit `LineSegmentsGeometry`, dessen
   `instanceStart/End` aus den Paaren dieses Bereichs gepackt werden (6 Float32 je Segment).
   - Die gemeinsame Positionsliste bleibt die Quelle für Scrub, Sweep, Befundnavigation und
     `feedSrc`/`rapidSrc`.
   - Chunks, Frustum-Culling (explizite Spheres), LOD-Auswahl, Brüche und Raum-/Tisch-Rahmen
     bleiben unverändert.
2. **Eilgang-Striche:** `instanceDistanceStart/End` je Segment aus dem ursprünglichen
   `distAttr` (Distanz an Paar-Anfang und -Ende), nie über die Chunk-Reihenfolge neu summiert.
   Damit ändern sich die Striche beim LOD-Wechsel nicht.
3. **Overlays und Befundansicht:** dasselbe Packen für die markierten Paare bzw. die
   Spur-Teilmenge, gleiche Materialien.
4. **Materialien:** ein `LineMaterial` je Strom und Rahmen (2 CSS px, `worldUnits: false`).
   - `resolution` einmal je Bild aus `updateCulling` (die Canvasgröße ist dort bekannt), nicht
     je Objekt.
   - Stale-Grau und Farbwechsel wie heute über `color`.
   - `depthTest` nach `pathAlwaysOnTop`.
   - Reihenfolge 10/11/12 bleibt.
5. **Speicher:**
   - Zuerst eager, alle Stufen beim Laden.
   - Gezählt werden die gepackten Bytes je Stufe (`__viewerDiag`: Summe der
     `instanceStart`-Puffer).
   - Liegt die 1,2-M-Datei über deinem Rahmen von 128 MiB zusätzlich, packe ich lazy je
     (Chunk, Stufe) beim ersten Sichtbarwerden mit begrenztem Cache.
   - Kein stilles Zurückfallen auf 1 px.
6. **Diagnose:** `getRoleMaterials` meldet dann `fat2` für Vorschub, Eilgang und Overlay.
   Die Breitenleiter in `scenes.viewer.spec` misst 2 CSS px für alle vier Linien bei DPR 1 und 2.

### Messprotokoll auf dem Mac des Operators (Firefox)
- **Umschalter:** Ein vorübergehender Debug-Schalter „Pfadbreite 1 px / 2 px“ (Settings →
  Debug) erlaubt A/B im selben Tab. Er wird nach der Abnahme entfernt, 2 px bleibt fest.
- **Programme:** `perfmatrix-big.ngc` (1,2 M Segmente, Zufallsweg) und ein echtes CAM-Programm.
- **Ansichten:** Fit und Detail, je 3 × 30 s Orbit nach Aufwärmen.
  - Backplot voll, Limit-Overlay an und aus.
  - DPR des Macs (2) und 150 % Zoom.
- **Auswertung:** `browser.viewer.perf` aus `trace.ndjson`.
  - `raf_*` Frameabstände: p95 ≤ 33,3 ms und ≤ 20 % schlechter als 1 px.
  - `gpu_*` Rückstand, `mt_*`, keine neuen > 100-ms-Aussetzer.
  - Dazu die gezählten Pufferbytes.
  - Ein kleines Skript fasst je Lauf zusammen.

### Fragen an Codex
1. Trägst du das eager Packen je Chunk × Stufe als ersten Schritt mit, oder soll der Cache
   gleich lazy sein?
2. `resolution` zentral je Bild statt `onBeforeRender` je Objekt: siehst du dabei ein Risiko
   (mehrere Canvasse, Screenshots, DPR-Wechsel)?
3. Reicht das Messprotokoll? Der Debug-Umschalter wäre die einzige Stelle, an der 1 px noch
   existiert, und nur bis zur Abnahme.
4. Siehst du einen Fall, in dem `LineSegments2` anders als die GL-Linie aussieht und den ich
   prüfen muss? Zum Beispiel Schnitte mit der Maschinengeometrie (Tiefe) oder sehr kurze
   Segmente in der LOD.

**Arbeitsort:** wie gehabt.
- In `~/lcnc-suite` nur an diese Datei anhängen und neue `viewer-palette-fest.r39.*`-Belege
  ablegen.
- Keine Builds, Tests oder Checkouts dort, keine Zugriffe auf `:5173`/`:8000`, keine
  Maschinenbefehle.
- Teil A entsteht parallel im Arbeitsbaum; bitte eine Archivkopie von `HEAD` nutzen.

---

## Review Codex · Planrunde R39 / Teil B · 29. September 2026

**Geprüft:** Plan `aa4c701`, Umfang `76d0cec..aa4c701`, Archivkopie.
Der Live-Checkout stand beim Beginn bereits auf `4bb4ff1`; Teil A und die danach
parallel entstehenden Produktänderungen bleiben außerhalb dieser Planprüfung.
**Ergebnis: findings. VP38-03 bleibt offen**, mit drei konkreten Ergänzungen unten.
Die Grundarchitektur ist sinnvoll; die vier Fragen sind damit beantwortet.

Die neuen Operatorentscheidungen ersetzen ausdrücklich die entsprechenden R38-
Vorschläge: unterschiedliche Helligkeiten innerhalb derselben Farbfamilie,
gestufte Maschinenflächen, zweifarbige Boxen und die sichtbare Überdeckungsreihenfolge
sind die Vorgabe. Den akzeptierten Modellkontrast verhandle ich hier nicht erneut.
**VP38-02 ist auf Planebene geklärt**; die Umsetzung wird separat geprüft.

### 1. Eager zuerst: ja, aber mit vollständiger Speicherbilanz · VP39-01

Ich trage das Packen pro Chunk × Stufe als ersten Ansatz mit. Es hält den
Zeichenweg einfach und vermeidet neue Arbeit beim ersten Sichtbarwerden eines
Chunks. **Lazy ist nicht automatisch schneller:** Packen beim Orbit kann genau
die Eingabeblockaden erzeugen, die wir vermeiden wollen.

Der geplante Zähler „Summe der instanceStart-Puffer“ reicht für das vereinbarte
Budget aber nicht. Es fehlen zumindest Strichdistanzen, gepackte Overlay-/Reveal-
Daten, weiterhin gehaltene Ausgangs-/Index-/Quellarrays sowie Aufbau- und Wechselpeaks.
CPU-Kapazität und tatsächlich angelegte GPU-Puffer sind zwei verschiedene Größen;
eager aufgebaute, noch nie sichtbare LODs sind nicht zwingend schon hochgeladen.

Die kleine eigene Sonde zeigt bei zwei Segmenten **48 Byte Endpunkte plus 16 Byte
Strichdistanzen**. Bei 1,2 Mio. Segmenten und drei unverkürzten Stufen sind es
**82,4 MiB Positionen**; ein vollständig getrennt gepacktes Limit-Overlay verdoppelt
allein diese Bruttogröße auf **164,8 MiB**. Das ist noch kein gemessener Nettozuwachs,
zeigt aber, warum Overlay-Kopien und die Bilanzbasis ausdrücklich sein müssen.

**Ergänzung zum Plan:**

- Vollständige Bytebilanz nach Eigentümer und Funktion: Basis, Distanzen, Overlay,
  Reveal, Quellarrays/Indizes und gegebenenfalls Vergleichsrenderer. Gemeinsam
  referenzierte InterleavedBuffer auf CPU nicht doppelt zählen; getrennte GPU-
  Uploads trotz geteilter ArrayBuffer jeweils berücksichtigen.
- Bestehende und neue Variante jeweils in gleichem Zustand messen. **128 MiB
  zusätzlicher CPU- und GPU-Speicher getrennt**, Aufbaupeak und Rückkehr nach
  Löschen/Programmwechsel zusätzlich ausweisen. Nach Orbit durch alle LODs und
  wiederholter Befundnavigation messen, nicht nur direkt nach dem Laden.
- Grundpfad/Overlay möglichst gemeinsam speichern. Ein bewusst getrennt gepackter
  Overlay ist vertretbar, wenn die vollständige Bilanz das Budget nachweislich hält;
  seine Kopien dürfen nicht aus dem Zähler verschwinden.
- Eager-Kapazität vor großer Allokation abschätzen. Wenn ein Cache erforderlich
  wird, dessen Vertrag zuerst ergänzen: Bytegrenze, Schlüssel einschließlich
  Programm-/Bake-Generation, Invalidierung, Freigabe geteilter Puffer und begrenzte
  Arbeit außerhalb des Rendercallbacks. „Beim ersten Sichtbarwerden packen“ allein
  ist dafür keine ausreichende Beschreibung. Kein Rückfall auf dünne Linien.

### 2. Resolution zentral: möglich, derzeit fehlen Einheiten und Besitzer · VP39-02

`updateCulling` kennt heute **die Framebuffer-Höhe**, nicht die CSS-Viewportgröße:
`ThreeViewer.vue:3524` übergibt `renderer.domElement.height`; der Controller nutzt
sie für die LOD-Toleranz in Geräte-Pixeln. Diese Verwendung muss erhalten bleiben.
Die Breite der neuen Linien braucht dagegen die **logische Viewportbreite/-höhe**.
400 CSS-px versus 800 Framebuffer-px sind bei DPR 2 nicht austauschbar.

Außerdem setzt `LineSegments2.onBeforeRender` in Three r182 die Material-Resolution
bereits selbst aus dem Viewport. Meine Sonde bestätigt, dass ein vorher zentral
gesetzter Wert überschrieben wird. Nur eine neue Zuweisung in `updateCulling`
beseitigt diesen Aufruf also nicht.
[Three.js LineMaterial](https://threejs.org/docs/pages/LineMaterial.html).

**Meine Empfehlung für den ersten Schritt:** Den vorhandenen Objekt-Hook behalten;
er hat die Information am tatsächlichen Draw. Erst bei messbarer Relevanz
zentralisieren. Falls zentral, dann einmal **pro Renderer und Renderpass**, nicht
nur pro rAF-Tick, mit explizit deaktiviertem/angepasstem Standard-Hook. Getrennte
Parameter für LOD-Gerätehöhe und logischen Viewport; nach Resize, effektivem
Renderer-DPR-Wechsel, ausgeblendetem/reaktiviertem Viewer und Export vor dem ersten
Draw aktualisieren. Materialien nicht zwischen Viewern mit verschiedenen Viewports
teilen. Der Gizmo-Pass darf keine kleine Resolution im Hauptpass hinterlassen.

Keine zusätzliche Exportpipeline erfinden: Die bestehenden Renderwege prüfen;
sollte ein Export eine andere Ausgabegröße verwenden, dessen Breitenmaßstab
explizit definieren. So bleibt „2 CSS-px“ eine prüfbare Aussage.

### 3. Messprotokoll: ergänzen, damit A/B die echte Umstellung misst · VP39-03

Der temporäre Debug-Schalter ist als Messhilfe in Ordnung. **A muss der bisherige
native `THREE.LineSegments`-Renderer sein**, B der neue `LineSegments2`-Renderer.
Nur `LineMaterial.linewidth` zwischen 1 und 2 zu ändern, würde den Mehrpreis des
neuen Zeichenwegs in der Referenz verstecken. Die Beschriftung besser „bisherige
GL-Linie / 2 CSS-px“; die bisherige GL-Linie ist auf Retina nicht automatisch 1 CSS-px.
Beide Varianten verwenden denselben Teil-A-Stand, dieselben Farben und Eingangsdaten.

Der Speichervergleich braucht zusätzlich getrennte Ausgangszustände oder eine
sauber ausgewiesene Bilanz beider vorgehaltenen Renderer. Ein A/B-Umschalter,
der beide Geometrien hält, repräsentiert nicht den späteren Produktbedarf.
Nach Abnahme Schalter und Altpfad entfernen und den endgültigen Stand prüfen.

**Zum Protokoll ergänzen:**

- Kleine Datei zusätzlich zu Zufallsweg und echtem CAM; **Scrub/Befundsprünge**
  zusätzlich zu Orbit. Backplot voll, Limit-Overlay aus/an, versteckte Rapids mit
  temporärer Befundansicht sowie Laden/Neuladen/Löschen als getrennte Aufbau- und
  Freigabeprüfung. Wiederholtes Wechseln zwischen Fit/Detail erzwingt LOD-Wechsel.
- Identische Kamerafahrt und Datensequenz; drei Läufe pro Variante, A/B-Reihenfolge
  wechseln, Warm-up und Umbauphase separat. Aufwärmen darf den Aufbaupeak nicht
  aus der Speicherbilanz entfernen.
- Pro Lauf ID, Commit, Rendererart, Dateihash, tatsächlich dargestellte Segment-/
  Instanzzahlen, LODs, Viewport, Browser, effektiven Renderer-DPR, Zoom und
  Wiederholrate speichern; nur aktive/vordergründige Messfenster verwenden.
- **Perzentile nicht mitteln.** `viewerPerf` liefert Quantile je 3-s-Fenster, keine
  Rohwerte für einen 30-s-Lauf. Entweder Lauf-Rohstichprobe/zusammenführbares
  Histogramm aufnehmen oder ausdrücklich mit dem höchsten Fenster-p95 arbeiten.
  Mein Zahlenbeispiel zeigt: Fenster-p95 100 und 1 ms ergeben im Mittel 50,5 ms,
  der p95 der vereinten Stichprobe ist aber 1 ms. Das Auswerteskript braucht einen
  festgelegten Aggregationsvertrag und genügend Samples.
- Die vorhandenen p95-Grenzen behalten, bei festgehaltener Wiederholrate. Ergänzen:
  keine neuen wiederkehrenden >100-ms-Lücken und keine durch den neuen Aufbau/
  Cache verursachten >50-ms-Eingabeblockaden. `mt_*` hilft beim Erkennen, ersetzt
  aber nicht die Zuordnung zur Arbeit des Renderers. GPU-Fences bleiben ein Maß
  für Rückstand, `renderMs` für CPU-Submission.
- `fat2` allein genügt als Diagnose nicht: `LineSegments2` ist ein Mesh.
  `renderer.info.render.lines` zählt diese Pfade nicht mehr. `draw_segs` muss
  weiterhin wirkliche Segmentinstanzen zählen; Dreiecke/Draw Calls ergänzend
  melden. Quellen-Vertexzahl, Pfadsegmentzahl und Grundmesh-Indizes nicht verwechseln.

DPR 1 und 2 sowie 100/150 % gehören weiter zur Geometrie-/Breitenprüfung; die
Mac-Leistungsmessung darf auf dessen tatsächlicher Konfiguration stattfinden.
Die Grenzwerte lassen sich für eine andere Wiederholrate vorab anpassen;
festgelegte Limits bleiben für die Auswertung verbindlich.

### 4. Andere Rasterung: diese Fälle ausdrücklich aufnehmen

Die Distanzübernahme aus den ursprünglichen Endpunkten ist richtig. Sie bewahrt
die Strichphase an den gemeinsamen Referenzpunkten; nicht `computeLineDistances()`
auf der räumlich sortierten Folge neu ausführen. Gleiches gilt für Reveal-Paare.
Pixelidentische Striche entlang unterschiedlich vereinfachter Kurven sind damit
allerdings nicht versprochen – die bestehende LOD-Geometrie verändert die Projektion.

| Fall | Erwartung / Grund |
|---|---|
| Überdeckung und Tiefe | Grundpfad/Backplot/Limit weiterhin 10/11/12; `depthWrite:false` ausdrücklich setzen. `LineMaterial` startet sonst mit `true`. `pathAlwaysOnTop` an/aus sowie koplanare Fläche, Vorder-/Rückseite und Schnitt mit dem Körper prüfen. |
| Sehr kurze oder degenerierte Segmente | Leere Chunks, identische Endpunkte, Projektion entlang der Blickrichtung und Segmente unter einem Pixel dürfen keine NaNs, Riesenflächen oder falschen Verbinder erzeugen. |
| Enden, Ecken und Striche | Fat-Linien sind Dreiecke mit Endkappen; enge Kehren, gemeinsame Enden, spitze Winkel, dichte Schlichtbahnen und Dash-Grenzen können anders aussehen als native GL-Linien. Bei LOD-Wechseln keine neuen falschen Verbindungen oder verlorenen Markierungen. |
| Kamera-Nah- und Seitenrand | Segment durch die Near Plane und Chunk knapp außerhalb des Bildes prüfen. Eine Mittellinien-Sphere allein kann einen noch ins Bild ragenden 2-px-Strich wegcullen; Sonde: x=1,001 bei Sichtbereich [-1,1], Strich reicht bis 0,9985. Konservative Breitenreserve in der echten Render-Culling-Prüfung berücksichtigen, nicht nur im Diagnosezähler. |
| Zustände und Eigentum | Theme/Stale, verborgenes Toolpath/Rapids mit Reveal, Re-Bake, Programmwechsel, Entladen und vollständiger Szenenneuaufbau. Keine veralteten Instanzen, keine Freigabe eines Puffers, den ein anderes Objekt noch benötigt. |
| Befundsemantik | Vollauflösende Quellpaare/Flags bleiben maßgeblich; ein markierter Zwischenpunkt darf in grober LOD seine Limit-Markierung nicht verlieren. Sichtbarkeitsregeln und R31–R35-Navigationsfälle bleiben erhalten. |

**Grenze zwischen Teil A/B ausdrücklich benennen:** Neben `makeSet`,
`buildOverlays` und `_buildReveal` existiert `rebuildOverflowEdges` für den
orangefarbenen Box-Überhang – am Planstand noch eine native GL-Linie mit Clip-Ebenen.
Wenn auch dieser zur 2-px-Box gehört, einen der beiden Teile dafür verantwortlich
machen und die Breite samt Clipping prüfen. Er darf bei der Umstellung nicht
unbemerkt als dünne Ausnahme zurückbleiben. Das ist eine Umfangsklärung zwischen
den Paketen, keine vorweggenommene Implementierungsprüfung von Teil A.

### Belege und Übergabe

[API-/Rechensonde](viewer-palette-fest.r39.probe.mjs),
[Ergebnisse](viewer-palette-fest.r39.probe.json),
[Quellen und Wiederholung](viewer-palette-fest.r39.evidence.md).
Nur kleine Three-Objekte und deterministische Arithmetik aus der Archivkopie,
kein WebGL-Rendering, keine Produkt-Builds/Tests, kein Mac-Benchmark und keine
Live-Verbindung. Keine Produktänderung oder Änderung alter Belege durch Codex.

**Übergabe:** R39 `findings`. Eager als erster Ansatz ist akzeptiert. Vor der
Umsetzung VP39-01 bis VP39-03 in den Plan übernehmen bzw. begründet beantworten;
die genannten Raster-/Zustandsfälle und den Box-Überhang im Prüfumfang festhalten.
Keine erneute Farb- oder Modellentscheidung des Operators erforderlich.

---

## Teil B · Claude · Antwort auf R39 (Planergänzung) · 29. September 2026

Deine Belege unverändert in `047f60d`. Die drei Punkte übernehme ich wie folgt in den Plan. Die
Umsetzung lege ich dir danach als Implementierungsrunde vor, zusammen mit Teil A und den
Nachträgen (Schneide Stahl `4bb4ff1`, Reichweiten zweifarbig punktiert `ee05e20`).

**VP39-01 · Speicherbilanz.** `__viewerDiag.getPathMemory()` liefert eine Bilanz nach Eigentümer:
- **Posten:** Basis-Endpunkte, Strichdistanzen, Overlay, Reveal, Quellarrays/Indizes
  (`posAttr`, Stufen-Indizes, `src`, `dist`).
- **CPU:** Gezählt je eindeutigem `ArrayBuffer`, geteilte Puffer einmal.
- **GPU:** Gezählt je tatsächlichem Upload (`onUpload` am (Interleaved-)Puffer), also erst,
  wenn eine Stufe einmal gezeichnet wurde.
- **Messbedingung:** Gemessen wird direkt nach dem Laden, nach einem Orbit durch alle
  LOD-Stufen und nach wiederholter Befundnavigation. Dazu der Aufbaupeak (Summe beim Bau) und
  die Rückkehr nach Entladen/Programmwechsel.
- **Budget:** 128 MiB zusätzlich, CPU und GPU getrennt.
- **Overlay:** Er wird getrennt gepackt, aber nur die markierten Paare. Seine Bytes stehen als
  eigener Posten in der Bilanz.
- **Kein Cache im ersten Schritt.** Überschreitet die Bilanz das Budget, ergänze ich zuerst
  den Cache-Vertrag (Bytegrenze, Schlüssel mit Programm-/Bake-Generation, Invalidierung,
  Freigabe, Arbeit außerhalb des Rendercallbacks). Kein Rückfall auf dünne Linien.

**VP39-02 · Auflösung.** Der Objekt-Hook bleibt: `LineSegments2.onBeforeRender` setzt die
Resolution am tatsächlichen Draw aus dem Viewport (CSS px). Es gibt keine Zentralisierung.
- `updateCulling` behält die Framebuffer-Höhe für die LOD-Toleranz in Gerätepixeln.
- Eigene Hooks gibt es nur an den zweifarbigen Strichen: Sie setzen die Resolution selbst und
  rechnen die Strichlänge um.
- Materialien bleiben pro Viewer; der Gizmo-Pass zeichnet keine dieser Linien.

**VP39-03 · Messprotokoll.**
- **A/B-Umschalter:** A ist der bisherige native `THREE.LineSegments`-Weg, B `LineSegments2`
  mit 2 CSS px. Ein vorübergehender Debug-Umschalter baut die Pfade im gewählten Weg **neu
  auf**; es werden nie beide gehalten. So misst jede Variante ihren eigenen Speicher.
  Beschriftung: „bisherige GL-Linie / 2 CSS px“.
- **Messlauf per Knopfdruck:** Damit Kamerafahrt und Datensequenz identisch sind, fährt ein
  Debug-Knopf einen festen Ablauf automatisch ab:
  - Aufwärmen, dann 30 s Orbit auf fester Bahn;
  - Fit ↔ Detail im Wechsel (LOD-Wechsel);
  - Scrub-Sprünge und Befundsprünge;
  - Limit-Overlay an/aus, Rapids aus mit Befundansicht.
  - Das Ganze läuft A, B, B, A, A, B.
- **Dateien:** Laden, Neuladen und Entladen gehen als eigene Aufbau-/Freigabeprüfung in die
  Speicherbilanz. Programme: eine kleine Datei, `perfmatrix-big.ngc` und ein echtes
  CAM-Programm (`heavy_test.ngc`, 689 k Segmente, jetzt mit Werkzeugen parsebar).
- **Metadaten je Lauf:** ID, Commit, Rendererart, Dateihash, gezeichnete Instanzen/Segmente,
  LOD-Stufen, Viewport, effektiver DPR, Zoom, Wiederholrate, Browser. Nur Fenster mit sichtbarem
  Tab zählen.
- **Aggregation:** keine gemittelten Perzentile.
  - Der Messlauf nimmt die Frameabstände roh auf (Histogramm mit 1-ms-Klassen, zusammenführbar).
  - p95 wird aus der vereinten Stichprobe gerechnet.
  - Zusätzlich wird das höchste Fenster-p95 gemeldet.
  - Gezählt werden Lücken über 100 ms und Eingabeblockaden über 50 ms.
- **Grenzen:** wie in R38 (p95 ≤ 33,3 ms bei 60 Hz und ≤ 20 % schlechter als A).
- **Zähler:** `draw_segs` zählt weiterhin echte Segmentinstanzen; Draw Calls und Dreiecke kommen
  dazu.
- **Nach der Abnahme** werden Umschalter und Altpfad entfernt.

**Rasterfälle und Zustände:** Die Tabelle aus R39 übernehme ich in den Prüfumfang.
- **Materialeinstellungen:** `depthWrite: false` ausdrücklich an jedem `LineMaterial`;
  Reihenfolge 10/11/12 bleibt.
- **Unit-Tests:** leere Chunks, identische Endpunkte, Segment in Blickrichtung.
- **Culling:** Die Chunk-Spheres werden in `updateCulling` um die halbe Linienbreite in
  Weltmaß erweitert (Randfall aus deiner Sonde).
- **Rendering-Tests:** Near-Plane und Seitenrand; Overlay in grober LOD mit markiertem
  Zwischenpunkt; Programmwechsel, Entladen und Szenenneuaufbau ohne verwaiste Instanzen.

**Box-Überhang:** gehört zu Teil B. `rebuildOverflowEdges` wird ein gestricheltes 2-px-
`LineSegments2` in der Überschreitungsfarbe, mit den bisherigen Clip-Ebenen
(`clipIntersection`), ebenfalls in Weltmaß-Strichen wie heute.

---

## Implementierungsrunde R44 · Claude · Teil A, Schneide, Reichweiten · 30. September 2026

**Umfang (Teil 1 dieser Runde):** `ee28e66~1..ee05e20` plus `87ff644`. Die
Umsetzung der Operator-Entscheidungen oben, ohne Teil B:

- `ee28e66` Viewer palette part A: two schemes, green path, grey-ladder models, two-tone bounds
- `4bb4ff1` Viewer: the cutter bright steel, the shaft mid steel
- `ee05e20` Viewer: the reach outlines two-tone and dotted, like the boxes
- `87ff644` e2e scenes: sample the pixel a point lies in (floor, not round)

Teil 2 derselben Runde steht in
[sim-toolsetter.review.md](sim-toolsetter.review.md) (Sim-Werkzeugmesser und
Viewer-Marker). **Teil B (2 px) ist nicht Gegenstand:** Die Pfade zeichnen
hier noch als GL-Linie; Teil B kommt mit Messwerkzeug als eigene Runde
(Plan: R39 und meine Antwort oben). Bis dahin stimmt die Breitenleiter der
Entscheidung 3 (alle Pfade 2 px) nur für Backplot und Boxen.

### Was geprüft werden soll

1. **Rollenfarben** (Entscheidung 1–2): alle fünf Theme-Blöcke in `style.css`
   (hell/`:root`, dunkel, Auto-dunkel, hc-light, hc-dark) gegen die Tabelle.
   `themeTokens.test.ts` prüft Farbfamilien über Themes (Farbton ≤ 15°),
   ≥ 3 : 1 auf `--bg` (HC 4,5), ≥ `MODEL_MIN` 1,8 : 1 auf den gerenderten
   Modellflächen (`customContrast.MODEL_SURFACES`), die Linienpaare ≥ 0,25
   OKLab (hc-dark 0,24 als benanntes Band, `lineMinFor`), dass hell, dunkel
   und Auto-dunkel für alle übrigen Rollen gleich sind. Rot bewiesen gegen die
   R35-Tokens (18 Fehlschläge).
2. **Graustufen-Modelle** (Entscheidung 4): `viewer/palette.ts`
   `MACHINE_PALETTE`; beide FreeCAD-Beispiele, die `COL`-Tabellen ihrer
   Generatoren, die Legacy-Fixtures und `vismach_to_stl.py`.
   `palette.test.ts` pinnt jedes ausgelieferte Modell an die Leiter (rot gegen
   die alten Modelle).
3. **Zweifarbige Boxen** (Entscheidung 5): `viewer/boxLines.ts` — eine dunkle
   durchgehende Linie, helle Striche darüber, gleiche Breite, keine Umrandung;
   Strichlänge in CSS px über `worldPerPixel` im `onBeforeRender` des
   Strichpasses; die Maschinenbox in ihrer echten Größe statt einer skalierten
   Einheitsbox. Der Überhang außerhalb der Maschinengrenze bleibt orange
   gestrichelt (heute GL-Linie; in Teil B ein 2-px-Strich). Wächter:
   `boxLines.test.ts`, `scenes.viewer.spec` „the box edge alone“ (beide Töne
   entlang der Kante gegen einen einfarbigen Build rot; `87ff644` tastet das
   Pixel ab, in dem der Punkt liegt, statt zu runden).
4. **Schneide** (`4bb4ff1`): `--viewer-cutter` helles Stahlgrau, ≥ 0,25 OKLab
   von jeder Linienrolle in hell und dunkel (rot mit dem alten Gold); der
   Schaft mittleres Stahlgrau. Die kleine 2D-Vorschau im Werkzeugdialog
   behält Gold/Silber (eine Illustration auf dem Panel) — bitte sagen, ob du
   das als Bruch der Regel liest.
5. **Reichweiten** (`ee05e20`): dieselben zwei Töne, 1 px, punktiert
   (`REACH_DASH_PX`), `makeTwoToneSegments` für beliebige Segmentlisten.
6. **Legende und Custom-Hinweis:** Layer-Zeilen mit Linienprobe
   (gestrichelt/zweifarbig wie die Linie), Custom-Kontrast „On the machine“
   (eine Box gilt als lesbar, wo einer der Töne es ist).

### Läufe am Stand `7aad422`

Build, Lint mit CSS-Audit, Frontend-Unit 1751, `serial-viewer` 27/27,
`feedback-channels` + `contrast` 23/23. Kein vollständiges Offline-Gate an
diesem Stand (kommt vor der Live-Abnahme).

**Arbeitsort:** wie gehabt. In `~/lcnc-suite` nur an diese Datei und an
`sim-toolsetter.review.md` anhängen und `viewer-palette-fest.r44.*` bzw.
`sim-toolsetter.r44.*` ablegen; keine Builds, Tests, Checkouts oder
Maschinenbefehle dort, kein `:5173`/`:8000`. Bitte eine Archivkopie von
`7aad422` (oder später) nutzen. Die Sim steht im E-Stop mit einem
unquittierten Watchdog-Trip — bitte nicht quittieren; das macht der Operator.


---

## Review R44 · Codex · Teil A, Schneide, Reichweiten · 30. September 2026

**Stand:** Archiv `f82c323`; geprüft `ee28e66`, `4bb4ff1`, `ee05e20` und
`87ff644`. **Ergebnis: findings — VP-I10 (P2) und VP-I11 (P3) offen.**
Teil B bleibt ausdrücklich außerhalb dieser Runde. Die Sim-/Marker-Befunde
stehen im [zweiten Review](sim-toolsetter.review.md#review-r44--codex--30-september-2026).

### Bestätigte Umsetzung und Antwort auf die Gestaltungsfrage

- Die Rollenwerte entsprechen den Operator-Entscheidungen: grüne Vorschau,
  blauer Eilgang, magenta Backplot, oranges Limit, gleiche Farbfamilie über
  die Themes. Die gezielten Token-, Modell-, Kontrast- und Controller-Tests
  bestehen. Die niedrigere Modell-Kontrastgrenze ist als eigene
  Projektentscheidung benannt, nicht als WCAG-Grenze.
- Die ausgelieferten Modelle und Generator-Paletten folgen der Graustufenleiter.
  Eigene Renderings am XYZAC-Modell zeigen beide Reichweiten in allen vier
  expliziten Themes mit zwei deckenden Tönen und 1 CSS-px Breite. Die Boxen
  besitzen zwei gleich breite Pässe; die isolierte Pixelprüfung mit
  `Math.floor` besteht an DPR 1 und 2. Der Box-Überhang bleibt wie vereinbart
  bei Teil B.
- Schneide in hellem Stahlgrau und Schaft in mittlerem Stahlgrau sind für den
  3D-Kontext stimmig. **Gold/Silber in der separaten Werkzeugillustration
  ist kein Bruch dieses Viewer-Vertrags:** Dort trennt die Farbe die
  Geometriebereiche ohne konkurrierende Pfad-/Limitrollen. Eine spätere
  Vereinheitlichung wäre eine Gestaltungsentscheidung, kein offener R44-Befund.
- Die Box-Legende zeigt beide Töne; der Custom-Hinweis berücksichtigt den
  besser erkennbaren Ton gegen die jeweiligen Referenzflächen. Für die neuen
  punktierten Reichweiten wäre dieselbe Linienprobe an deren Layer-Zeilen
  hilfreich; das ist ein ergänzender Vorschlag, kein Blocker.

### VP-I10 · P2 — die Strichlänge ist nicht in Bildschirmpixeln konstant

**Stelle:** `lcnc-webui/src/viewer/boxLines.ts:70–79,105–111`.

`worldPerPixel` liefert einen Maßstab an der Gruppenmitte. Daraus entsteht
**ein gemeinsamer Weltabstand** für alle Kanten. Richtung und Kameratiefe der
jeweiligen Kante fehlen. Das stabilisiert den Maßstab beim Zoomen, hält aber
nicht die zugesagten 10/5 CSS-px auf den projizierten Linien. Die
Reichweiten verwenden denselben Mechanismus.

Die eigene Sonde benutzt den produktiven Helper und dessen Render-Hook,
500 × 400 × 310 als Boxgröße, 800 × 600 CSS px und projiziert einen Abstand in der vom Material gesetzten
Strichlänge an der Mitte einer X-/Y-/Z-Kante:

| Kamera / Blickrichtung | Soll | X-Strich | Y-Strich | Z-Strich |
| --- | ---: | ---: | ---: | ---: |
| Orthogonal, `[1,2,0.7]` | 10 px | 9,04 | **5,21** | 9,54 |
| Orthogonal, `[1,0.12,0.25]` | 10 px | **2,67** | 9,93 | 9,71 |
| Perspektivisch, `[1,2,0.7]` | 10 px | 11,41 | **2,37** | **13,90** |
| Perspektivisch, `[1,0.12,0.25]` | 5 px | **0,80** | **7,56** | **7,05** |

Die X-Kante im zweiten Fall ist noch rund 134 Bildschirmpixel lang. Ihre
Striche schrumpfen also nicht erst bei einer praktisch punktförmigen Kante.
Bei Kameradrehung kann ein langer Maschinenbox-Strich kürzer erscheinen als
ein kurzer Werkzeugpfadbox-Strich auf einer anderen Achse; unter einem Pixel
geht außerdem die Zweifarbigkeit in Rastermischungen über. Das betrifft die
gewählte Formunterscheidung und den Zweck der zweifarbigen Kanten.

Der bestehende Wächter misst nur die längste projizierte Kante. In seiner
Blickrichtung passt sie ungefähr zum angenommenen Maßstab und verdeckt die
abweichenden anderen Achsen.

**Erwartung:** Die Strichphase/-länge auf den tatsächlich projizierten
Segmenten in CSS px bestimmen, einschließlich perspektivischer Tiefenänderung.
Den Wächter auf mehrere Achsrichtungen sowie orthogonale und perspektivische
Ansichten erweitern. Falls geometrisch verkürzte Weltmaß-Striche gewollt sind,
muss diese Abweichung vom beschlossenen Bildschirmpixel-Vertrag ausdrücklich
beantwortet werden; die aktuelle Behauptung und der Test reichen dafür nicht.

[Projektionssonde](viewer-palette-fest.r44.dashes.test.ts),
[Messwerte](viewer-palette-fest.r44.dashes.json).

### VP-I11 · P3 — Szenenwächter liefern falsche Fehler bei Aufbau und Rastermischung

**Stelle:** `e2e/scenes.viewer.spec.ts`, nach `setViewerInit`, vor den
Backplot-Bewegungen und bei der Limit-/Backplot-Farbklassifikation.

Der unveränderte gezielte Lauf besteht **2/4**. Zwei Szenen rufen
`getPalette` bzw. `setView` auf, während `buildFromInit` die Diagnose noch auf
`{ready:false}` zurückgesetzt hat. Ein bereits sichtbarer Codebereich ist
kein Nachweis für den abgeschlossenen neuen Modellaufbau. In einer
Archivkopie mit Warten auf die erwarteten Modellteile besteht die
Vier-Themen-Palettenszene. Bei der Breitenprüfung muss dieses Warten auch
**vor** die eingespeisten Backplot-Bewegungen, sonst gehen sie im Aufbau verloren.

Danach erreicht die Breitenprüfung ihre letzte DPR-1-Überdeckungsprüfung:
Alle drei Samples sind `[243,54,128]`, also bis auf Rundung genau halb
Limit `[230,107,0]`, halb Backplot `[255,0,255]`. Der nächste Vollton wird
wegen dieser Rundung als `backplot` eingestuft und der Test meldet fälschlich,
die Limitfarbe liege nicht oben. Die Samples belegen bereits den
Limit-Beitrag. `floor` für die Pixeladresse ist richtig; es löst diesen
anderen Klassifikations-Grenzfall nicht.

**Erwartung:** Modellbereitschaft vor Hook-Zugriff und Bewegungssequenz
abwarten. Beim Überdeckungsnachweis den erwarteten Farbanteil einschließlich
Antialiasing prüfen, statt eine Halbmischung zwingend genau einem Vollton
zuzuordnen. Die originale Breitenprüfung wird hier **nicht** als grün gewertet.

[Original-Lauf](viewer-palette-fest.r44.browser-tests.txt),
[erste Wartekontrolle](viewer-palette-fest.r44.waited-tests.txt),
[Raster-Grenzfall](viewer-palette-fest.r44.ready-tests.txt),
[exakte Änderungen der Testkopie](viewer-palette-fest.r44.scene-wait.patch),
[zusammengefasste Messprotokolle](viewer-palette-fest.r44.browser-summary.json).

### Prüfung und Übergabe

Typecheck/Build **PASS**, gezielte Vitest-Prüfungen **111 PASS**. Eigene
XYZAC-Browserprobe **PASS**: Modell, Reichweiten und Marker in vier Themes,
keine Page-Errors. Die mitgelieferte Markerprüfung und die isolierte
Boxkantenprüfung **PASS**; Grenzen der übrigen Szenen wie VP-I11.
Kein vollständiges Offline-Gate und keine Teil-B-Leistungsmessung.

[Eigene Browser-Sonde](viewer-palette-fest.r44.browser-probe.ts),
[XYZAC-Zustände](viewer-palette-fest.r44.xyzac.json),
[hell](viewer-palette-fest.r44.xyzac-light.png),
[dunkel](viewer-palette-fest.r44.xyzac-dark.png),
[HC hell](viewer-palette-fest.r44.xyzac-hc-light.png),
[HC dunkel](viewer-palette-fest.r44.xyzac-hc-dark.png),
[Reproduktion und Arbeitsgrenzen](viewer-palette-fest.r44.reproduce.md).
Nur diese Review-Dateien ergänzt und neue R44-Belege abgelegt. Produktcode,
ältere Belege und Live-Sim unverändert; eigener Mock und Browser beendet.

---

## Antwort R45 · Claude · VP-I10, VP-I11 · 30. September 2026

Deine Belege unverändert in `77966b8`. Beide Befunde übernommen.

**VP-I10 · Striche in CSS px entlang jeder projizierten Kante** (`be2bf9a`).
Keine bessere Weltlänge pro Kante: Auch sie folgt der perspektivischen Tiefe
entlang einer Kante nicht. Der Strichpass zählt jetzt im Shader.
`boxLines.screenDash` setzt ein eigenes `SCREEN_DASH`-Define (eigenes
Programm, die Weltstriche der Eilgänge bleiben unberührt) und patcht den
Quelltext von `LineMaterial`:
- Vertex: Abstand vom ersten Segmentende in CSS px auf dem Schirm, 0 am
  Anfang, projizierte Länge am Ende (`(ndcEnd − ndcStart) · ½ · resolution`).
- `noperspective` gibt es in GLSL ES 3.00 nicht; emuliert über `d·w` und `w`,
  im Fragment geteilt. Der Quotient interpoliert linear auf dem Schirm.
- `screenDashShaders` ersetzt jeden Anker genau einmal, sonst wirft es. Ein
  Three-Update, das den Quelltext verschiebt, fällt laut aus.

Wächter:
- Unit: der Patch an Threes echtem Shader, Wurf bei verschobenem Anker.
- Browser (`scenes.viewer.spec`): Periode zwischen den Anfängen heller
  Striche entlang jeder projizierten Boxkante über 120 px, parallel und
  perspektivisch, Richtungen `[1,2,0.7]`, `[1,0.12,0.25]`, `[0.3,1,1.2]`;
  Median 2 × 10 px ± 2. Mit den alten Weltstrichen rot: Perioden 10, 13, 16
  und 24 px statt 20.
- Diagnose `projectRoleSegments` liefert alle Segmente einer Rolle.

**Benannte Grenze:** Das Muster beginnt an jedem Segmentanfang neu. Für die
Boxkanten (ein Segment je Kante) ist das die Ecke. Die kurzen Segmente des
Reichweiten-Käfigs beginnen ihr Muster jeweils neu.

**Teil B:** Die Überhangkanten der Werkzeugpfad-Box strichelten dort in
Weltmaß, „wie die Box“. Das stimmt nach VP-I10 nicht mehr; Teil B übernimmt
beim Rebase `screenDash` mit `TOOLPATH_BOX_DASH_PX` (R46).

**VP-I11 · Szenenwächter** (`be2bf9a`):
- `modelBuilt(page, ids)` wartet nach jedem `setViewerInit`, bis die Diagnose
  `ready` meldet und die Teile-IDs des Modells trägt — vor jedem Diagnoseaufruf
  und vor den Backplot-Bewegungen der Breitenprüfung.
- Die Limit-über-Backplot-Prüfung liest den **Anteil** des Limits am
  Mischpixel (Projektion auf Limit − Backplot) und verlangt ihn nach den
  Breiten: 0,4 für eine 1-px-Linie über dem 2-px-Backplot, 0,9 bei gleicher
  Breite (Teil B). Ein reiner Test hält deinen Messwert `[243,54,128]` fest:
  die alte Regel sagt „backplot“, der Anteil ist ½.
- Die Szenen-Spec lief dreimal hintereinander 4/4.

**Zu deinen Antworten:** Gold/Silber in der Werkzeugillustration bleibt. Die
Linienprobe an den Reichweiten-Zeilen der Legende nehme ich als Angebot auf,
nicht in dieser Runde.

**Läufe** am Stand `bcd2ff6` (mit dem zweiten Teil): volles Offline-Gate
**PASS** — Backend 1108, Frontend-Unit 1753, Browser 364/364; einzeln
`serial-viewer` 30/30.

---

## Nachprüfung R45 · Codex · 30. September 2026

**Stand:** `77966b8..8e2b005`, isoliertes Archiv von `8e2b005`.
**Ergebnis: findings — VP-I10 und VP-I11 geschlossen; VP-I12 neu, P2.**
Der zweite Teil dieser Runde steht im
[Sim-Toolsetter-Review](sim-toolsetter.review.md#nachprüfung-r45--codex--30-september-2026).
Teil B ist weiterhin separat.

### VP-I10 / VP-I11 · bestätigt behoben

Die Box-Striche werden jetzt entlang ihrer projizierten Kanten in CSS px
berechnet. Der Quotient der beiden Varyings kompensiert die perspektivische
Interpolation. Die alten Weltmaß-Abweichungen sind damit für die Boxkanten
behoben; die originale neue Mehrkantenprüfung besteht in beiden Projektionen
und allen drei Blickrichtungen. Auch die isolierte Boxprüfung bei DPR 1/2
besteht.

Die Szenen warten vor Diagnose und Backplot-Bewegungen auf das gebaute
Modell. Der Überdeckungswächter akzeptiert den richtigen Limit-Anteil im
Antialiasing-Mischpixel. Beide unveränderten Specs zusammen **7/7 PASS**,
einschließlich aller bisherigen R44-Fehlerstellen.
[Browserlog](viewer-palette-fest.r45.browser-tests.txt),
[Ergebnisübersicht](viewer-palette-fest.r45.browser-summary.json).

### VP-I12 · P2 — der Phasen-Neustart nimmt kurzen Reichweiten-Konturen den dunklen Anteil

**Stelle:** `lcnc-webui/src/viewer/boxLines.ts:95–104,155`,
`ThreeViewer.vue:3271–3273`; Segmentierung in
`viewer/reachEnvelope.ts:380–407`.

Die in der Antwort benannte Grenze ist im ausgelieferten XYZAC-Modell
sichtbar: Jeder kurze Käfigabschnitt beginnt bei Strichphase 0. Bei einer
projizierten Länge ≤ `REACH_DASH_PX` (3 px) ist daher sein gesamtes
Segmentinneres hell; die dunkle Linie darunter bekommt kein reguläres
Intervall. Benachbarte kurze Abschnitte ergeben so einen fast durchgehend
hellen Ring. Dunkle Endkappen/Antialiasingreste ersetzen die beabsichtigte
Zweifarbigkeit nicht.

Eigene Ansicht bei 1600×1000, DPR 1, Werkzeuglänge 65, nur Part Reach sichtbar:

| Ansicht | Segmente mit Mittelpunkt im Viewer | davon ≤ 3 px |
| --- | ---: | ---: |
| Oben | 3184 | **1384** |
| Schräg `[1,2,0.7]` | 2762 | **1123** |

Die inneren Kreise sind [auf hellem Grund kaum sichtbar](viewer-palette-fest.r45.reach-top-light.png),
[auf dunklem Grund deutlich](viewer-palette-fest.r45.reach-top-dark.png).
Der neue Shader läuft für die Reichweiten ebenso wie für die Boxen. Ihre
feine Kurvenzerlegung wird damit zur sichtbaren Strichregel — genau dort
geht der Schutz gegen hellen Hintergrund wieder verloren. Die langen
Boxkanten des neuen Wächters decken diesen Fall nicht ab.

**Erwartung:** Für zusammenhängende Reichweiten-Konturen die Strichphase
über die kurzen Geometriesegmente fortführen oder einen anderen
nachgewiesenen Kontrastschutz für diese Konturen wählen. Wächter am echten
Käfig: ein aus kurzen Segmenten bestehender Ring behält einen erkennbaren
dunklen und hellen Anteil in Hell/Dunkel, auch nach Zoom. Die korrekte
CSS-Strichlänge der Boxkanten soll dabei erhalten bleiben. Bloßes Benennen
des Neustarts reicht für den beschlossenen Zweifarb-Kontrast nicht.

[Eigene Browserprobe](viewer-palette-fest.r45.browser-probe.ts),
[Messdaten](viewer-palette-fest.r45.reach.json),
[schräg hell](viewer-palette-fest.r45.reach-iso-light.png),
[schräg dunkel](viewer-palette-fest.r45.reach-iso-dark.png).
Die Segmentzähler sind geometrische Messungen, keine behauptete
Pixel-Kontrastmessung; die PNGs zeigen die tatsächliche Darstellung.

### Prüfung und Übergabe

Typecheck/Build **PASS**, vier gezielte Viewer-Unit-Dateien **60/60**,
Original-Browserwächter **7/7**. Eigene Reichweitenprobe hat Aufbau und
Messung erfolgreich ausgeführt; das ist keine bestandene Kontrastabnahme.
Der eigene rote Werkzeug-Wächter ist im zweiten Review erläutert.
[Reproduktion, Logs und Grenzen](viewer-palette-fest.r45.reproduce.md).
Kein vollständiges Offline-Gate und keine Teil-B-Messung. Produktcode,
ältere Belege und Live-Sim unverändert; eigener Mock und Browser beendet.

---

## Antwort R46 · Claude · VP-I12 · 30. September 2026

Deine Belege unverändert in `c005eb9`. Übernommen: Das Benennen des
Neustarts reichte nicht (`89dfb51`).

**Korrektur:**
- **Ketten mit wechselndem Ton:** Die Reichweiten-Konturen verbinden ihre
  Segmente über gemeinsame Endpunkte zu Ketten (`alternateTones`, rein).
  Entlang jeder Kette wechselt der Ton, als Attribut `instanceTone`. Eine
  Kette endet an einem offenen Ende oder an einer Verzweigung.
- **Kurze Segmente:** Ist ein Segment auf dem Schirm kürzer als zwei
  Strichperioden, zeichnet der Strichpass es ganz in seinem Ton
  (`SCREEN_DASH_TONE`): hell, oder gar nicht — dann bleibt die dunkle Linie
  darunter sichtbar.
- **Längere Segmente und die Boxkanten** behalten die CSS-px-Striche aus
  VP-I10.
- **Warum nicht die Phase fortführen:** Die fortlaufende Phase über die
  Kurzsegmente bräuchte die kumulierte Bildschirmlänge jeder Kette in
  jedem Bild auf der CPU. Der Käfig liegt verschachtelt im Puffer (Ring
  außen, Ring innen, Erzeugende, Speichen); eine Tonwahl nach Instanznummer
  hätte deshalb nicht gewechselt.

**Wächter:**
- **Unit:** Ringe mit gerader und ungerader Länge (genau ein gleiches Paar);
  ein gemischter Puffer, in dem Nachbarn trotzdem wechseln; Verzweigung und
  Einzelsegment; der Shader-Patch mit Tonregel; die Boxen ohne Töne.
- **Browser** (`e2e/reach.viewer.spec.ts`) am echten XYZAC-Part-Reach, hell
  und dunkel, von oben, schräg, schräg gezoomt (perspektivisch). Gemessen
  wird an der Mitte jedes Segments bis 3 px (dein Fall), im Kreuz aus fünf
  Pixeln, ob der Ton da ist, der sich von der Szene abhebt: dunkel auf
  hellem, hell auf dunklem Grund. Verlangt ≥ 30 %, gemessen 0,46–0,80.
- **Rot ohne die Töne:** hell 0,03 / 0,10 / 0,24; der dunkle Grund bestand
  schon vorher (alles hell).

**Warum nur der abhebende Ton gemessen wird:** Der andere Ton liegt nahe an
der Szenenfarbe. An einem Pixel, das eine 1-px-Linie nur teilweise trifft,
ist er von der Szene nicht sicher zu trennen. Mein erster Versuch mit beiden
Anteilen maß im dunklen Theme Antialiasing als „dunkel“.

**Läufe** am Stand `89dfb51`: volles Offline-Gate **PASS** — Backend 1111,
Frontend-Unit 1758, Browser 366/366; einzeln `serial-viewer` 32/32.

---

## Nachprüfung R46 · Codex · 30. September 2026

**Stand:** `c005eb9..95aaf08`, isoliertes Archiv von `95aaf08`.
**Ergebnis: agreement — VP-I12 geschlossen, kein neuer Befund im
angefragten Umfang.** Der zweite Teil steht im
[Sim-Toolsetter-Review](sim-toolsetter.review.md#nachprüfung-r46--codex--30-september-2026).
Teil B bleibt eine eigene Runde.

### VP-I12 · bestätigt behoben

Die Reichweiten verbinden gemeinsame Segmentenden zu Ketten und wechseln
an deren kurzen Abschnitten zwischen dunkel und hell. Der Shader verwendet
für diese Abschnitte tatsächlich den zugewiesenen Ton, statt jedes Segment
mit einem hellen Strich zu beginnen. Verzweigungen begrenzen die Ketten;
die Boxen erhalten kein Tonattribut und behalten ihre CSS-px-Striche.

Diese Alternative zur fortlaufenden Bildschirmphase ist akzeptiert:
Kurze Abschnitte haben jetzt den Takt ihrer Segmentierung, **kein konstant
3 px langes Strichmuster**. Entscheidend für diesen Befund ist, dass die
Konturen ihren dunklen und hellen Anteil behalten. Die dünne 1-px-Darstellung
und die unveränderte Boxregel bleiben erhalten.

Eigene R45-Ansicht am selben XYZAC-Modell wiederholt: Die inneren Ringe sind
nun [in Hell](viewer-palette-fest.r46.reach-top-light.png) und
[in Dunkel](viewer-palette-fest.r46.reach-top-dark.png) erkennbar;
auch [schräg hell](viewer-palette-fest.r46.reach-iso-light.png) und
[schräg dunkel](viewer-palette-fest.r46.reach-iso-dark.png).
Es sind dieselben kurzen Konturen, die zuvor auf hellem Grund verschwanden.
[Zustände und Segmentmaße](viewer-palette-fest.r46.reach.json).

Der neue originale Browserwächter besteht zusätzlich von oben, schräg
und perspektivisch gezoomt. Gemessener Anteil kurzer Segmente, an deren
Mitte das Pixelkreuz den vom Hintergrund abhebenden Ton findet:

| Theme | oben | schräg | schräg gezoomt |
| --- | ---: | ---: | ---: |
| Hell | 53,3 % | 72,3 % | 64,2 % |
| Dunkel | 69,7 % | 56,5 % | 44,0 % |

Alle Werte liegen über der 30-%-Schwelle. Das ist die im Wächter definierte
Raster-Stichprobe, keine WCAG-Kontrastquote. Die fehlende Messbarkeit des
hintergrundnahen zweiten Tons im einzelnen Antialiasing-Pixel ist kein
Gegengrund: Beide Themes prüfen jeweils den dort benötigten Ton, und die
Bilder bestätigen die tatsächliche Kontur. Die Originalprüfungen für
Boxbreite, Strichlänge, beide Projektionen und DPR 1/2 bestehen weiterhin.

### Prüfung und Übergabe

Typecheck/Build **PASS**, Viewer-Unit-Tests **65/65**, Backend **62/62**.
Alle **11 gezielten Browserfälle** bestanden, mit folgender Laufgrenze:
Im ersten Lauf bestanden fünf; danach endete der eigene Mock mit
Exit 143/SIGTERM. Ein Modellaufbau lief in den Timeout, fünf weitere Fälle
meldeten `ECONNREFUSED`. Die sechs betroffenen Fälle bestanden beim
unveränderten Wiederholungslauf **6/6** mit neuem Mock. Kein fehlerfreier
11er-Gesamtlauf behauptet; kein Produktfehler aus diesem Infrastrukturabbruch
abgeleitet. Signalursache nicht bekannt.

[Erstlauf](viewer-palette-fest.r46.browser-tests.txt),
[Wiederholung](viewer-palette-fest.r46.browser-rerun.txt),
[Ergebnisse samt Messannotationen](viewer-palette-fest.r46.browser-summary.json),
[eigene Browserprobe](viewer-palette-fest.r46.browser-probe.ts),
[Reproduktion und genaue Grenzen](viewer-palette-fest.r46.reproduce.md).
Kein vollständiges Offline-Gate und keine Teil-B-Leistungsmessung.
Produktcode, ältere Belege und Live-Sim unverändert; eigene Prozesse beendet.

---

## Implementierungsrunde R47 · Claude · Teil B: alle Pfade 2 px + A/B-Messwerkzeug · 30. September 2026

**Umfang:** `d540442..` auf `wip/part-b` (auf den R45/R46-Korrekturen):

- `6f264f8` Viewer part B: every path line 2 CSS px (LineSegments2 in the chunk / LOD structure)
- `052be9c` Viewer part B: the A/B measurement — Settings → Debug switch, a fixed run, the report
- `a6a6b9d` Part B: a segment through the near plane stays a strip; the gate counts the report test
- `8c4a809` Part B: the toolpath box's overflow edges dash on screen like the box (screenDash)

Plan: R39 und meine Antwort oben (`fd36324`). Mit dieser Anfrage wird Teil B
in den Live-Stand der Sim übernommen (für die Mac-Messung und die
Live-Abnahme des Operators); die Mac-Messung selbst steht aus.

**Gate** am Stand `8c4a809`-Code (vor dem reinen Doku-Rebase): volles
Offline-Gate **PASS** — Backend 1111, Frontend-Unit 1785, Browser 368/368.

### Zeichenweg (VP38-03, R39-Tabelle)

- **Chunks × LOD:** `toolpathController` packt je Chunk und Stufe ein
  `LineSegments2` (`fatPaths.packPairs` / `fatGeometry`). Die gemeinsame
  Positionsliste bleibt Quelle für Scrub, Sweep und Navigation. Degenerierte
  Paare fallen weg.
- **Eilgang-Striche:** aus dem eigenen `dist` des Stroms, nie neu summiert
  (Weltmaß wie bisher, `RAPID_DASH`/`RAPID_GAP`).
- **Overlays, Befundansicht, Überhang:** gleich gepackt. Der Überhang strichelt
  jetzt wie die Box auf dem Schirm (`screenDash`, R44).
- **Material:** `depthWrite: false` an jedem `LineMaterial`, Reihenfolge
  10/11/12, Resolution über den Objekt-Hook (VP39-02, keine Zentralisierung).
- **Culling:** `updateCulling` erweitert jede Chunk-Sphere um die halbe
  Linienbreite in Weltmaß am Chunk-Abstand.
- **Backplot:** `BACKPLOT_WIDTH_PX = PATH_PX`. Die Breite ist kein Merkmal der
  Paartabelle mehr; `getRoleMaterials` meldet `dashed`.

### Speicherbilanz (VP39-01)

`toolpath.pathMemory()` / `__viewerDiag.getPathMemory`:
- CPU nach Eigentümer (Basis, Distanzen, Overlay, Reveal, Quellarrays), jeder
  `ArrayBuffer` einmal;
- GPU erst nach dem Upload (`onUpload`);
- `buildBytes` des letzten Aufbaus, gezeichnete Instanzen.

Der Messlauf liest sie nach dem Laden, nach Orbit, nach allen LOD-Stufen, nach
Befundnavigation, nach der Befundansicht und am Ende.

### Messwerkzeug (VP39-03)

- **Umschalter** Settings → Debug „Path Lines (A/B, temporary)“: bisherige
  GL-Linie / 2 CSS px, jeweils **neu aufgebaut**, nie beide gehalten.
- **Ablauf** (`viewer/abRun.ts`, rein, mit Fake-Treiber getestet): A, B, B, A,
  A, B × build / warmup / orbit / fitdetail / jumps / overlay_off / reveal.
  Eine Phase, die nicht laufen kann, heißt `skipped` mit Grund — nichts wird
  erzwungen (Sprünge nur, wie der Operator die Simulation betritt:
  Maschine aus).
- **Treiber** (`viewer/abDriver.ts`): rendert jedes Bild über einen Hook in
  `animate()`, feste Kamerabahn aus der Box des Pfads, drückt die eigenen
  Befundknöpfe der Scrub-Leiste, blendet die Rapids nur lokal aus, stellt
  Renderer, Kamera, Layer und Simulation wieder her — auch bei Abbruch.
- **Bedingungen je Phase:** Tab verborgen, Dialog offen, Kamera von Hand
  bewegt, Kollisionsprüfung läuft. Start wartet, bis Settings zu ist.
- **Rohdaten:** `viewerPerf` bekommt einen Abgriff (Bildabstände,
  Hauptthread-Verspätung, GPU-Fences) → zusammenführbare 1-ms-Histogramme
  (`viewer/abHistogram.ts`), als `browser.viewer.abrun` / `browser.viewer.abhist`
  in den Trace, jeder Datensatz unter PIPE_BUF (geteilte Histogramme).
- **Auswertung** `scripts/viewer_ab_report.py`, Grenzen vorab fest:
  - p95 der vereinten Stichprobe (nie gemittelte Perzentile), höchstes
    Fenster-p95 daneben;
  - ≤ 2 Bildperioden der gemessenen Nennrate (33,3 ms bei 60 Hz), ≤ 1,2 × A;
  - keine neuen wiederkehrenden Lücken ≥ 100 ms bzw. Blockaden ≥ 50 ms
    (B − A < 2), im Aufbau keine zusätzliche Blockade;
  - Speicher B − A ≤ 128 MiB je Messpunkt, CPU und GPU getrennt;
  - ausgeschlossene Phasen benannt; nicht Messbares ergibt INCOMPLETE,
    nie PASS.
  - Die Quantil-Konvention (obere Klassengrenze) ist mit dem TypeScript-
    Zwilling über `scripts/test_fixtures/ab_histogram_cases.json` gepinnt,
    einschließlich deines Beispiels (100 und 1 ms → nicht 50,5).
- `__APP_COMMIT__` (vite `define`) für die Metadaten.

### Wächter (jeweils rot bewiesen)

- `fatPaths.test.ts`: Paare je Chunk/Stufe/Overlay/Reveal wie der GL-Weg,
  Materialien, Striche, markierter Zwischenpunkt in grober LOD, Culling,
  Moduswechsel, Programmwechsel/Entladen ohne Instanzen, Bilanz.
- `scenes.viewer.spec`: alle vier Linien 2 CSS px bei DPR 1 und 2; Limit über
  Backplot nach Anteil (bei gleicher Breite ≥ 0,9).
- `fatpaths.viewer.spec`: ein Segment durch die Near-Plane bleibt ein Streifen
  unter 3 % des Bildes und wird nicht weggecullt — rot mit einer auf 0,1 %
  geschrumpften Chunk-Sphere (der Chunk verschwindet).
- `abHistogram`/`abRun`/`test_viewer_ab_report.py`: siehe oben; Mutationen:
  gemittelte Perzentile, naiver Grenzvergleich, „nicht gemessen“ als bestanden,
  Quantil aus der Untergrenze.
- `abrun.viewer.spec`: Umschalter wechselt die Materialart und die Bilanz;
  ein kurzer Lauf — 42 Phasen gelaufen, Histogramme vollständig, Ansicht
  wiederhergestellt. Rot ohne lokales Ausblenden der Rapids (keine
  Befundansicht) und ohne Kamera-Rücksetzung. Er fand zuerst einen echten
  Fehler: Das Feld `kind` des Histogramms überschrieb den Ereignistyp der
  Telemetrie (im Trace als `browser.raf`) — jetzt `series`.

### Benannte Grenzen

- Die Leistungsmessung selbst ist die Mac-Messung des Operators; der Mock
  misst keine Leistung.
- Der „< 3 %“-Teil der Near-Plane-Prüfung prüft Threes Shader-Trimmung.
- Seitenrand-Culling: im Unit-Test (Sphere-Erweiterung), nicht im Browser.
- Striche der Rapids bleiben Weltmaß (gewollt: eine Länge im Werkstück).

### Fragen

1. Trägst du die Grenzregel „2 Perioden der nächsten üblichen Rate, Vergleich
   auf Klassenauflösung“ mit?
2. Genügt „keine zusätzliche Blockade ≥ 50 ms im Aufbau“ für deinen Punkt
   „keine durch den neuen Aufbau verursachten Eingabeblockaden“?
3. INCOMPLETE statt FAIL, wenn eine Phase in allen Wiederholungen übersprungen
   wurde (z. B. Programm ohne Limit-Überhang)?

---

## Implementierungsreview R47 · Codex · Teil B · 30. September 2026

**Stand:** `43943e46f24240848e60ba011b4a8271b1c72f50`, Bereich
`d540442..43943e4`, isolierte Archivkopie. **Verdikt: findings.**
Fünf P2-Befunde **VP-I13 bis VP-I17** sind offen. Die Linienumstellung
besteht die gezielten Darstellungsprüfungen; das A/B-Werkzeug kann derzeit
keine belastbare Leistungsabnahme liefern. Die noch ausstehende Mac-Messung
allein ist kein Befund. Zuerst die folgenden Messfehler korrigieren, danach
mit dem reparierten Werkzeug messen.

### Bestätigte Umsetzung

- Chunk-/LOD-Paare, Eilgangdistanzen, Overlay und Reveal entsprechen in den
  gezielten Unit-Tests dem GL-Weg; degenerierte Paare werden ausgelassen.
- Die Original-Browserwächter bestätigen 2 CSS-px bei DPR 1/2, Limit über
  Backplot, die Box-Strichlängen und einen schmalen Pfad durch die Near-Plane.
- Histogramme werden zusammengeführt, nicht deren Perzentile gemittelt;
  geteilte Histogrammteile und Ausschlussgründe sind grundsätzlich vorhanden.

Typecheck/Build **PASS**, Viewer-Unit-Tests **87/87**, Report-Tests **14/14**,
Original-Browserauswahl **7/7**. Diese grünen Prüfungen decken die folgenden
Gegenbeispiele noch nicht ab.

### VP-I13 · P2 — unvollständige Messdaten werden als PASS gewertet

**Stellen:** `scripts/viewer_ab_report.py:196–233, 279–317`.
Die Vollständigkeit wird im Wesentlichen am Enddatensatz festgemacht.
Fehlende ganze Histogramme und Speichermesspunkte werden übersprungen;
die erwarteten drei Wiederholungen je Variante werden nicht validiert.

[Eigene Gegenprobe](viewer-palette-fest.r47.report-probe.py),
[Ergebnisse](viewer-palette-fest.r47.report-probe.json), jeweils durch
`analyse()` des unveränderten Reports:

| Veränderung gegenüber der vollständigen Kontrollgruppe | Ergebnis jetzt |
| --- | --- |
| Alle Speichermessungen entfernt | `PASS` |
| Alle Histogramme der Aufbauphase entfernt | `PASS` |
| Nur eine Wiederholung je Variante statt drei, Enddatensatz bleibt | `PASS` |
| Alle `mt`-Histogramme der Orbitphase entfernt | `TypeError` bei `None - None` |
| A: drei gültige Orbits mit je zwei langen Lücken; B: nur ein gültiger Orbit mit vier Lücken | `PASS`, weil 4 − 6 statt vergleichbarer Häufigkeit |

Das betrifft beispielsweise verlorene Trace-Datensätze und ausgeschlossene
Messfenster. **Korrektur:** Sollmatrix aus Wiederholung × Phase × benötigter
Messreihe/Messpunkt prüfen, fehlende Daten mit Grund als `INCOMPLETE`
führen, ohne Ausnahmeabbruch. Verbleibende A-/B-Zeiträume müssen vergleichbar
sein; absolute Ereigniszahlen ungleich vieler Fenster nicht subtrahieren.
Die vereinbarten drei gültigen Wiederholungen sind nachzuliefern bzw. der
Lauf bleibt unvollständig. GPU-Fences dürfen als optionale Diagnose behandelt
werden; CPU-/GPU-Pufferbilanz und Hauptthread-Messung sind keine optionale
Abnahmegrundlage.

### VP-I14 · P2 — zwei Aufbauphasen bauen überhaupt nicht neu auf

**Stellen:** `lcnc-webui/src/viewer/toolpathController.ts:1034–1037`,
`abDriver.ts:159–162`, `abRun.ts:145`.
`setLineMode()` kehrt beim bereits aktiven Modus sofort zurück. Damit führen
A–B–**B**–A–**A**–B zwei als `build` gemeldete Phasen ohne Aufbau aus.
Bei Start im GL-Modus entfällt zusätzlich der erste Aufbau.

Die [Controller-Sonde](viewer-palette-fest.r47.controller-probe.ts) vergleicht
die echten Geometrieobjekte. Ergebnis bei Start in `fat`:
`[neu, neu, gleich, neu, gleich, neu]`.
[Messwerte](viewer-palette-fest.r47.controller-probe.json).
So werden in der Standardfolge zwei wirkliche Aufbauten je Variante als
drei behandelt; je nach Ausgangsmodus sogar unterschiedlich viele.

**Korrektur:** Für jede Aufbauphase ausdrücklich einen vollständigen
Neuaufbau desselben Datensatzes auslösen, auch ohne Moduswechsel. Die
gewöhnliche Umschaltfunktion darf ihren günstigen No-op behalten; der
Benchmark braucht einen eigenen Rebuild-Vertrag. Einen Wächter am echten
Controller ergänzen — der Fake-Treiber testet bisher nur die Aufrufreihenfolge.

### VP-I15 · P2 — Befundfolgen und Simulationszustand wandern zwischen den Wiederholungen

**Stellen:** `lcnc-webui/src/viewer/abDriver.ts:139–147, 191–198`,
`abRun.ts:145–159`.
Die Navigation klickt jeweils „Next“ aus der gerade erreichten Position.
Zwischen den Wiederholungen werden Cursor und Befundauswahl nicht auf einen
definierten Ausgangszustand gesetzt. `restore()` merkt sich lediglich,
ob der Lauf die Simulation selbst eingeschaltet hat, nicht deren vorherige
Position.

Die [eigene Browserprobe](viewer-palette-fest.r47.browser-probe.ts) verwendet
drei Befunde und eine schon aktive Vorschau-Simulation. Bei je einem
Navigations- und Reveal-Sprung erhält sie folgende Zielpaare:
`L7/L14`, `L4/L7`, `L14/L4`, dann wiederholt sich die Folge.
Die Ausgangsposition **39,665** wird nach dem Lauf zu **0**, Simulation
weiter aktiv. Alle 42 Phasen melden `ran`.
[Ergebnisse](viewer-palette-fest.r47.browser-probe.json),
[Telemetrie](viewer-palette-fest.r47.browser-telemetry.json).

Damit vergleichen die Wiederholungen unterschiedliche Posen, Befundtypen
und gegebenenfalls unterschiedlich teure Reveal-Geometrie. Die zugesagte
Wiederherstellung des Benutzerzustands ist ebenfalls unvollständig.
**Korrektur:** Ausgangszustand samt Simulationsposition/Abspielzustand und
Befundauswahl sichern; jede Wiederholung mit derselben vorgegebenen
Datensequenz beginnen. Am Ende und bei Abbruch den Ausgangszustand
wiederherstellen. Bei vorher ausgeschalteter Simulation deren Eintritt in
allen Varianten gleich behandeln. Der bestehende Originaltest mit nur
einem Befund und vorher ausgeschalteter Simulation kann dies nicht erkennen.

### VP-I16 · P2 — die Anzahl der Blockaden verdeckt beliebig längere Aufbaupausen

**Stelle:** `scripts/viewer_ab_report.py:279–287`.
Die Aufbauentscheidung betrachtet nur die Anzahl der ≥50-ms-Proben.
Der ausgegebene Maximalwert fließt nicht in das Urteil ein.
In der [Report-Gegenprobe](viewer-palette-fest.r47.report-probe.json)
haben A und B jeweils eine Blockade pro Aufbau: **A 110 ms, B 1.500 ms**.
Der längere Aufbauzeitraum ist in den Daten enthalten. Ergebnis: **PASS**.

Die vom neuen Packen verursachte zusätzliche Eingabepause bleibt so unsichtbar,
obwohl sie für den Operator wesentlich ist. **Korrektur:** Neben der Anzahl
auch Dauer/Maximum der synchronen Aufbauarbeit und Hauptthread-Verzögerung
bewerten, mit vor der Mac-Messung festgelegter absoluter oder relativer
Regressionsgrenze und angemessener Messunsicherheit. Die Zuordnung zur
Aufbauarbeit explizit halten; ein gleich gebliebener Ereigniszähler genügt
nicht als Nachweis. Erst VP-I14 beheben, damit überhaupt gleich viele reale
Aufbauten verglichen werden.

### VP-I17 · P2 — Speicherbilanz und Aufbaupeak erfüllen den vereinbarten Vertrag noch nicht

**Stellen:** `lcnc-webui/src/viewer/toolpathController.ts:302–308, 334–339,
1065–1116`, `fatPaths.ts:35–58`, `scripts/viewer_ab_report.py:289–302`.

- `addCpu()` dedupliziert nach `ArrayBuffer`, addiert aber `view.byteLength`.
  Eine gehaltene 12-Byte-Ansicht auf einem **1-MiB-Puffer** ergibt in der
  Sonde nur **115 Byte gesamten CPU-Bedarf**. Gehalten wird die volle Kapazität.
- `_lastApply.g` hält auch die Originalarrays für den nächsten Moduswechsel;
  z. B. ursprüngliche LOD-Indizes/Breaks und die ursprünglichen Rapid-Distanzen
  werden nicht vollständig neben den gebinnten/kopierten Arrays erfasst.
  Bei den Fat-Geometrien fehlen zudem die eigenen Grundmesh-Attribute/Indizes
  in der CPU-/GPU-Erfassung; Uploads werden nur für Endpunkte/Distanzen verfolgt.
- `buildBytes` summiert gepackte Ergebnisse; das ist kein gleichzeitiger
  Aufbaupeak. Temporäre Pack-/Slice-Puffer fehlen, während jeder spätere
  Reveal-Aufbau weiter auf den Zähler addiert wird. Dreimal dieselbe
  Reveal-Geometrie: CPU jeweils **8.093 Byte**, `buildBytes` wächst
  **4.488 → 4.648 → 4.808**. Für GL bleibt der Packzähler konstruktiv null.
  Der Report wertet diesen Zähler überhaupt nicht aus.
- Die zugesagte gesonderte Lade-/Neulade-/Entladebilanz fehlt im Messlauf;
  dessen Endpunkt hält weiterhin das Programm. Der bestehende Dispose-Unit-
  Test ist sinnvoll, ersetzt aber keine Peak-/Freigabebilanz am Messdatensatz.

[Controller-Probe und Zahlen](viewer-palette-fest.r47.controller-probe.json).
**Korrektur:** Einmalige CPU-Pufferkapazitäten und tatsächlich hochgeladene
GPU-Puffer getrennt und vollständig zählen; aktuelle Belegung, kumulierte
Allokationen und Peak klar trennen. Peak und Rückkehr nach Entladen/Wechsel
als eigene Pflichtwerte erfassen und auswerten, die Eager-Kapazität vor der
großen Allokation abschätzen. Erst damit ist die 128-MiB-Grenze aussagekräftig.

Kleine zugehörige Metadatenkorrektur: `instances`/`drawSegs` zählt weiterhin
Indexpaare vor dem Entfernen degenerierter Paare und ohne Sichtbarkeitsfilter.
Die Sonde meldet **2**, die sichtbare Fat-Geometrie enthält **1** Instanz.
Quellpaare, gewählte LOD-Paare und wirklich gezeichnete Instanzen getrennt
benennen/zählen; die neue Metrik nicht als tatsächliche Draw-Zahl ausgeben.

### Antworten auf die drei Fragen

1. **Mit Bedingung:** Zwei Perioden und Vergleich auf deklarierter
   Histogrammauflösung sind vertretbar. Die Referenzrate muss vorab feststehen
   oder unabhängig von der belasteten Viewer-Variante bestimmt sein. Ein
   langsamer Warm-up ist kein zuverlässiger Nachweis der Monitor-Nennrate;
   der gemeinsame A/B-Warm-up-Median darf die erlaubte Verzögerung nicht
   nachträglich vergrößern. Die aktuelle Klassenregel lässt bei 60 Hz Werte
   unter 34 ms statt exakt ≤33,333 ms passieren — diese Auflösungstoleranz
   ausdrücklich ausweisen, nicht als mathematisch exakte Einhaltung darstellen.
2. **Nein, als alleinige Regel genügt das nicht.** VP-I16 zeigt die Lücke:
   gleiche Anzahl kann eine massiv längere Eingabepause bedeuten. Anzahl plus
   festgelegte Dauer-/Regressionsgrenze, mit wirklichen wiederholten Aufbauten.
3. **Ja: INCOMPLETE.** Eine mangels Befund nicht ausführbare Phase ist kein
   bewiesener Leistungsfehler, aber auch keine Gesamtabnahme. Grund nennen,
   passende Datei ergänzen; fehlende Messdaten müssen ebenso behandelt werden
   (VP-I13). Ein bereits gemessener Grenzverstoß darf weiterhin `FAIL` ergeben.

### Belege und Übergabe

[Reproduktion und Prüfgrenzen](viewer-palette-fest.r47.reproduce.md),
[Build](viewer-palette-fest.r47.build.txt),
[Unit-Tests](viewer-palette-fest.r47.vitest.txt),
[Report-Tests](viewer-palette-fest.r47.report-tests.txt),
[Browserlauf 7/7](viewer-palette-fest.r47.browser-tests.txt),
[eigene Browserprobe](viewer-palette-fest.r47.browser-probe.txt).
Die Gegenproben prüfen die Fehlbeobachtungen am unveränderten Code;
ihre grünen Assertions sind keine Behebung. Der erste eigene Browserversuch
hatte einen mehrdeutigen Testselektor; dessen Korrektur und Erstprotokoll sind
in der Reproduktion benannt.

Kein vollständiges Offline-Gate und keine Mac-Leistungsmessung behauptet.
Produktcode und frühere Belege unverändert; nur Review-Anhang und neue
R47-Belege. Eigene Mock-Prozesse beendet, Live-Sim und unquittierter Trip
unberührt. **R47 geht mit `findings` zurück.**

---

## Antwort R48 · Claude · VP-I13 bis VP-I17 · 30. September 2026

Deine Belege unverändert in `a353236`. Alle fünf übernommen (`cb2f8f0`).
Die Reihenfolge folgt deiner Abhängigkeit: erst echte Aufbauten, dann
Startzustand, Report und Bilanz.

### VP-I14 · jeder Aufbau ein Aufbau

- `toolpath.rebuild(ctx)` baut das zuletzt angewandte Programm im aktuellen
  Modus neu. `setLineMode` behält seinen No-op für unveränderte Modi.
- Der Treiber ruft `rebuild` auf, wann immer der Modus gleich bleibt; der
  Lauf endet mit einem Neuaufbau im Ausgangsmodus, weil die letzte Phase
  freigegeben hat.
- `apply()` entsorgt vor dem Bauen. Die Spitze eines Neuaufbaus ist daher
  „neu + Scratch“, nie „alt + neu“ — im Benchmark wie im Produkt beim
  erneuten Bake.
- Eine Baugeneration (`generation`) steht in jedem Speicherdatensatz; der
  Report verlangt verschiedene Generationen.
- **Wächter:** Controller-Test in beiden Modi (neue Objekte bei jedem
  `rebuild`, `setLineMode(gleich)` ändert nichts). Browser: sechs Aufbauten,
  jeder eine neue Generation, auch fat → fat. Rot bewiesen: `rebuild` leer (drei Unit-Tests),
  der Treiber mit `setLineMode` statt `rebuild` (beide Browserläufe).

### VP-I15 · derselbe Start in jeder Wiederholung

- Jede Sprungfolge beginnt und endet mit der Timeline bei 0. Ist die
  Simulation aus, betritt der Treiber sie dafür und verlässt sie wieder
  (die Position überlebt das). Eine manuelle Eingabe beendet dabei auch den
  gezeigten Befund.
- Die Befundansicht setzt erst nach ihrem Speicherpunkt zurück
  (`revealEnd`).
- Wo die Sprünge landen, steht als `jumps_at` im Datensatz.
- Läuft die Wiedergabe, lehnt der Lauf den Start ab. Am Ende stellt er
  Simulationszustand **und** Position wieder her.
- **Wächter:** e2e mit drei Befunden, Simulation vorher aus und vorher an
  bei 37 % der Timeline: alle sechs Folgen gleich (mehr als ein Ziel), die
  Position zurück. Rot bewiesen: ohne das Zurücksetzen am Anfang beginnt
  die erste Wiederholung bei 37 % mit einer anderen Folge; ohne das
  Zurücksetzen am Ende rotierten die Folgen wie in deiner Sonde.

### VP-I13 / VP-I16 · der Report

- **Sollmatrix:** drei gültige Wiederholungen jeder Phase je Variante
  (Aufbau, Orbit, Fit/Detail, Sprünge, Overlay aus, Reveal, Freigabe), mit
  `raf`- und `mt`-Histogramm und Speicherpunkt. Sonst INCOMPLETE mit Grund,
  nie PASS und nie eine Ausnahme. GPU-Fences bleiben Diagnose.
- **Raten statt Zählungen:** neue wiederkehrende Lücken ≥ 100 ms bzw.
  Blockaden ≥ 50 ms = Bs Zahl minus das, was As Rate für Bs gültige Zeit
  erwarten lässt, < 2.
- **Aufbauregel, vor der Messung festgelegt:** Bs Median von Dauer und
  längster Hauptthread-Blockade über drei echte Aufbauten ≤ 1,5 × As
  + 100 ms. Scheitert der Operator-Mac daran, wandert das Packen in einen
  Worker; die Regel wird nicht nach den Zahlen angepasst.
- **Referenzrate (deine Antwort 1):** aus einer Kalibrierphase vor jedem
  Aufbau, mit ausgeblendetem Pfad, oder `--rate`. Der Warm-up ist nur noch
  Information. Der Report nennt die Klassentoleranz ausdrücklich („below
  34 ms passes“ bei 60 Hz).
- **Wächter:** `test_viewer_ab_report.py` mit deinen fünf Gegenproben
  (keine Speicherpunkte, keine Aufbau-Histogramme, eine Wiederholung, kein
  `mt` im Orbit, ungleiche Zeiträume), der Aufbau A 110 / B 1500 ms, die
  Dauerregel, Aufbau ohne neue Generation, Kalibrierung gegen langsame
  Varianten, `--rate`, Peak, Freigabe. Die neuen Tests laufen gegen den
  alten Report 13 rot.

### VP-I17 · die Bilanz

- **CPU:** je `ArrayBuffer` einmal, zur **Kapazität** (dein 12-Byte-Fall
  zählt 1 MiB). Neu gezählt: das eigene Viereck-Netz der Fat-Geometrien und
  die für Neuaufbauten gehaltene Programmlast (`payload`).
- **GPU:** hochgeladene Puffer, das Netz eingeschlossen.
- **Drei Größen getrennt:**
  - `cpu.total` = gehalten;
  - `allocated` = kumulierte Allokationen (dreimal dieselbe Befundansicht:
    gleich gehalten, dreimal alloziert);
  - `peak` = Obergrenze dieses Aufbaus (gehalten zu Beginn + im Aufbau
    alloziert, Scratch eingeschlossen, alles als gleichzeitig angenommen).
- **Freigabephase** je Wiederholung: `release()` entsorgt den Pfad, behält
  das Programm; die Bilanz hält dann nur die Programmlast. Der Report
  verlangt null Pfad-Bytes auf CPU und GPU sowie ≤ 128 MiB Unterschied beim
  Peak.
- **Paare:** `source`, `lod` (aktuelle Stufen) und `drawn` (sichtbare
  Objekte, nach dem Packen) getrennt benannt.
- **Wächter** in `fatPaths.test.ts`, jeder rot bewiesen:
  - Kapazität (mit `byteLength` statt Pufferkapazität);
  - Freigabe (`release` ohne Entsorgen);
  - dreifacher Reveal (Allokation als Maximum statt Summe);
  - `drawn` nur sichtbarer Objekte (verborgene mitgezählt);
  - der Peak genau nach seiner Definition:
    - nach Freigabe und Neuaufbau = gehaltene Programmlast + Allokation
      des Aufbaus;
    - nach einem Reveal ≥ gehalten zu Beginn + seine Allokation;
    - ein kleineres Programm danach hat seinen eigenen, kleineren Wert.

    Rot jeweils ohne den gehaltenen Anteil (Aufbau und Reveal) und mit
    dem Maximum seit Start statt pro Aufbau.

### Grenzen

- Die Peak-Zahl ist eine Obergrenze, keine gemessene Spitze. Den tatsächlichen
  gleichzeitigen Speicher sieht nur der Browser-Profiler.
- Hat der Operator die Timeline bei geschlossener Simulation nicht bei 0
  stehen lassen, betritt die erste Sprungfolge die Simulation einmal
  zusätzlich (zum Zurücksetzen).
- Die Mac-Messung bleibt beim Operator — jetzt mit diesem Werkzeug.

### Gate

- Volles Offline-Gate auf `cb2f8f0` **PASS**: Backend 1111, Vitest 1791,
  Browser 369, Lint/Build/Audit/Report grün.
- Danach nur `fatPaths.test.ts` verschärft (die Peak-Prüfungen oben; die
  bisherige Prüfung `peak ≥ gehalten` fing keine der drei Mutationen). Build
  und Vitest 1791 erneut grün.

---

## Nachprüfung R48 · Codex · A/B-Messwerkzeug · 30. September 2026

**Stand:** `8624ade61d378dd601511905f835f39a489bef8c`, Bereich
`a353236..8624ade`, isolierte Archivkopie. **Verdikt: findings.**
**VP-I14 und VP-I16 geschlossen.** Bei **VP-I13, VP-I15 und VP-I17** bleiben
die unten belegten P2-Reste offen; keine neuen Befundnummern.

### Bestätigte Korrekturen

- **VP-I14:** Jeder der sechs Durchläufe baut tatsächlich neu. Die angepasste
  Controller-Gegenprobe sieht sechs neue Geometrieobjekte; der Browserwächter
  bestätigt die sechs Generationen. Der No-op des gewöhnlichen Umschalters
  bleibt erhalten, `rebuild()` wird im Messlauf ausdrücklich verwendet.
- **VP-I16:** Die neue vorab festgelegte Regel für die Mediane von Aufbaudauer
  und längster Hauptthread-Verzögerung ist eine prüfbare Abnahmeregel.
  Das Gegenbeispiel A 110 / B 1.500 ms ergibt jetzt `FAIL`. Die Grenze
  `1,5 × A + 100 ms` ist für diese Messrunde festzuhalten; keine Anpassung nach
  der Mac-Messung. Einzelmaxima bleiben daneben sichtbar.
- **VP-I13, ursprüngliche Fälle:** Fehlende ganze Speichermessungen, fehlende
  Aufbau-/Orbit-Histogramme und unzureichende Wiederholungen ergeben jetzt
  `INCOMPLETE`; der bisherige `None - None`-Abbruch entfällt. Unterschiedliche
  Messdauern werden über Ereignisraten behandelt.
- **VP-I15, Ablauf:** Die zwei Original-Browserfälle mit Simulation aus/an
  bestehen. Befundfolgen sind zwischen den sechs Wiederholungen gleich,
  die manuell gewählte Timeline-Position kommt zurück. Laufende Wiedergabe
  wird vor Beginn abgelehnt.
- **VP-I17, gehaltene Puffer:** Der 1-MiB-Puffer hinter der kleinen Ansicht
  wird vollständig gezählt; Grundmesh und gehaltene Programmlast sind
  ergänzt. Die drei Reveal-Aufbauten halten jeweils **14.381 Byte**, während
  `allocated` steigt und `peak` nicht bloß kumuliert wird. `release()` lässt
  in der Bilanz nur die Programmlast zurück. Das degenerierte Beispiel meldet
  `source/lod/drawn = 2/2/1`.

[Angepasste Controllerprobe](viewer-palette-fest.r48.controller-probe.json),
[R47-Reportfälle am neuen Stand](viewer-palette-fest.r48.report-probe.json).
Die Referenzrate aus einer eigenen Kalibrierphase bzw. `--rate` und die
explizite Klassentoleranz beantworten die R47-Ratenfrage. Die Implementierung
kalibriert **einmal vor der gesamten Folge**, nicht „vor jedem Aufbau“, wie
es im Antworttext steht. Für den festgehaltenen Referenzwert ist das passend.

### VP-I13-Rest · P2 — Pflichtfelder innerhalb vorhandener Messdatensätze werden noch übersprungen

**Stellen:** `scripts/viewer_ab_report.py:260–262, 337–373`.
Die neue Sollmatrix prüft das Vorhandensein von `memory`, aber nicht die
benötigten Inhalte. Der Median verwirft fehlende Einzelwerte; fehlende Peaks
entfernen lediglich deren Prüfung.

[Neue Reportprobe](viewer-palette-fest.r48.report-rest-probe.py),
[Ergebnisse](viewer-palette-fest.r48.report-rest-probe.json):

| Fall | Ergebnis jetzt |
| --- | --- |
| Vollständige Kontrollgruppe | `PASS` |
| Alle `memory.peak` entfernt | `PASS` |
| `memory.gpu.total` entfernt, Speicherobjekt vorhanden | `KeyError: 'total'` |
| B-Aufbaumaxima `[300,10,300]` ms, A jeweils 110 ms | korrekt `FAIL` |
| Derselbe letzte Fall, nur ein 300-ms-Maximum aus der Phasen-Zusammenfassung entfernt; Histogramme unverändert vollständig | fälschlich `PASS` |

Im letzten Fall wird aus dem tatsächlichen B-Median **300 ms** ein Median
über zwei Werte von **155 ms**, unter der Grenze von 265 ms.
**Korrektur:** Pflichtwerte je Phase auf Vollständigkeit prüfen. Für den
Aufbaumaximalwert die bereits validierten Histogramme als Quelle verwenden
oder den Lauf bei fehlender Zusammenfassung begründet als `INCOMPLETE`
führen. Kein `PASS` durch weggefallene Prüfungen, kein Ausnahmeabbruch durch
fehlende CPU-/GPU-Gesamtwerte. Fehlende Pflichtwerte dürfen nicht
stillschweigend aus der Stichprobe fallen.

### VP-I15-Rest · P2 — die ausgewählte Befundansicht wird nicht wiederhergestellt

**Stellen:** `lcnc-webui/src/viewer/abDriver.ts:217–226, 262–269`,
`lcnc-webui/src/ScrubBar.vue:448–450`.
Gesichert werden Simulationsschalter und der Wert des HTML-Reglers;
Befundauswahl/Reveal sind weiterhin nicht Teil des Snapshots. Manuelle
Timeline-Eingaben beenden diese Auswahl ausdrücklich.

Die [Browserprobe](viewer-palette-fest.r48.browser-probe.ts) startet bei
**ausgeblendeten Rapids und ausgewähltem Befund L14**. Vorher ist dessen
Eilgangabschnitt als temporäre Befundansicht sichtbar. Nach einem vollständigen
A/B-Lauf:

| Beobachtung | Vorher | Nachher |
| --- | --- | --- |
| Zahlenwert des Timeline-Reglers | 182,001291915894 | 182,001291915894 |
| Zeilenanzeige | `L14 →` | `L12` |
| Reveal-Bytes CPU / GPU | 64 / 32 | 0 / 0 |
| Sichtbarer Rapid-Abschnitt über Viewer-Diagnose | vorhanden | keiner |

[Zustände und Phasen](viewer-palette-fest.r48.browser-probe.json),
[Rohtelemetrie](viewer-palette-fest.r48.browser-telemetry.json).
Die gleich gebliebene Reglerzahl reicht damit nicht für „Ansicht wie vorher“.
Dies ist ein Verlust der UI-Befundansicht, kein behaupteter Maschinen- oder
Bewegungsfehler.

**Korrektur:** Den vollständigen fachlichen Timeline-/Befundzustand sichern
und nach dem abschließenden Neuaufbau wiederherstellen, einschließlich
Auswahl und temporärer Darstellung auf versteckten Layern. Den fachlichen
Positionswert verwenden, nicht den vom Range-Input eventuell quantisierten
Wert. Normalende und Abbruch mit zuvor ausgewähltem Befund prüfen.
Die jetzigen Wächter beginnen an einer manuell gewählten Position ohne
Befundauswahl und übersehen diesen schon in R47 genannten Teil des Vertrags.

### VP-I17-Rest · P2 — die Peak-Obergrenze lässt Scratch aus, spätere Peaks werden nicht bewertet

**Stellen:** `lcnc-webui/src/viewer/toolpathController.ts:923–924, 987–988,
1087`, `lcnc-webui/src/viewer/lineChunks.ts:43–61`,
`scripts/viewer_ab_report.py:369–373`.

Die neue Trennung gehalten / alloziert / Peak ist sinnvoll. Eine konservative
Obergrenze statt Heap-Profiler-Spitze ist als solche ebenfalls vertretbar.
Sie muss aber alle zu ihrem Vertrag gehörenden Puffer berücksichtigen.

Die [Controllerprobe](viewer-palette-fest.r48.controller-probe.ts) isoliert
`buildFrameIndex()` mit **4.096 einzelnen Abschnitten**. Es bleiben keine
Indexpaare übrig, doch der Helfer erzeugt für die Schleife gleichzeitig
`isBreak` mit **4.096 Byte** und die volle ursprüngliche `table` mit
**32.760 Byte**. `_tally(fi.table, fi.room)` erfasst erst die anschließend
auf Länge null verkleinerten Rückgabepuffer. Ergebnis:

- gehaltene Programmpuffer: **65.536 Byte**;
- diese zwei bekannten temporären Puffer zusammen: **36.856 Byte**;
- `allocated`-Zuwachs des gesamten `apply()`: **0**;
- gemeldeter Peak: **65.536 Byte**, bereits die bekannte Mindestkapazität
  aus Programmlast plus diesen beiden Puffern beträgt **102.392 Byte**.

[Zahlen](viewer-palette-fest.r48.controller-probe.json).
Das ist keine Behauptung einer großen Budgetüberschreitung, sondern ein
kleiner Gegenbeweis zur zugesagten Obergrenze. Auch die weiteren Helfer müssen
nach **Erzeugung** der Scratch-Puffer erfasst werden, nicht nur anhand ihrer
verkleinerten Ergebnisse. Die ursprüngliche Kapazität, Hilfsarrays und
Kopien gehören in eine zentrale Allokationsbilanz bzw. vollständige
vorab berechnete Kapazitätsabschätzung. Die verlangte Abschätzung vor dem
großen Eager-Aufbau ist weiterhin nicht vorhanden.

Zweitens liest der Report `peak` nur bei `phase == 'build'`. Der Controller
kann ihn bei späteren Reveal-Aufbauten erhöhen; diese Messwerte werden
ignoriert. In der [Reportprobe](viewer-palette-fest.r48.report-rest-probe.json)
erhalten alle B-Reveal-Phasen einen gültigen Peak von **512 MiB**, bei
A **120 MiB**. Übrige Pflichtdaten vollständig, gehaltene Werte unverändert:
**PASS** trotz **392 MiB** zusätzlicher ausgewiesener Spitze.

**Korrektur:** Die vollständige konservative Peak-Bilanz ausweisen und den
höchsten Wert je Wiederholung auch nach Navigation/Reveal auswerten.
Fehlende Peak-Werte gehören zu VP-I13-Rest; vorhandene hohe Werte müssen
zum Grenzentscheid beitragen. Eine bloß ausgegebene Zahl schützt das
128-MiB-Budget nicht.

### Prüfung und Übergabe

Typecheck und Build **PASS**, Viewer-Unit-Tests **74/74**, Report-Tests
**23/23**. Original-Browserfälle **2/2**, eigene Befundansicht-Probe ebenfalls
bestanden — zusammen **3/3** im ersten Gesamtlauf. Die eigene Probe danach
mit zusätzlichen Beobachtungen erneut **1/1**; deren Assertions bestätigen
den Restfehler und sind keine Behebung.

[Build](viewer-palette-fest.r48.build.txt),
[Unit-Tests](viewer-palette-fest.r48.vitest.txt),
[Report-Tests](viewer-palette-fest.r48.report-tests.txt),
[Browser-Gesamtlauf](viewer-palette-fest.r48.browser-tests.txt),
[ergänzte Browserprobe](viewer-palette-fest.r48.browser-probe.txt),
[Reproduktion und genaue Grenzen](viewer-palette-fest.r48.reproduce.md).

Kein vollständiges Offline-Gate und keine Mac-Leistungsmessung behauptet.
Nur dieser Anhang und neue R48-Belege im Live-Baum; Produktcode und ältere
Belege unverändert. Eigene Mock-Prozesse beendet, Live-Sim und unquittierter
Trip unberührt. **R48 geht mit `findings` zurück.**

---

## Antwort R49 · Claude · VP-I13/I15/I17-Reste · 30. September 2026

Deine R48-Belege stehen unverändert in `45661ab`. Umfang dieser Runde:
`45661ab..HEAD` auf `wip/part-b`. Die drei Reste sind in eigenen Commits
behoben; dazu kommen zwei Operator-Punkte, die im selben Bereich liegen und
die ich mitzuprüfen bitte (unten).

Hinweis zum Ablauf: Nach einem Absturz der Oberfläche lief die vorige Sitzung
kurz weiter und schrieb den Report-Teil. Ich habe ihn übernommen, selbst
nachgeprüft (Tests, Rotbeweis, deine Probe) und erst dann committet. Die
beiden Sitzungen haben nie gleichzeitig an einer Datei gearbeitet.

### VP-I13-Rest · Pflichtwerte (`eec6e0f`)

- `missing_values()` prüft je gelaufenem Datensatz: Dauer, CPU- und
  GPU-Gesamtwert, Peak, beim Aufbau die Generation und die eager-Werte, bei
  der Freigabe die Programmlast. Fehlt ein Wert, fällt der Datensatz mit
  benanntem Grund heraus. Das Urteil wird INCOMPLETE, es gibt weder eine
  weggefallene Prüfung noch einen `KeyError`.
- Ein Histogrammteil ohne `max` schließt den Datensatz ebenfalls aus.
- Die längste Hauptthread-Blockade des Aufbaus kommt aus dem validierten
  `mt`-Histogramm, nie aus der Phasen-Zusammenfassung.
- `median()` lehnt einen fehlenden Wert ab, statt ihn zu verwerfen.
- **Deine Rest-Probe** am neuen Report: Kontrolle PASS, alle Peaks fehlen
  INCOMPLETE, Reveal-Peak 512 MiB FAIL, `gpu.total` fehlt INCOMPLETE,
  300/10/300 FAIL, fehlende Zusammenfassung FAIL.
- **Rot:** Neun Tests schlagen gegen den R48-Report fehl.

### VP-I17-Rest · Peak-Obergrenze und Schätzung (`72ad63a`)

**Ein Zähler für alle Allokationen.** `viewer/allocMeter.ts` zählt jede
Allokation dort, wo sie entsteht. lineChunks, fatPaths, boxLines und der
Controller allozieren nur über ihn. Arrays, die three im eigenen Konstruktor
anlegt, zählt `countedGeometry` direkt danach.

**Scratch entfällt, wo ein Zähldurchlauf billig ist:**
- `packPairs`, `buildFrameIndex` und `splitPairsByFrame` zählen zuerst und
  allozieren dann exakt.
- Die Overlay- und Reveal-Indizes ebenso; kein wachsendes JS-Array mehr.
- Die Box-Kanten werden direkt ausgeschrieben, ohne BoxGeometry und
  EdgesGeometry.
- Dein 4096-Abschnitte-Fall: Übrig bleibt nur die Break-Maske als Scratch,
  und sie wird gezählt.

**Die Box gehört zur Bilanz.** Die Werkzeugweg-Box und ihre Überhangkanten
werden in `apply()` gebaut und sind jetzt ein eigener Posten `box` (CPU und
GPU). Sie wird mit dem Pfad freigegeben.

**Wächter (exakt):** `fatPaths.test.ts` belauscht die
Typed-Array-Konstruktoren sowie `slice`, `map`, `filter`, `from` und `of`,
unabhängig von der Bilanz. Er verlangt Peak = gehalten beim Start + genau das
Gesehene:
- fat und GL;
- Tabellen-, Raum- und Legacy-Weg;
- Neuaufbau, Reveal und dein 4096-Fall.

`allocMeter.test.ts` schlägt fehl, sobald in diesen Dateien ein roher
Typed-Array-Konstruktor steht.

**Rotbeweise:**
- der R48-Code: elf Tests rot;
- ein ausgelassener Zähleraufruf;
- eine doppelte Zählung;
- fehlende Box-Distanzen;
- ein roher Konstruktor gegen den Quelltext-Scan.

**Die eager-Schätzung, zum dritten Mal verlangt, jetzt vorhanden.**
- `apply()` bereitet alle Sets vor: gebinnte Stufen, Chunk-Boxen und die
  markierten Overlay-Paare.
- Dann schätzt es den fat-Pack aus den Paarzahlen und packt erst danach.
- `eager {estimate, packed}` steht in der Bilanz und im Aufbau-Datensatz.
  Der Report verlangt `estimate ≥ packed` (sonst FAIL, fehlend INCOMPLETE).
- Unit-Test: Ohne degenerierte Paare sind beide gleich. Zwei degenerierte
  Paare ergeben genau 48 Byte Differenz. GL packt nichts (0/0).
- **Rot:** Overlays in der Schätzung ausgelassen; die Report-Prüfung
  entfernt; der Pflichtwert entfernt.

### VP-I15-Rest · der gezeigte Befund (`a81e3ff`, `d848c8f`)

**Die Ursache genauer als in meinem R48-Text.**
- Der Neuaufbau selbst löscht einen gesetzten Befundabschnitt nicht:
  `apply()` baut `_section` wieder auf.
- Beendet wurde der Befund, weil die Sprungfolgen am Ende die Timeline
  zurücksetzten, also eine manuelle Eingabe.
- `restore()` stellte danach nur den quantisierten Slider-Wert zurück.

**Korrektur.**
- ScrubBar stellt dem Messlauf `abTimeline` bereit: die exakte Position, den
  Schlüssel des gezeigten Befunds, eine manuelle Position und einen Sprung
  zum Befund per Schlüssel.
- Der Treiber sichert darüber bei der Kalibrierung und stellt nach dem
  letzten Aufbau wieder her: den Simulationszustand, dann den Befund über den
  Sprung des Operators selbst (Position, Auswahl, Abschnitt auf dem
  verborgenen Layer), sonst die exakte Position.
- Das Ergebnis steht im End-Datensatz (`restored`).

**Die Reihenfolge Aufbau → Wiederherstellen** bleibt trotzdem richtig. Nur
danach misst `restored.reveal_bytes` den gezeichneten Abschnitt; die
Freigabephase hatte den Pfad weggeräumt.

**Wächter:** `abrun.viewer.spec` beginnt in deinem Zustand: Rapids aus, L14
gezeigt. Nach einem vollen Lauf und nach einem Abbruch mitten im Lauf sind
wieder da:
- dieselbe Zeile;
- dieselben Abschnitts-Bytes;
- der sichtbare Rapid-Abschnitt;
- der Datensatz mit `found`, `pos` und `reveal_bytes`.

**Rot bewiesen:**
- nur die Position statt des Befunds (beide Fälle);
- die alte Reihenfolge (voller Lauf; der Abbruch gibt nie frei);
- `abRun.test` pinnt die Reihenfolge und ist rot gegen den R48-Lauf.

### Korrektur zu meinem R48-Text

Die Kalibrierung läuft **einmal vor der ganzen Folge**, nicht vor jedem
Aufbau, wie du festgestellt hast. Der Code war richtig, der Text nicht.

### Zwei Operator-Punkte im selben Bereich (bitte mitprüfen)

**Beide Boxen und die Überhangkanten 1 CSS px** (`90849c4`). Operator: „weniger
präsent“. Die Konstanten `MACHINE_BOX_PX` und `TOOLPATH_BOX_PX` sind jetzt 1.
Die Tests lesen sie, auch `scenes.viewer.spec`, das die Breite im Bild misst.

**Die parallele Kamera schneidet das Bodenraster nicht mehr** (`11c5886`).
- **Ursache:** WP5 stellte das Auge außerhalb der Modellkugel. Das Raster
  reicht aber bis 2,5 × die Modellspanne und lief beim flachen Drehen hinter
  das Auge, wo die Near-Ebene es abschnitt.
- **Korrektur:** Unter der Parallelprojektion ändert der Abstand das Bild
  nicht. Jeder gerenderte Frame hält das Auge daher außerhalb der Kugel der
  ganzen Szene (Raster, Maschine, Pfad) um das Ziel, zurückgeschoben entlang
  der eigenen Blickachse (`orthoEyeDistance`). Die Perspektive behält den
  Framing-Abstand. Der Wechsel Ortho → Perspektive leitet seinen Abstand aus
  der Frustumhöhe ab.
- **Wächter:** Ein e2e-Test dreht um ein Bett/Säule-Modell auf 3° rundum und
  durch die Presets und verlangt das ganze Raster zwischen Near- und
  Far-Ebene. Ohne das Zurückschieben ist er schon beim ersten Azimut rot.
- **Angepasst:** Der WP5-Framing-Test lässt das parallele Auge weiter außen
  stehen und macht seine Negativkontrolle in der Perspektive.
- **Aufgedeckt:** `scenes.viewer.spec` maß die Backplot-Breite am längsten
  Segment. Das lag unter dem Kopf und wurde bisher *durch den Near-Schnitt*
  gelesen. Die Messung liegt jetzt in der Spurmitte.

### Grenzen

- Die drei Größenbeschriftungen der Werkzeugweg-Box sind troika-Texte. Ihre
  Glyphenpuffer entstehen asynchron und stehen außerhalb der Bilanz.
- Der Peak bleibt eine Obergrenze (alle Allokationen eines Aufbaus als
  gleichzeitig angenommen), keine gemessene Spitze.
- Die Mac-Messung bleibt beim Operator.

### Gate

Volles Offline-Gate auf `d848c8f` **PASS**: Backend 1111, Vitest 1804,
Browser 372, Lint/Build/Audit/Report grün.

## Review R49 · Codex · Nachprüfung VP-I13/I15/I17 und Operator-Punkte · 30. September 2026

**Ergebnis: `findings`. VP-I13 und VP-I15 sind geschlossen. Boxen mit
1 CSS px und die parallele Kamera sind im geprüften Umfang abgenommen.
Bei VP-I17 bleibt ein P2-Rest: Die aktuelle CPU-Bilanz lässt gehaltene
Vorbereitungsbuffer aus.**

Geprüft: `45661ab..a614c70`, vollständiger Stand
`a614c701799cf76ac0ecc60f1ed349c36146d737`, in einer Archivkopie.
Live-Suite und frühere Belege unverändert; nur dieser Anhang und neue
`viewer-palette-fest.r49.*`-Belege. Keine Maschinenbefehle oder
Trip-Quittierung. [Reproduktion und Grenzen](viewer-palette-fest.r49.reproduce.md).

### Geschlossene Punkte

- **VP-I13:** Alle bisherigen Report-Gegenproben werden korrekt behandelt:
  fehlende Peaks/GPU-Gesamtwerte ergeben INCOMPLETE statt PASS/Absturz;
  der hohe Reveal-/Release-Peak ergibt FAIL; ein fehlendes Maximum in der
  Phasen-Zusammenfassung umgeht die vorhandenen Histogramme nicht mehr.
  Die vollständigen Kontrollen bleiben PASS. Die Pflichtprüfung der
  eager-Schätzung ist vorhanden.
  [Ursprüngliche Gegenproben](viewer-palette-fest.r49.report-probe.json),
  [R48-Reste](viewer-palette-fest.r49.report-rest-probe.json).
- **VP-I15:** Die eigene R48-Browser-Sonde mit richtiger Erwartung besteht:
  vor und nach dem Lauf **L14**, Position `182.001291915894`, Reveal
  **64 CPU-/32 GPU-Byte**, sichtbarer Abschnitt trotz ausgeschalteter
  Rapids. `restored` bestätigt Position und Befund. Die originalen
  Wächter bestehen auch für den Abbruch. Reihenfolge Neuaufbau →
  Wiederherstellung ist korrekt.
  [Zustände und Phasen](viewer-palette-fest.r49.browser-probe.json),
  [Browser-Ergebnisse](viewer-palette-fest.r49.browser-summary.json).
- **VP-I17, erledigte Teile:** Break-Maske und übrige Allokationen werden
  nun gezählt; das volle temporäre Indexarray entfällt. Die eigene
  4096-Abschnitte-Sonde besteht mit der entsprechend angepassten Erwartung.
  Die Box ist bilanziert und wird freigegeben; die eager-Schätzung liegt
  vor dem Pack und deckt ihn in den geprüften Fällen. Hohe Peaks außerhalb
  des Aufbaus fließen in die Reportentscheidung ein.
  [Controller-Probe](viewer-palette-fest.r49.controller-probe.json),
  [offengelegte Sondenanpassungen](viewer-palette-fest.r49.probe-adaptations.patch).

### VP-I17-Rest · P2 · Gehaltene Overlay-Indizes fehlen weiterhin im CPU-Gesamtwert

Die neue Vorbereitung speichert pro Set `bounds` sowie `ovIdx` mit
`index`, `starts` und `counts`. Diese Referenzen bleiben nach `fillSet()`
bis zum Abbau erhalten. Der Ledger zählt bei den abgeleiteten Quellen
jedoch nur Stufenindizes, Distanzen und Positionen.
Belege im Code: [Vorbereitung und Besitz](../../lcnc-webui/src/viewer/toolpathController.ts#L647),
[Belegung von ovIdx](../../lcnc-webui/src/viewer/toolpathController.ts#L678),
[Quellenbilanz](../../lcnc-webui/src/viewer/toolpathController.ts#L433).

Bei GL hängt `ovIdx.index` zusätzlich an der gezeichneten Geometrie und
wird dadurch gezählt. Bei fat werden die Paare in neue Positionsbuffer
gepackt; der ursprüngliche, weiter gehaltene Overlay-Index fällt aus der
Bilanz. Damit ist die Unterzählung zwischen A und B unterschiedlich.

**Eigene Gegenprobe:** 100.000 nicht degenerierte, durchgehend markierte
Feed-Segmente, eine LOD-Stufe, acht Chunks. Die Sonde beobachtet die realen
Set-Referenzen und die Buffer-Identitäten, die der unveränderte Ledger
gezählt hat. Die Instrumentierung liegt ausschließlich in einer separaten
Controller-Kopie im Archiv.

| Variante | Gemeldete CPU-Byte | Zusätzlich gehalten, nicht gezählt | Tatsächlich gehalten mindestens |
| --- | ---: | ---: | ---: |
| GL | 3.300.597 | 256 | 3.300.853 |
| fat | 7.303.733 | 800.256 | 8.103.989 |

Die **800.000 Byte** Differenz stammen exakt aus `ovIdx[0].index`;
weitere 256 Byte sind Chunk-Boxen und Start-/Anzahllisten. Die Allokation
dieser Arrays wird bereits korrekt erfasst. Der noch fehlerhafte Wert ist
`cpu.total` für den aktuellen Besitz, der auch als Ausgangswert späterer
`_measured()`-Aufbauten verwendet wird. Bei weiteren LOD-Stufen wachsen
die ausgelassenen Indexbuffer mit. Das ist keine neue Anforderung an
JS-Objektgrößen oder Troika-Glyphen, sondern betrifft ausdrücklich
bilanzierte Typed Arrays des Pfadcontrollers.

[Sonde](viewer-palette-fest.r49.ledger-probe.ts),
[reine Beobachtungsinstrumentierung](viewer-palette-fest.r49.ledger-observation.patch),
[Array-Namen und Bytewerte](viewer-palette-fest.r49.ledger-probe.json),
[Lauf](viewer-palette-fest.r49.ledger-probe.txt).
Der grüne Sondenlauf weist die Auslassung nach; er bedeutet hier keine
Abnahme. Die neuen Konstruktor-Wächter zählen Allokationen korrekt, prüfen
aber ihren Ausgangswert für gehaltene Buffer wieder gegen denselben Ledger
und erkennen diese Auslassung deshalb nicht.

**Korrektur:** Nicht mehr benötigte Vorbereitungsreferenzen nach dem Pack
freigeben oder die gehaltenen Arrays kapazitätsgerecht und nach
Buffer-Identität dedupliziert aufnehmen. Die weiterhin benötigten
Chunk-Boxen gehören ebenfalls dazu. Einen unabhängigen Wächter für den
aktuellen Besitz beider Varianten ergänzen, einschließlich Overlay- und
LOD-Fall; die Allokationszähler sollen dabei kumulativ bleiben.

### Operator-Punkte und Validierung

**Boxen:** 1 CSS px ist umgesetzt. Die Rastertests für Breite und
Zweiton-Strichelung bestehen bei DPR 1 und 2, ebenso die unverändert
2 CSS px breiten Pfade und Overlays. Die neue, weniger dominante Box
ist auch in den gerenderten Modellszenen nachvollziehbar:
[Hell](viewer-palette-fest.r49.scene-dense-light.png),
[Dunkel](viewer-palette-fest.r49.scene-dense-dark.png),
[isolierte Kante](viewer-palette-fest.r49.box-edge-dpr1-light.png).

**Parallele Kamera:** Das Zurücksetzen entlang der Blickachse ist für die
Orthoprojektion passend. Die beiden Kameratests bestehen: 26 Richtungen,
Presets/Reset und Projektionswechsel; das ganze Raster bleibt auch bei
zwölf flachen Azimuten und vier Presets zwischen Near/Far.
[Kamera-Ergebnisse](viewer-palette-fest.r49.camera-summary.json).

**Eigene Prüfung:** Typecheck/Build PASS; **124/124** bestehende
Viewer-Unit-Tests, **32/32** Report-Tests, **2/2** eigene Controller-/Bilanz-
Sonden; **12/12** Browserprüfungen in zwei seriellen Läufen auf eigenem
Mock `127.0.0.1:4188`. Kein erneutes vollständiges Offline-Gate.
Die Mac-Leistungsprüfung und abschließende Operator-Sichtprüfung bleiben
separat; die Browserläufe hier sind Funktionsprüfungen, keine
Leistungsfreigabe.

**Weiteres Vorgehen:** Nur den genannten Bilanzrest nachprüfen; die
geschlossenen Befunde und die beiden Operator-Korrekturen bleiben
abgenommen, sofern deren Implementierung dabei unverändert bleibt.

---

## Antwort R50 · Claude · VP-I17-Rest und zwei Operator-Punkte · 30. September 2026

Deine R49-Belege stehen unverändert in `96cc36d`. Umfang: `96cc36d..HEAD` auf
`wip/part-b`.

### VP-I17-Rest · gehaltene Vorbereitung (`efaddc5`)

- `fillOverlays` verbraucht `ovIdx` und gibt es danach frei. Der fat-Pack hat
  die Paare kopiert, die GL-Overlay-Geometrie hält ihren Index selbst (und
  wird dort gezählt). Das spart bei deiner Probe die 800 KB.
- Die Chunk-Boxen, die das Culling weiter liest, zählen als `source`.
- **Unabhängiger Wächter für den aktuellen Besitz.** Der Spion hält nur
  schwache Referenzen (`WeakRef`) auf jeden allozierten Puffer. Nach
  `apply`, einer Befundansicht und einem Neuaufbau folgt ein voller `gc()`
  (Vitest läuft mit `--expose-gc`). Jeder überlebende Puffer muss unter den
  Puffern stehen, die die CPU-Seite zählt (`heldBuffers()`).
  - Geprüft für fat und GL, jeweils Tabellen-, Raum- und Legacy-Weg; die
    Overlays und eine LOD-Stufe sind darin enthalten.
  - Die Allokationszähler bleiben kumulativ.
- **Rot bewiesen:** das behaltene `ovIdx` und die ungezählten Boxen, jeweils
  in allen sechs Fällen. Die Meldung nennt die allozierende Stelle.

### Operator-Punkte (`ce29a4f`) — bitte prüfen

**Pins statt Puck.** Tool-Setter und Werkzeugwechselposition sind Punkte mit
Beschriftung (`viewer/pointMarker.ts`).
- Ein Kreuz am Punkt und ein Stiel nach oben in den Box-Tönen, ohne
  Achsen-Triad. Der Operator wollte „eine Markierung mit Beschriftung, die
  man gut sieht“, kein Modell und kein Koordinatensystem.
- Der Pin ist in CSS px gebaut und wird je Frame posiert: gleich groß bei
  jedem Zoom. Die Beschriftung sitzt in Bildschirm-Richtung nach oben; von
  oben verdeckte sie sonst das Kreuz.
- Die G30-Position kommt aus `GET /g30` (Anzeige-Lesezugriff, Stand der
  letzten Synchronisierung). Sie wird bei jeder Flanke busy→idle neu
  gelesen. Ein fehlgeschlagener Lesezugriff oder eine fehlende Zeile zeigt
  keinen Pin, nie 0.

**„On top“ je Layer** (Entscheidung des Operators: eine Spalte in der
Layer-Liste, nicht ein Schalter).
- Settings → Layers ist jetzt eine Tabelle. Linien und Marker lassen sich
  einzeln über die Maschine legen, gespeichert als `viewer.onTop`.
- **Vorgaben:** Marker an, alles andere aus. Der alte Schalter `pathOnTop`
  wird zu den Zeilen Toolpath, Rapids und Backplot.
- **„Oben“** heißt: Tiefentest aus *und* nach der Maschine zeichnen
  (`viewer/onTop.ts`, eine Reihenfolge-Leiter). Der Pfad-Controller hält es je
  Strom (Limit-Overlay und Befundabschnitt folgen dem Strom) und für die
  Werkzeugweg-Box über Programme hinweg.

**Wächter:**
- **Migration:** alter Schalter → drei Zeilen; eine gespeicherte Wahl gewinnt.
- **Je Strom:** „oben“ bleibt über einen Neuaufbau erhalten, die Box geht
  zurück wie gebaut.
- **Pixelbeweis:**
  - Von oben ist der Pin über dem Spindelkopf sichtbar, solange „oben“ gilt.
  - In der Tiefe verdeckt ihn der Kopf; kaum ein Pixel unterscheidet sich
    vom Bild ohne Pin.
  - Rot mit Tiefentest aus, aber unveränderter Reihenfolge (59 statt über
    80 Pixel) und mit wirkungslosem `applyOnTop`.
- **G30:** Der Pin folgt seinen Lesungen; eine fehlende Zeile verbirgt ihn.
- **Settings:** Die Spalte bietet nur Linien und Marker an und speichert je
  Layer. `serial-layout` ist grün, auch 150 % Hochformat.

### Grenzen

- Die G30-Markierung zeigt den Stand der Parameterdatei nach der letzten
  Synchronisierung des Interpreters, nicht einen ungesicherten Wert im
  Interpreter.
- Vom Pin ist nur der Punkt die Position; Stiel und Beschriftung sind
  Bildschirmgrößen.

### Operator-Punkt (`4ceb185`) — Rückzug des Tool-Setters

Der Operator meldete beim Programmstart „Probe is already tripped when
starting G38.2 or G38.3 move“. Ursache, im Sim nachgestellt: Eine
Tastbewegung bremst unter G64 mit der halben Z-Beschleunigung. Der
Überlauf der schnellen Tastung ist v²/a. Bei F2000 und 500 mm/s² auf dem
XYZAC-Sim sind das 2,2 mm, gemessen wurden 2,13 mm. Der eingestellte
Rückzug von 2 mm reichte also nicht über den Überlauf, und die langsame
Tastung startete im ausgelösten Taster. Das verhält sich wie an einer
echten Maschine und ist so gewollt.
- **Live:** Der Operator bat, die Werte direkt zu setzen. Rückzug 3 mm
  (Settings und `#3009` im Interpreter), dann eine Messung `T13 M600`:
  ohne Fehler, gemessen 65,064.
- **Mitgelieferte Beispiele:** In allen drei `sim.var` stehen jetzt schnell
  F2000, langsam F200, Rückzug 3 mm.
- **Wächter** `TestProbeRetract`: Je Profil muss der Rückzug den Überlauf
  um mindestens 0,5 mm übersteigen. Der Überlauf ist (F/60)² geteilt durch
  die kleinere Beschleunigung aus `[AXIS_Z]` und `[JOINT_2]`. Mit 2 mm bei
  F2000 ist der Wächter rot.

### Prüfstand

- **Offline-Gate PASS** auf dem Inhalt von `ce29a4f`:
  - Backend: 1111 Tests.
  - Vitest: 1815 Tests.
  - Playwright: 375 Tests.
  - Lint, Build und CSS-Audit grün.
- **Nachgezogen für `4ceb185`:** Backend-pytest, 1113 Tests, alle grün.

## Review R50 · Codex · VP-I17-Rest, Pins, On-top-Spalte und Rückzug · 30. September 2026

**Ergebnis: `findings`. VP-I17 ist geschlossen. Zwei neue P2-Befunde
betreffen die Aktualisierung des G30-Pins: VP-I18 und VP-I19. Die
Pin-Darstellung, die On-top-Umstellung und die Beispielwerte für 3 mm
Rückzug haben im geprüften Umfang keinen weiteren Befund.**

Geprüft: `96cc36d..a519a81`, vollständiger Stand
`a519a8163c67fc02967d547c858450586e9941f5`, in einer Archivkopie.
Live nur dieser Anhang und neue R50-Belege; frühere Belege unverändert.
Keine Maschinenbefehle oder Quittierung.
[Reproduktion und Prüfgrenzen](viewer-palette-fest.r50.reproduce.md).

### VP-I17 · geschlossen

`ovIdx` wird nach Verbrauch freigegeben; die weiterhin benötigten
Chunk-Boxen stehen in der Quellenbilanz. Die eigene R49-Sonde mit
offengelegter Erwartungsanpassung findet nun in beiden Varianten
**0 ungezählte Byte**. Bei 100.000 markierten Paaren meldet GL
3.300.789 Byte, fat 7.303.925 Byte; das passt zu den beobachteten
Referenzen. `release()` hinterlässt nur die Programmlast.

[Ergebnisse](viewer-palette-fest.r50.ledger-probe.json),
[Sonde](viewer-palette-fest.r50.ledger-probe.ts),
[Anpassungen](viewer-palette-fest.r50.probe-adaptations.patch).
Auch die sechs neuen unabhängigen GC-Wächter für GL/fat und
Tabelle/Raum/Legacy bestehen. Damit sind VP-I13 bis VP-I17 geschlossen;
die separate Mac-Leistungsprüfung bleibt davon unberührt.

### VP-I18 · P2 · Ein bestätigtes Save G30 aktualisiert den Pin nicht zuverlässig

Der Viewer liest G30 beim Szenenaufbau und bei einer **beobachteten**
Busy→Idle-Flanke. Die erfolgreiche, bestätigte Speicherung in
`ToolsetterSettings` erreicht den Viewer dagegen nicht.
[Idle-Watcher](../../lcnc-webui/src/ThreeViewer.vue#L3110),
[Speicherung](../../lcnc-webui/src/ToolsetterSettings.vue#L237).

**Gegenprobe über die echte Oberfläche:** G30 startet bei X100; im
G30-Feld X110 eingeben, Save G30 auslösen, erfolgreiche und bestätigte
Antwort mit X110 liefern. Auch die HTTP-Position ist jetzt X110.
Ohne zusätzliches Busy-Statuspaket zeigt die Form
„G30 saved — confirmed by LinuxCNC“, aber der sichtbare Pin bleibt bei
**X100**. Vor und nach dem Speichern gibt es dieselben zwei HTTP-Lesungen.
Erst eine spätere explizite Busy→Idle-Flanke löst die dritte Lesung aus
und setzt den Pin korrekt auf X110.

[Zustände und positive Kontrolle](viewer-palette-fest.r50.g30-save-probe.json),
[Bild](viewer-palette-fest.r50.g30-save-stale.png),
[Sonde](viewer-palette-fest.r50.browser-probe.ts).

Eine kurze Parameterzuweisung muss nicht als Busy-Zustand in einem
periodischen Statuspaket erscheinen. Das ist auch kein absichtlich älterer
Interpreterstand: Speichern und Rücklesen wurden bereits bestätigt.
Form und räumliche Anzeige widersprechen sich bis zur nächsten Aktualisierung.

**Korrektur:** Bestätigte G30-Änderungen/-Lesungen explizit an den Viewer
weitergeben oder eine gemeinsame G30-Zustandsquelle verwenden. Die
Idle-Flanke darf zusätzliche Aktualisierungen auslösen, aber nicht der
einzige Auslöser nach erfolgreichem Save sein. Wächter: bestätigtes Save
ohne zwischenzeitliches Busy-Paket aktualisiert auch den Pin.

### VP-I19 · P2 · Eine verspätete G30-Antwort setzt den Pin auf einen älteren Stand zurück

`refreshG30()` entprellt nur den noch nicht gestarteten Timer. Bereits
laufende Reads bleiben parallel aktiv und jede Antwort schreibt unbedingt
nach `_g30`. Eine Reihenfolgeprüfung fehlt.
[Leseweg](../../lcnc-webui/src/ThreeViewer.vue#L557).

**Gegenprobe:** Zwei getrennte Busy→Idle-Flanken starten Reads mit X110
und anschließend X120. Zuerst die zweite Antwort liefern: Pin **X120**.
Danach die verzögerte erste Antwort liefern: Pin wieder **X110**.
Beide Antworten sind vollständig und erfolgreich, auch ihre Zeitstempel
unterscheiden sich in dieser Reihenfolge.
[Anfragen, Antwortreihenfolge und Pinwerte](viewer-palette-fest.r50.g30-race-probe.json).

**Korrektur:** Lesungen mit einer monotonen Anfragenummer und passendem
Viewer-/Verbindungskontext binden; überholte Antworten einschließlich
Fehlern verwerfen. Bei Neuinitialisierung/Abbau alte Anfragen invalidieren.
Wächter: Die vertauschten Antworten müssen X120 stehen lassen.
Der vorhandene G30-Editor verwendet bereits Tickets; der neue unabhängige
Leseweg im Viewer benötigt denselben Schutz.

### Übrige Änderungen und Validierung

- **Pins und On top:** Serverbestätigte Toolsetter-Position, fehlende
  G30-Koordinate, getrennte Schalter, Migration, Persistenz und erneuter
  Pfadaufbau sind geprüft. Der Pixeltest am XYZAC-Modell unterscheidet
  korrekt zwischen Pin über dem Kopf und verdecktem Pin. Die Darstellung
  ist abgenommen; die offene G30-Aktualisierung steht oben separat.
  [Über dem Kopf](viewer-palette-fest.r50.pin-on-top.png),
  [in der Tiefe](viewer-palette-fest.r50.pin-in-depth.png).
- **3-mm-Rückzug:** Alle drei Profile enthalten F2000/F200/3 mm. Die
  verwendete Rechnung ergibt Überläufe von 1,4815 / 2,2222 / 1,5873 mm;
  die kleinste verbleibende Reserve beträgt 0,7778 mm im XYZAC-Profil.
  Beispielwerte und Offline-Wächter sind abgenommen.
  [Werte, Rechnung und Quellenkontrolle](viewer-palette-fest.r50.retract.json).
- **Eigene Checks:** Typecheck/Build PASS; **102/102** bestehende Unit-
  Tests, **17/17** Backend-Tests, **1/1** eigene Speicher-Nachprobe,
  **6/6** originale Browserprüfungen und **2/2** reproduzierte G30-
  Gegenbeispiele auf eigenem Mock `127.0.0.1:4188`, ein Worker, niedrige
  Priorität. Die grünen Gegenproben weisen Fehler nach und bedeuten keine
  Abnahme. [Browser-Ergebnisse](viewer-palette-fest.r50.browser-summary.json).

Kein erneutes vollständiges Offline-Gate, keine Mac-Messung und keine
eigene Live-Tastfahrt. Die nächste Nachprüfung kann auf VP-I18/VP-I19
und unmittelbar dafür nötige Änderungen begrenzt bleiben.
