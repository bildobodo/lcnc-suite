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
