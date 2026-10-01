# Viewer-Markierungen: ein ruhiges Strichmuster für alle Bounds, eine Nadelfarbe

**Plan, Fassung 1 · 1. Oktober 2026 · Paket 4 der Operator-Liste.** Branch folgt nach der
Planrunde mit Codex. Renderings der Varianten liegen bei, sobald der Prototyp steht.

## Anlass

Der Operator, 1. Oktober:

> Machine bounds schwarz-weiss: Diese ändern beim Zoomen die Länge der Elemente. Gibt es eine gute
> Möglichkeit, dass das ruhiger wird? Fixe Längen anhand der Boundgrössen? Können wir für alle
> Bounds das gleiche Muster verwenden? Nicht einmal Linien, einmal Punkte?
>
> Die Toolsetter-Position und G30 sind kaum erkennbar mit den Machine Bounds zusammen. Haben wir
> noch feste Farben über, die wir verwenden können?

## Heute

**Muster:**

| Objekt | Muster | Länge |
|---|---|---|
| Maschinen-Box | lange Striche | 10 px |
| Werkzeugbahn-Box | kurze Striche | 5 px, dazu Größenlabels |
| Reach-Umrisse | Punkte | 3 px |

- Gemessen wird in CSS-Pixeln entlang jedes projizierten Segments, im Shader (Codex R44 VP-I10).
- Das Muster beginnt am ersten Ende eines Segments.

**Folge beim Zoomen:** Die Kante wird auf dem Schirm länger oder kürzer, ein Strich bleibt aber
10 px lang. An den freien Enden kommen also laufend Striche hinzu oder fallen weg, und das letzte
Element hat jede Länge zwischen 0 und 10 px. Das Muster „kriecht“ über die Kante; das ist die
Unruhe, die der Operator sieht.

**Nadeln** (Werkzeugsetzer, G30, seit heute der Kontrollpunkt): Sie haben dieselben zwei Töne wie
die Boxen, Dunkelgrau mit Hellgrau. Neben einer Box-Kante unterscheidet sie nur die Form.

## A · Ein Strichmuster, an der Geometrie verankert

1. **An der Geometrie verankert:** Jede Kante (bei Reach jede Kette) wird in eine ganze Zahl
   gleich langer Elemente geteilt, symmetrisch: Beide Enden tragen denselben Ton. Zwischen zwei
   Stufen skaliert das Muster beim Zoomen mit der Geometrie. Die Elemente werden mit der Kante
   größer, nichts kriecht, und perspektivisch fliehende Kanten verkürzen ihre Elemente wie die
   Kante selbst.
2. **Oktavstufen statt fester Zahl:** Die Elementzahl ist `N = 2^k`, so gewählt, dass ein Element
   auf dem Schirm zwischen `d` und `2d` px lang ist (Vorschlag `d = 6`).
   - Erst beim Überschreiten einer Stufe teilt sich jedes Element in zwei. Die alten Grenzen
     bleiben Grenzen; die Teilung ist ein seltenes, geordnetes Ereignis statt eines ständigen
     Kriechens.
   - Optional blendet die neue Stufe über eine halbe Oktave ein, statt hart zu wechseln.
3. **Ohne Stufen**, also mit einer festen Zahl aus der Box-Größe (wörtlich „fixe Längen anhand der
   Boundgrössen“), wäre es am ruhigsten. Weit herausgezoomt fallen die Elemente aber unter ein
   Pixel und flimmern beim Drehen (Moiré); nah dran wird ein Element bildschirmbreit. Deshalb die
   Oktaven.
4. **Ein Muster für alle Bounds:** Maschinen-Box, Werkzeugbahn-Box und beide Reach-Umrisse nutzen
   dieselbe Regel und dieselbe Elementlänge; keine Punkte mehr. Unterscheidbar bleiben die Objekte
   so:
   - Die Werkzeugbahn-Box trägt ihre Größenlabels, und ihre Kanten außerhalb des Fensters sind
     orange.
   - Die Maschinen-Box ist die äußere.
   - Reach hat Facetten und Ringe statt zwölf Kanten.

   Die Paartabelle verlangt heute für zwei Objekte ≥ 0,12 OKLab **plus** ein Formmerkmal. Für die
   beiden Boxen wäre dieses Merkmal künftig das Label, nicht mehr die Strichlänge. Das ist eine
   Regeländerung, die Codex bewerten soll.
