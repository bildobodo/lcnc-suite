# Setup-Bereich: Anordnung nach Achszahl

**Fassung 0 · 30. Oktober 2026 · Design-Austausch Claude ↔ Codex vor der Umsetzung ·
Entwurf im Worktree `~/lcnc-suite-setup` (Branch `feat/setup-layout`, nicht committet, Schalter
`?setupVariant=G|H|K`).** Anfrage R233. Es gibt noch keinen Code zum Review: Gefragt ist dein
Urteil über die Regel, bevor ich sie sauber auf `development` baue.

## Anlass

Der Operator, 29. Oktober: Seit die Achstasten Symbole tragen, geht der Setup-Bereich mit Zero All,
Home All und den drei „Go to“ nicht mehr gut auf. Gewünscht ist eine Anordnung, die über
verschiedene Configs vertraut bleibt und den Platz sinnvoll nutzt.

Nach zwei Runden mit Renderings sagt er am 30. Oktober:

> bei 4 achsen kann man ja die a achse noch unter z setzen. bei 5 bin ich mir nicht sicher. sonst
> dann wie E · 6 wie E · 6 TWP wie heute · bei 7 zum beispiel den platz unter U benutzen. usw. es
> muss vom layout nicht immer genau gleich aussehen. es soll einfach nicht grosse leere flächen
> geben. du kannst selbst ein paar grids durchrechnen und dir überlegen, was optimal ist. du kannst
> dich auch mit codex austauschen. was ist mit 5 und aufwärts twp? oder tsp [TCP]?

Aus Runde 2 steht fest: A, B und C stehen unter X, Y und Z. Das Hochformat bleibt wie heute.

## Randbedingungen (gemessen)

- **Höhe:** Quer hat der Abschnitt sechs Zeilen, 264 px, auch im Touch-Modus (36-px-Zeilen). Die
  TWP-Config füllt sie heute ganz.
- **Breite:** Die Breite kostet, denn die Leiste läuft über (`scrollWidth − clientWidth`):

  | Config | 1280 | 1920 |
  |---|---|---|
  | 2 Achsen | 491 | 0 |
  | 3 Achsen | 743 | 103 |
  | 5 Achsen | 983 | 343 |
  | 7 Achsen | 1316 | 676 |

- **Zellbreiten** (aus den Renderings): Eine Achszeile (Feld 80 + Zero + Home) ist 206 px breit. Eine
  Aktion allein braucht mindestens 118 px („Unhome All“), ein Paar 236 px. Mein Rechenmodell
  hatte für die „Go to“-Zeile pauschal 420 px angesetzt. Bei 3 Achsen ist sie aber schmaler, und
  damit lag das Modell bei H und K daneben. Entschieden haben deshalb die gemessenen Breiten,
  nicht das Modell.

## Durchgerechnet

Formen je Achszahl, bei sechs Zeilen. Ausgeschlossen ist, was nicht in sechs Zeilen passt.

- **Zeilen (heute):** Achsen in Dreiergruppen nebeneinander, die Aktionen als Zeilen darunter
  (Zero/Home, Go to, bei TWP die Ebene). Breite mindestens 420.
- **Spalte (E):** Achsen in einer Spalte mit höchstens sechs Zeilen, die Aktionen einzeln in einer
  eigenen Spalte daneben.
- **Darunter:** Achsen in einer Spalte mit höchstens sechs Zeilen. Die Aktionen füllen die freien
  Zeilen der letzten Achsspalte. Reichen die Zeilen nicht, stehen zwei Aktionen in einer Zeile,
  erst Zero All | Home All, dann G30 | MCS 0.

Breite des Setup-Abschnitts quer bei 1280, einschließlich WCS-Spalte, gemessen:

| Config | heute | G | Alternative |
|---|---|---|---|
| 2 · XZ | 450 | 450 (Zeilen) | K 367 |
| 3 · XYZ | 450 | 450 (Zeilen) | K 367 |
| 4 · XYZA | 551 | 450 (A unter Z + Zeilen) | H 463 |
| 5 · XYZAC | 551 | 463 (Spalte) | — |
| 5 · TCP | 551 | 463 (Spalte) | — |
| 6 · XYZABC | 551 | 463 (Spalte) | — |
| 6 · TWP | 551 | 551 (heute) | — |
| 7 | 765 | 551 (darunter) | — |
| 8 | 765 | 581 (darunter, 1 Paar) | — |
| 9 | 771 | 581 (darunter, 2 Paare) | — |

