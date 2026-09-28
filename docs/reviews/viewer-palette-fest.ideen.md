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