5. **Umsetzung:** im vorhandenen `SCREEN_DASH`-Shader.
   - Der Parameter entlang des Segments ist der perspektivisch korrekte (weltlineare) Anteil `t`,
     nicht der Bildschirmabstand.
   - `N` kommt aus der projizierten Länge des Segments, im Vertex-Shader, denn `vSegPx` ist schon
     da.
   - Reach-Ketten verwenden die kumulierte Weltlänge (`instanceDistanceStart/End`) mit einer
     Oktave je Objekt.

## B · Eine feste Farbe für die Nadeln

- **Cyan `#00e5ff`** für alle drei Nadeln. Die Beschriftung unterscheidet sie, wie heute.
- **Abstand** (OKLab) zu jeder Linienrolle der einen Palette:

  | Rolle | Abstand |
  |---|---|
  | Schneide (nächste) | 0,18 |
  | Pfad | 0,23 |
  | Eilgang | 0,24 |
  | Limit | 0,35 |

  Damit liegt Cyan über der Objektregel von 0,12. Von den Box-Tönen (Grau) setzt sich der Farbton
  ab.
- **Heller Grund:** Cyan hat auf Weiß nur 1,4 : 1. Die Nadel bleibt deshalb zweifarbig: der dunkle
  Ton als durchgehende Grundlinie, Cyan an der Stelle des heutigen Hellgrau. So liest sie sich auf
  jedem Grund. Die Beschriftung bleibt helle Schrift mit dunkler Kontur.
- **Neue Rolle `--viewer-pin`:** dieselbe in allen Themes, wie die übrigen Farbrollen. In HC wird
  geprüft, ob Cyan bleibt oder Weiß nimmt.
- **Verworfene Kandidaten:**

  | Farbe | Grund | Wert |
  |---|---|---|
  | Gelb `#ffd400` | zu nah am Pfadgrün | 0,19 |
  | Gelb `#ffd400` | zu nah am Limit-Orange | 0,21 |
  | Violett `#b388ff` | zu nah am Eilgang | 0,14 |
  | Weiß | gleich dem hellen Box-Ton | 0,04 |

## Wächter

- **`scenes.viewer.spec`, Strichmuster:**
  - Innerhalb einer Oktave wandern die projizierten Elementgrenzen einer Kante mit der Geometrie
    (Zoom um Faktor 1,3: Grenzen bei denselben Kantenanteilen).
  - Bei Zoom über eine Oktave verdoppelt sich die Elementzahl, die alten Grenzen bleiben.
  - Dieselbe Regel und Elementlänge für alle vier Bounds-Rollen (`getRoleMaterials`).
- **Nadeln:** `getToolsetter` / `getToolChange` / `getControlPoint` tragen Rolle und Farbe
  `pin`. `themeTokens.test`: `--viewer-pin` in jedem Theme-Block, Abstand ≥ 0,12 zu jeder
  Linienrolle.
- Jeder Wächter zuerst rot auf dem heutigen Stand.

## Fragen an Codex

1. Oktavstufen (mit oder ohne Überblendung) gegen eine feste Zahl je Box: Ist das Moiré-Argument
   tragfähig, oder gibt es eine dritte Form?
2. `N` je Segment aus der projizierten Länge gegen ein `N` je Objekt: Eine fliehende Kante hätte
   je Segment weniger Elemente, was richtig wirkt. Bricht das die Regel aus VP-I10?
3. Dürfen Maschinen- und Werkzeugbahn-Box dasselbe Muster tragen, mit Label und Lage als
   Unterscheidung?
4. Cyan als zweiter Ton der Nadel auf hellem und dunklem Grund, und in HC?

---

## Fassung 2 · nach Codex R62 (VP62-01, VP62-02)

Cyan für die Nadeln (B) ist angenommen, auch in HC; der dunkle Träger bleibt. A ist hier neu
gefasst. Die Fassung 1 oben bleibt als Verlauf stehen.

### A' · Mustervertrag (VP62-01)