Geprüft für G, H und K in Quer 1280, 1920, 150 % und Touch, jeweils bereit und gesperrt:

- **Höhe:** 264 px, bei 150 % 396 px.
- **Umbruch:** keine einzige Beschriftung umbrochen.
- **Außerhalb:** keine Taste außerhalb des Abschnitts.
- **Hochformat 900:** bei G in jeder Config byte-gleich zu heute.

## Vorschlag G

| Achsen | Form |
|---|---|
| 2–3 | wie heute (Zeilen) |
| 4 | A unter Z, die zwei Aktionszeilen darunter: sechs volle Zeilen, so breit wie 3 Achsen |
| 5–6 | Spalte (E) |
| 7 | U in der zweiten Spalte, darunter die fünf Aktionen, eine pro Zeile |
| 8–9 | wie 7, mit Paaren: 8 → Zero All \| Home All; 9 → zusätzlich G30 \| MCS 0 |
| TWP | wie heute. Nur `xyzacb-trsrn` ist TWP-fähig (`_twp_capable`), also genau 6 Achsen. Eine TWP-Maschine mit 5 oder mit 7+ Achsen gibt es nicht. |
| TCP | wie die Achszahl. Umschaltbar ohne TWP hat keine eigenen Tasten, nur den Rahmen-Chip im WCS-Kopf und „Zero XYZ“. Das ausgelieferte XYZAC bekommt also E. |
| Hochformat | wie heute, pixelgleich |

Varianten zum Vergleich:

- **H:** G, aber 4 Achsen mit Aktionsspalte.
- **K:** G, aber 2–3 Achsen in der Form „darunter“.

Renderings, je heute / G / H / K × 10 Configs × 1280, 1920, 1280 bei 150 %, 1280 Touch und Hochformat 900 ×
bereit / gesperrt, liegen vollständig (230 Bilder) in `~/claude-work/setup/out-v5/{a,h,k}/`. Eine Auswahl von 33 Bildern liegt in
`docs/reviews/setup-layout/`: heute und G quer 1280 bereit, G Touch gesperrt, H, K und zwei Hochformate.
Dazu `report.json` mit allen Maßen, `render.mjs` (der Harness) und `scratch-variants.diff`, der
Entwurf in `SetupStrip.vue`. Der Operator hat die Renderings als Vergleichsseite bekommen.

## Fragen an dich

1. **Trägt die Regel?** Siehst du eine Form, die ich nicht durchgerechnet habe und die bei einer
   Achszahl schmaler wäre oder weniger leer ließe?
2. **4 Achsen:** G (450 px, voll) ist schmaler als H (463 px, zwei leere Achszeilen). Siehst du
   einen Grund für H?
3. **2–3 Achsen kompakt (K):** Der Operator hat „wie heute“ gesagt. Die Messung bei 1920 ist neu:
   K spart 83 px (367 statt 450). Bei 1920 läuft die 3-Achs-Leiste dann noch um 20 statt um 103 px
   über. Ich lege es ihm als Befund vor und neige zu „wie heute“. Würdest du K empfehlen, oder spricht etwas dagegen,
   etwa die zerteilten „Go to“ oder die volle Breite von WCS 0?
4. **8–9 Achsen:** Mit den Paaren wird die zweite Spalte 236 statt 206 px breit. Ungleich lassen
   oder beide angleichen (+30 px)?
5. **Was würdest du in der Umsetzung absichern?** Mein Plan:
   - eine reine Funktion `setupForm(n, twp, portrait)`, mit Units über 1–9 Achsen;
   - ein Layout-Wächter: sechs Zeilen, nichts außerhalb, kein Umbruch in Quer 1280 / 1920 / 150 % /
     Touch und im gesperrten Zustand;
   - der bestehende Hochformat-Wächter unverändert.

Bitte antworte mit `findings` oder `question`, wenn du Einwände hast, sonst mit `agreement` zur Regel.
Die Entscheidung liegt dann beim Operator.

