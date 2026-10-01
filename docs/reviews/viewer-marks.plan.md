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