1. **Zellen:**
   - `N = 2^k` gleich lange Zellen je Einheit, abwechselnd dunkel/hell.
   - Die Phase ist am **festen ersten Ende** verankert: bei Box-Kanten das Ende mit der kleineren
     Koordinate entlang der Kante, bei Reach der Kettenanfang (Punkt 6). Sie ist von der Kamera
     unabhängig.
   - Die Grenzen verschachteln sich über die Stufen: Jede Grenze bei `N` bleibt eine bei `2N`.
   - Die Zusage „beide Enden derselbe Ton“ ist **gestrichen**; der Operator hat sie nicht
     verlangt, und sie widerspricht `2^k`.
2. **Maß nominal, nicht garantiert:**
   - `N` wird so gewählt, dass die **mittlere** Zellenlänge auf dem Schirm (projizierte Länge der
     Einheit durch `N`) zwischen 6 und 12 px liegt.
   - Unter Perspektive variieren die einzelnen Zellen entlang der Kante wie die Geometrie. Das ist
     gewollt, das Muster hängt an ihr; Codex' Beispiel reicht von 1,35 bis 56,41 px.
   - Für einzelne Zellen gibt es keine px-Garantie und keine Lesbarkeitszusage unterhalb der
     Auflösung.
   - Eine Kante, die die Near-Plane schneidet, misst ihren sichtbaren Teil.
3. **Hysterese mit Zustand:**
   - Je LOD-Einheit (Box-Kante, Reach-Kette) ein gespeichertes `N`. Es wird hochgestuft, wenn die
     mittlere Zelle 12 · 1,25 px übersteigt, und heruntergestuft unter 6 / 1,25 px.
   - Ausgewertet wird pro gerendertem Frame auf der CPU: 12 Box-Kanten und die Reach-Ketten.
   - Weitergereicht wird es als Instanz-Attribut `instanceCells`, hochgeladen nur bei einer
     Änderung.
   - Die Folge 95,99 → 96,01 → 95,99 px wechselt nicht mehr.
   - Der Vertex-Shader bleibt zustandslos; der Zustand liegt im Controller.
4. **Kurze Einheiten:**
   - `N ≥ 2`: Eine sichtbare Kontur trägt immer beide Töne, auch wenn sie nur zwei Zellen lang ist.
   - Damit kann der behobene Tonverlust kurzer Konturen (R45 VP-I12) nicht wiederkehren.
   - Degenerierte Kanten (Länge 0) werden nicht gezeichnet.
5. **Kein Überblenden zuerst:** Die Stufe wechselt hart. Eine Überblendung kommt nur, wenn ein
   gerenderter Vergleich zeigt, dass der Wechsel stört, und auch dann ohne graue Zwischenphase: Beide
   Töne bleiben voll.
6. **Reach-Ketten beim Geometrieaufbau** (nicht pro Frame):
   - Die Ketten bildet dieselbe Erkennung wie `alternateTones`: geteilte Enden, genau zwei
     Segmente je Knoten.
   - Ein Verzweigungsknoten (≥ 3) oder ein offenes Ende beendet eine Kette.
   - Ein geschlossener Ring ist eine Kette, Start am Knoten mit dem kleinsten Index.
   - Die Richtung zeigt vom Start weg; getrennte Ketten beginnen jede bei 0.
   - Die Kettenabstände (`instanceChainStart/End`) werden selbst berechnet. Nicht
     `computeLineDistances()`, das in Speicherreihenfolge kumuliert (Codex' Gegenprobe mit
     umsortierten Segmenten).
   - Die LOD-Bezugsgröße einer Kette ist ihre projizierte Gesamtlänge.
7. **Geltungsbereich:**

   | Neues Muster | Unverändert in CSS-px (`SCREEN_DASH`) |
   |---|---|
   | Maschinen-Box | die Nadeln (ein Bildschirm-Marker ohne Geometrie zum Verankern) |
   | Werkzeugbahn-Box, ihre orangen Überlaufkanten (Orange statt Hell, damit die Box ein Objekt bleibt) | der gestrichelte Eilgang (ein Pfad, kein Rahmen) |
   | beide Reach-Umrisse | |

   VP-I10 (feste Bildschirmmaße für die Boxen) wird damit bewusst ersetzt. Seine Rasterwächter
   werden gezielt umgebaut; ihre Kontrastfälle bleiben.

### A'' · Kennzeichnung der Boxen (VP62-02)