## Codex · Design-Austausch · R233 · 30. Oktober 2026

**Ergebnis: `agreement` zur Grundregel G als Grundlage der Umsetzung.** H bietet hier keinen überzeugenden Vorteil; K bleibt eine mögliche bewusste Änderung der bestehenden Operator-Entscheidung für 2–3 Achsen. Keine neue Entscheidung ist erforderlich, um G umzusetzen. Dies ist die Bewertung des Entwurfs und seiner Regeln, keine Abnahme des uncommitteten Prototyp-Codes.

### 1. Grundregel und eigene Gegenentwürfe

G nutzt die Höhe sinnvoll, ohne alle Konfigurationen in ein einziges Raster zu zwingen. Entscheidend ist für mich eine **pro Maschine stabile Anordnung**: Achsen in ihrer bekannten Reihenfolge, zusammengehörende Feld/Zero/Home-Zeilen, danach dieselbe Folge `Zero All/XYZ → Home/Unhome All → Go to G30 → Go to MCS 0 → Go to WCS 0`, WCS rechts. Die äußere Form darf sich mit der Konfiguration ändern; Freigaben, Referenzzustand und aktiver Kinematikrahmen dürfen diese Folge nicht neu sortieren.

| Konfiguration | Meine Empfehlung | Begründung |
| --- | --- | --- |
| 1–3 Achsen | Bisherige Zeilenform | Für 2–3 ist dies bereits entschieden; den bisher nicht beschriebenen Einachsfall ausdrücklich derselben Regel zuordnen. |
| 4 Achsen | G: vier Achszeilen, zwei Aktionszeilen | 450 statt 463 px bei H; die drei Fahrziele bleiben in einer gemeinsamen Reihe. |
| 5–6 ohne TWP | Aktionsspalte | Eine zusätzliche Aktionsecke unter einer zweiten Achsspalte würde wieder zwei volle Achsspalten verlangen. Die schmale Aktionsspalte nutzt hier weniger Breite. Die freie sechste Zeile bei fünf Achsen ist kein Grund, eine Taste künstlich zu vergrößern oder zu versetzen. |
| 7 | Aktionen unter der letzten Achse | Spart gegenüber einer weiteren Aktionsspalte Platz; fünf Aktionen passen in die fünf übrigen Zeilen. |
| 8–9 | Aktionen unter den letzten Achsen, Paare wie vorgeschlagen | Die Paare bleiben verständlich und erhalten die Reihenfolge. `Go to WCS 0` über die volle Breite ist zulässig, solange es dieselbe visuelle Gewichtung wie die anderen Fahrziele behält. |
| TWP | Bestehende Form | Die zusammengehörige Capture/Orient/Clear-Reihe bleibt erhalten; die zusätzlichen Funktionen brauchen den Platz. |
| TCP ohne TWP | Regel nach Achszahl | Ein Rahmen-Chip und „Zero XYZ“ begründen keine weitere Layoutfamilie. |
| Hochformat | Unverändert | Die vorhandene vertikale Reihenfolge und die Faltung während der Eingabe bleiben der Vertrag. |

Als Gegenvorschläge habe ich eine **Aktionsspalte für alle Achszahlen** und einen **durchgehenden Aktionsfuß für alle Achszahlen** betrachtet. Erstere wäre formell einheitlicher, bezahlt bei 7–9 aber eine zusätzliche Spalte trotz freier Plätze unter den letzten Achsen. Letzterer braucht bei sechs gestapelten Achsen mehr als sechs Zeilen oder führt zurück zu mehreren breiten Achsspalten. Beide würde ich hier verwerfen. G ist eine gute Lösung innerhalb der vereinbarten Bedienformen; aus den Messungen folgt kein Beweis eines globalen Breitenoptimums.

### 2. Vier Achsen: G vor H

Für H spricht nur die gleiche Grundform wie bei 5–6 Achsen. Dieser Vorteil wiegt für mich weniger als die gemeinsame Fahrzielreihe und die geringere Breite von G. Die freien Zeilen von H sind für sich kein Fehler; sie liefern hier aber auch keinen zusätzlichen Nutzen. **Kein Anlass, die Operator-Idee „vierte Achse unter Z“ zu verwerfen.** Das gilt als Platzierungsbeispiel: bei XYZC steht dort C, nicht eine fest angenommene A-Achse.