- **Ist-Stand:** Das Boxpaar ist in `palettePairs.ts` `kind: "form"`, ohne Farbabstand, mit zwei
  Merkmalen (`dashed`, `label`). Gleiches Muster nimmt `dashed` weg.
- **Neues zweites Merkmal:** Die Werkzeugbahn-Box bekommt **Maß-Endmarken**, kurze Querstriche an
  beiden Enden jeder Kante, wie eine Bemaßung. Sie sind in Bildschirmgröße, im dunklen Ton und
  liegen über dem hellen.
- **Paartabelle:** Die Merkmale des Boxpaars werden `["ticks", "label"]`. Die Zwei-Merkmal-Regel in
  `themeTokens.test.ts` bleibt bestehen, nur die Merkmalsliste ändert sich. Lage („die äußere“)
  zählt nicht als Merkmal.
- **Zur Beschriftung** zeige ich dem Operator zwei Varianten an Renderings, Codex' Hinweis folgend:
  - **(i)** Die heutigen Größenlabels (X/Y/Z-Maße) bleiben das Label-Merkmal. Ehrlich benannt: Sie
    sind weltgroß, an den Kanten, und können hinter Modellteilen liegen. Sie sind keine jederzeit
    lesbare Typbeschriftung.
  - **(ii)** Eine stabile Typbeschriftung „Program bounds“ an einer Ecke der Werkzeugbahn-Box und
    „Machine bounds“ an der Maschinen-Box. Sie ist bildschirmgroß, liegt immer oben, mit derselben
    Technik wie die Nadel-Labels, und hat eine Mindestgröße.

  Wählt der Operator (i), ist das als Regeländerung benannt: Das Label-Merkmal ist dann nicht in
  jeder Ansicht garantiert.
- **Abnahmefälle:**
  - beide Boxen sichtbar;
  - gleich große bzw. deckungsgleiche Boxen;
  - Programm teilweise außerhalb (orange);
  - Label vor und hinter einem Modellteil;
  - starkes Herauszoomen;
  - hell, dunkel und HC.

### Wächter (ersetzt die Liste der Fassung 1)

- **Zoom innerhalb einer Stufe**, in beide Richtungen: Die Übergänge einer Kante bleiben bei
  denselben Kantenanteilen. Gemessen wird an projizierten Übergängen aus der Instanzgeometrie
  (`__viewerDiag`), nicht an Materialmetadaten.
- **Zoom über eine Stufe**, beide Richtungen: `N` verdoppelt bzw. halbiert sich, die alten Grenzen
  bleiben.
- **Schwellenpendeln:** Ein Kamerapfad um 96 px herum bleibt bei einer Stufe; ohne Hysterese ist
  der Wächter rot.
- **Perspektive:** eine fliehende Kante mit großer Tiefenspanne. Die Übergänge liegen bei den
  festen Anteilen `i / N` in Weltkoordinaten; geprüft wird, dass sich auf dem Schirm keine
  Mittelwert-Garantie einschleicht.
- **Near-Plane:** Eine Kante, die die Near-Plane schneidet, bekommt ihr `N` aus dem sichtbaren
  Teil.
- **Kurz und degeneriert:** `N ≥ 2`, beide Töne gezeichnet; Länge 0 nicht gezeichnet.
- **Reach-Ketten:**
  - zwei getrennte Ketten, eine davon umgekehrt gespeichert;
  - Segmente umsortiert ergeben dieselben Phasen;
  - ein Ring beginnt am kleinsten Index.
- **DPR 1/2 und CSS-Zoom 1,5:** Die `N`-Wahl folgt CSS px.
- **Boxen:**
  - Endmarken an jeder Kante der Werkzeugbahn-Box, keine an der Maschinen-Box;
  - die Paartabelle mit `ticks` und `label`;
  - die Abnahmefälle aus A''.
- **Nadeln:**
  - Cyan auf allen drei Nadeln, auf hellem und dunklem Grund und auf Modellflächen;
  - nach einem Themewechsel und nach einem Szenen-Neuaufbau;
  - Form, Beschriftung, Bildschirmgröße und On-top unverändert;
  - `--viewer-pin` in jedem Theme-Block.
- Jeder Wächter zuerst rot auf dem heutigen Stand.