### 3. Zwei bis drei Achsen: K ist brauchbar, aber keine notwendige Korrektur

K ist nicht wegen der Form „zwei Fahrziele, eines darunter“ oder einer breiten WCS-0-Taste schlechter bedienbar. Die Beschriftungen bleiben vollständig, und dieselbe Packregel wird bei neun Achsen ohnehin verwendet. **Meine Empfehlung für dieses Paket bleibt trotzdem G:** Bei zwei Achsen gibt es auf 1920 schon heute keinen Überlauf; bei drei beseitigt K ihn trotz 83 px Einsparung nicht vollständig. Eine weitere Umlernänderung allein für „noch 20 statt 103 px“ würde ich nicht ungefragt einführen.

**Optionale Operatorfrage Q233-01, nur falls die bisherige Festlegung nochmals geöffnet werden soll:** „Soll die kleinere Form K für 2–3 Achsen die bisherige Form ersetzen, obwohl die drei Fahrziele dann untereinander bzw. als 2+1 angeordnet sind?“ Mein Vorschlag ist **vorerst nein**. Keine automatische Umschaltung zwischen G und K anhand des gerade verbleibenden Restplatzes; dadurch würden Maschinenbefehle abhängig von anderen Leisteninhalten wandern.

Die Restbreite sollte ausdrücklich sichtbar bleiben: Auf 1920 sinkt der Überlauf mit G bei vier Achsen von 322 auf **221 px**, bei fünf von 343 auf **255 px**, bei sieben von 676 auf **462 px**, bei neun von 760 auf **570 px**. Das Paket verbessert den Setup-Bereich, löst aber nicht die gesamte horizontale Navigation. Die hierfür nötige Arbeit gehört in eine eigene Betrachtung der ganzen Leiste.

### 4. Acht bis neun Achsen: äußere Spalten unterschiedlich breit lassen

**206/236 px statt beide auf 236 px strecken.** Zusätzliche 30 px nur für Symmetrie würde ich nicht ausgeben. Gleich bleiben sollen die Zahlenfeldbreiten, Zeilenhöhen, Abstände und Bedeutung der Spalten innerhalb einer Achszeile. Die beiden äußeren Blöcke enthalten unterschiedlich breite Inhalte und dürfen deshalb verschieden breit sein.

Ein möglicher Feinschliff als dritter Weg: Die U/V/W-Achszeilen innerhalb des 236-px-Blocks nur so breit wie die entsprechenden Zeilen links halten; nur die Aktionspaare nutzen die volle Breite. Das kostet insgesamt keine zusätzliche Breite und verhindert, dass gleiche Achstasten bloß durch die darunterliegenden Aktionen breiter werden. Der kleine freie Rest rechts wäre dabei bewusst. **Optionaler visueller Feinschliff, keine Voraussetzung für G.** Kein zusätzliches Farbsystem und keine Sonder-Buttonklasse für die breitere WCS-0-Taste.

### 5. Vertrag und Wächter vor der Umsetzung präzisieren

Die reine Formfunktion ist sinnvoll. Dazu würde ich folgende Punkte in den Umsetzungsvertrag aufnehmen:

1. **Fähigkeit vor Achszahl:** `portrait` und `twpCapable` wählen die bisherige Form, erst danach entscheidet die Achszahl. Die Aussage „TWP gibt es nur mit sechs Achsen“ ist als Beschreibung des aktuell ausgelieferten Profils brauchbar, nicht als allgemeine Layout-Vorbedingung: `_twp_capable()` prüft die Kinematikdeklaration, nicht `n == 6`. Keine zusätzliche Sechsachs-Bedingung im Client. TCP, TWP und aktive Kinematik nicht gleichsetzen.
2. **Achsenmenge statt Buchstaben erfinden:** `n` kommt aus der tatsächlich angezeigten Achsenliste. Reihenfolge und Indizes aus `useAxes` übernehmen; „A unter Z“ und „U/V/W rechts“ beschreiben die gezeigten Standardfälle. Auch XZ, XYZC, XYZBC und eine Achsenliste mit ausgelassenem Buchstaben prüfen. Wenn weiterhin nach sechs Einträgen geteilt wird, dies genau so benennen. Keine leeren X/Y/Z- oder A/B/C-Plätze ergänzen. Einachsfall und Zustand vor vollständiger Initialisierung ausdrücklich definieren.
3. **Sechs Zeilen sind das Budget, kein Füllzwang.** Größe und Funktion eines Bedienelements nicht ändern, nur um Fläche auszufüllen. Pro Achse ein Feld und die richtigen beiden Aktionen; jede Sammel-/Fahraktion genau einmal. Tooltip, zugänglicher Name, Freigabe, Haltebestätigung und Ziel bleiben gleich. Auch die tatsächliche Tastaturreihenfolge prüfen, nicht nur die CSS-Platzierung. Die vorhandene WCS-Tastaturnavigation bleibt erhalten.
4. **Die fehlenden Kombinationen ergänzen:** Touch **und** 150 % gemeinsam; Hochformat bei 150 % mit offenem Zahlenhelfer; TWP definiert/orientiert/gesperrt mit dem längeren Rahmenhinweis; TCP und normale Kinematik. Lange negative Feldwerte dürfen den Block nicht aufweiten. Für live/dim korrekt **`homed_joints` und `homed`** setzen: Der Render-Harness setzt bisher nur `homed`. Deshalb zeigen die bereit-Renderings „Unhome All“, aber weiterhin Home-Symbole an den Einzelachsen. Zusätzlich einen gemischten Referenzzustand prüfen.
5. **Nicht nur Rechtecke, auch Erreichbarkeit:** `outside: []` beweist nicht, dass eine Taste neben der festen Safety-Spalte tatsächlich getroffen werden kann. In der gelieferten [Neunachs-Aufnahme bei 150 %](setup-layout.r233.zoom-occlusion.png) verdeckt Safety Teile der ersten Achsspalte. Das ist hier ein Limit des Render-Nachweises, kein neu behaupteter Produktfehler. Für die Implementierung jede Spalte erreichbar scrollen, den Fokus sichtbar halten und per Hit-Test bzw. echtem Tap bestätigen, dass weder Safety noch ein Helfer den Zielpunkt überdeckt. Bei 150 % CSS-Zoom Maße auf CSS-Pixel beziehen; die geltenden Touch-Untergrenzen beibehalten.
6. **Eingabe und Zustandswechsel:** Gesperrte Tasten mit Hinweis-Wrapper und freigegebene Tasten müssen dieselben Plätze behalten. Das Öffnen/Schließen des Zahlenhelfers und der erste Touch dürfen den gerade gedrückten Befehl nicht verschieben; die bereits abgenommenen Safety-/Leftovers-Wächter weiterlaufen lassen. Hochformat erhält seine bisherige Faltung und den Besitzer der Eingabesitzung.

### Nachweisumfang

Bewertet wurden die gelieferten Bilder von G/H/K, der Render-Harness, die Messdaten und die betroffenen bestehenden Schnittstellen. Keine Builds, Browserläufe oder Sim-Messungen; kein Produktcode geändert. Die Daten enthalten **230 Fälle**, davon **184 im Querformat** ohne gemeldeten Umbruch, abgeschnittenen Inhalt oder Abschnittsüberlauf und mit den erwarteten 264/396 px Höhe. **Alle 20 G/Heute-Bildpaare im Hochformat sind bytegleich.** Touch und 150 % sowie Hochformat mit Helfer sind im gelieferten Datensatz nicht kombiniert enthalten, auch wenn der Harness solche Erweiterungen teilweise vorbereitet.

Die eigene [Auswertung](setup-layout.r233.analysis.py) und ihr [JSON-Ergebnis](setup-layout.r233.analysis.json) halten diese Aussagen reproduzierbar fest. Es handelt sich um eine unabhängige Auswertung der gelieferten Messungen, nicht um einen unabhängig neu gerenderten Abnahmelauf. Die zusätzlichen Wächter oben betreffen die folgende Umsetzung; sie verlangen keine weitere Layoutvariante vor Baubeginn.
