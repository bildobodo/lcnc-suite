# Innenprüfung — ein Körper ganz in einem anderen

**Plan, Fassung 3 · 8. Oktober 2026 · Kollisionsplan Schritt 2 (Operator 2026-10-06/07).**
- Fassung 1 ging mit R96 zur Planprüfung an Codex.
- Fassung 2 nimmt VP96-01 bis 03 und die Antworten auf die drei Fragen auf (Antworttabelle am Ende); Codex hat sie in R97 angenommen.
- Fassung 3 weicht bei offenen Netzen begründet ab (Abschnitt „Fassung 3“), erkannt beim Einbau von Schritt 2.

## Befund

Die Kollisionsprüfung misst **Oberflächenabstände** (`pairDistance`, three-mesh-bvh `closestPointToGeometry`). Steckt ein Körper ganz in einem anderen, sind die Oberflächen getrennt, und der Abstand ist größer als null. Das Paar gilt dann als „getrennt“ oder als Beinahe-Kollision.

Live gesehen (Operator 2026-10-07, haus.ngc auf XYZAC, weit außerhalb der Verfahrwege): Die `y_guide_endcaps` stecken ganz im `column_foot` und sind nicht eingefärbt.

## Was die stetige Bewegung schon leistet

Hinein kommt ein Körper bei stetiger Bewegung nur über eine Berührung der Oberflächen, heraus ebenso. Den Beginn findet der Sweep mit seiner Garantie: Kein Kreuzen breiter als `MIN_ADV` wird übersehen.

Daraus folgt eine **Invariante**: Ein Paar, das zu einem Zeitpunkt bekannt **nicht** ineinander steckt und ein Freiraumzertifikat hat, kann bis zum Ablauf des Zertifikats nicht hineingeraten. Die Innenprüfung ist also genau dort nötig, wo „nicht ineinander“ noch nicht bekannt ist oder wo das Freiraumzertifikat ohne sie entstünde:

1. **Basislinie** (erste Stellung und Ruhestellung, `collision.ts:1423/1440`);
2. **nach jedem Sprung**: Umbenennungspunkte, unbekannte Starts, Werkzeugtausch (`installToolVariant`), also jede Stelle, an der der Sweep nicht stetig fährt;
3. **jede Trennungsentscheidung**: Ein berührendes Paar, dessen nächste Abfrage `d > CONTACT_EPS` liefert, auch `Infinity` jenseits des Horizonts;
4. **die Verfeinerung** (`:1596`, Bisektion von Beginn und Ende): Das Prädikat dort ist „berührt oder steckt drin“.

Die frühen Antworten von `pairDistance` (`:807–823`) vertragen sich mit der Innenlage:
- **Kugelabstand:** Steckt I in O, liegt Is Mittelpunkt in Os Kugel, also `centerDist − rO − rI ≤ −rI < 0`. Kein Frühausstieg.
- **Komponentenboxen:** Is Boxen schneiden die Box der umgebenden Komponente, die untere Schranke ist 0. Kein Frühausstieg.
- **Horizont:** Jenseits des Horizonts liefert die Abfrage `Infinity`. Ein tief steckender Körper sieht dort „weit weg“ aus. Deshalb gilt Punkt 3 ausdrücklich auch für `Infinity`.

## Vorgehen

**1. Dreiwertige Entscheidung `inside(A, B)`: `outside | inside | undecidable`** (VP96-03).

- **Gültigkeit:** Sie gilt nur, wenn die Oberflächen sich nicht berühren (`d > CONTACT_EPS`). Dann liegt jede Zusammenhangskomponente des einen Körpers ganz innen oder ganz außen im anderen. Je Komponente genügt also ein Stellvertreterpunkt (`compVerts`, ein Eckpunkt).
- **Vorgehen:** Die Punkte von A werden gegen B geprüft und umgekehrt. Ist ein Punkt innen, ist das Paar `inside`. Ist einer unentscheidbar und keiner innen, ist es `undecidable`.
- **Verbraucher:**
  - `inside` zählt wie Berührung: Kontaktzustand, EXPLORE-Kadenz, Zeilenmarken, Intervalle, Einfärbung.
  - Für das Schnittpaar Werkzeug × Rohteil gilt die bestehende Vorschub/Eilgang-Regel (`pairCutting`); keine Ausweitung, siehe Frage 3.
  - `undecidable` erzeugt **weder** ein Freiraumzertifikat **noch** einen statischen Ausschluss. Das Paar wird mit EXPLORE-Kadenz weiter abgefragt.
  - Ein unentscheidbares Paar wird nicht als Kollision gemeldet, aber in `uncertified` benannt („inside check undecidable: endcaps ↔ column foot at L…“).
  - Wird es an Erst- und Ruhestellung festgestellt, schließt es nicht aus: `staticExcluded` verlangt eine **entschiedene** Berührung oder Innenlage.

**2. Zählung der Durchtritte** (VP96-02): ein Strahl mit festgelegten Regeln, kein Mehrheitsentscheid.

- **Strahlrichtungen:** fest, nicht achsenparallel, als Liste von K = 6 Richtungen.
- **Treffer:** Für die Treffer eines Strahls (`MeshBVH.raycast`, `DoubleSide`, alle Treffer) wird geprüft, ob einer **degeneriert** ist:
  - eine baryzentrische Koordinate unter ε_b = 1e-6, also nahe an Kante oder Ecke;
  - oder |cos(Strahl, Dreiecksnormale)| unter ε_n = 1e-6, also nahezu tangential;
  - oder zwei Treffer mit Abstandsunterschied unter ε_t = 1e-6 · Körperdiagonale.
- **Bewertung:** Ist der Strahl frei von Degeneration, ist jeder Treffer ein echter Durchtritt durch eine geschlossene Fläche, und die Parität gilt exakt. Ein degenerierter Strahl wird verworfen, die nächste Richtung folgt.
- **Ergebnis:** Der erste nicht degenerierte Strahl entscheidet. Sind alle K degeneriert, ist das Ergebnis `undecidable`.
- **Codex' Gegenprobe** (Boxmittelpunkt, Strahl durch eine gemeinsame Kante, zwei Treffer am selben Abstand) wird damit als degeneriert erkannt und verworfen, statt außen zu melden. Sie wird Einheitstest.

**3. Vorfilter nur als zulässiger Ausschluss** (VP96-01).

- **Kein Ausschluss aus aufgeblähten Boxen:** Kein „außen“ aus dem Einschluss einer transformierten, aufgeblähten Box.
- **Zulässig ist ein Punkttest im Bezug des umgebenden Körpers:** Der Stellvertreterpunkt von A wird exakt in Bs lokalen Bezug gebracht. Liegt er außerhalb **aller** lokalen Komponentenboxen von B, kann diese Komponente von A nicht in B stecken.
  - Begründung: In B liegen heißt im Volumen einer Komponente von B liegen, und die liegt in ihrer lokalen Box.
  - Die lokalen Boxen von B sind exakt, nicht transformiert.
- **Codex' Quader-Gegenprobe** (lokal um 45° gedreht, ganz in einer Box) besteht damit: Der Punkt liegt in der Box. Sie wird Einheitstest, zusammen mit dem zuerst geplanten Filter, der dort rot sein muss.

**4. Gültigkeit der Netze zur Laufzeit, nicht nur im Repository.**

- **Beim Modellbau** (`buildCollisionModel`) prüft jeder Körper je Komponente, ob sein Netz geschlossen ist: zu jeder gerichteten Kante die Gegenkante, keine gleichgerichtete Doppelkante, nach `withoutArealessFacets`.
- **Nicht geschlossen** führt zu `insideCheckable = false`. Für Paare mit diesem Körper ist die Innenprüfung `undecidable` (Punkt 1).
- **Dasselbe gilt für:**
  - Werkzeugvarianten (`installToolVariant`; der parametrische Zylinder ist geschlossen, importierte STL-Werkzeuge werden geprüft);
  - Körper über der Komponentengrenze `MAX_COMPS` (dort zählt die Komponentenzahl der Stellvertreterpunkte, nicht die gekappte Boxliste);
  - beschädigte Körper (`model.damaged`).
- **Stand der eingecheckten Modelle** (Messung 2026-10-08):
  - XYZAC und TWP-Portal: alle Körper geschlossen.
  - 3-Achs-Modell: `frame`, `x_axis` und `y_axis` haben gleichgerichtete Doppelkanten (270, 122, 184). Sie werden als „inside check not possible“ benannt, bis Kollisionsproxies sie ersetzen.
- **Ein Repository-Test** hält den Stand der eingecheckten Modelle fest.

**5. Unabhängige Kontrolle** (VP96-02).

- **Analytische Fälle:** Box in Box, Hohlkörper (Punkt im Hohlraum ist außen), zwei Komponenten, Kanten- und Eckenstrahlen, mit bekannter Antwort.
- **Anders hergeleitete Innenentscheidung:** verallgemeinerte Windungszahl, Raumwinkelsumme nach Van Oosterom–Strackee über alle Dreiecke, ohne BVH. Netzvertrag: geschlossen, einheitlich orientiert. Grenze: |w − round(w)| < 0,25, sonst unentscheidbar.
- **Prüfung:** Beide Wege werden an den analytischen Fällen gemessen und gegeneinander auf Zufallspunkten der mitgelieferten Modelle.
- **Orakel:** `collisionOracle.test.ts` nutzt die Windungszahl als Innen-Wahrheit, nicht den Produktweg. Die Zufallsbahnen werden um Stellungen ergänzt, in denen ein Körper ganz in einem anderen steckt.

**6. Ein Kern, alle Wege.** Die Entscheidung liegt in **einer** Funktion vor jeder Schlussfolgerung „getrennt“: Basislinie, Sprung, Werkzeugtausch, `noteQuery`, Verfeinerung. Repository-Prüfungen:
- Basislinie: drin in Erst- **und** Ruhestellung ist statisch; nur in der ersten ist Einsatz auf der ersten Zeile; `undecidable` in beiden schließt **nicht** aus.
- Sprung: drin nach einem Umbenennungspunkt.
- Werkzeugtausch: ein Werkzeug, das nach dem Tausch im Rohteil oder in einem Bauteil steckt.
- Verfeinerung: Beginn und Ende eines Innen-Kontakts an der Oberflächenkreuzung.
- Gleichheit von Einzel- und Shard-Lauf, Peek und Weiterlauf, Nebenfahrt (`sweepShards.test.ts`-Muster).
- Echtes Modell: die Endkappen-Stellung aus haus.ngc auf XYZAC (Payload im Scratchpad, nicht eingecheckt: Operator-Daten).

**7. Kosten** erst nach der Korrektheit gemessen, am haus-Payload mit `profile`. Prüfungen fallen nur an den vier Stellen oben an; im Dauerkontakt berührender Oberflächen entfallen sie. Ganz drin kostet jede EXPLORE-Probe Komponenten × Strahl(e); die Endkappen haben 16 Komponenten.

## Fassung 3 · Offene Netze werden einmal benannt, nicht bei jeder Abfrage gefragt

**Abweichung von Fassung 2, Punkt 1 und 4** (beim Einbau von Schritt 2 erkannt, 8. Oktober 2026).

„Unentscheidbar“ hat zwei Ursachen mit verschiedenem Charakter:

- **Alle Strahlen degeneriert:** eine Eigenschaft der Stellung. Eine spätere Stellung entscheidet die Frage in aller Regel. Hier gilt Fassung 2 unverändert: kein Freiraumzertifikat, erneute Frage im EXPLORE-Takt, kein statischer Ausschluss, die Strecke bleibt dauerhaft benannt.
- **Der umgebende Körper ist nicht geschlossen:** eine Eigenschaft des Netzes. Er hat in **keiner** Stellung ein Inneres. Eine erneute Frage entscheidet sie nie.

**Warum die Abfrage-Regel für offene Netze nichts gewinnt:**
- Das Freiraumzertifikat begrenzt Oberflächenkreuzungen: (d − Marge) / V. Es gilt unabhängig davon, ob ein Körper innen liegt.
- Der Innen-Zustand ändert sich nur über eine Oberflächenberührung, und die findet der Sweep.
- Ohne Zertifikat liefe jedes Paar mit einem offenen Körper dauerhaft im EXPLORE-Takt, ohne je eine Antwort zu bekommen. Auf dem 3-Achs-Standardmodell betrifft das jedes Paar mit `frame`, `x_axis` oder `y_axis`.

**Regel ab Fassung 3:**
- Ein offener Körper wird als umgebender Körper **nicht gefragt**.
- Er wird **einmal pro Modell** in `uncertified` benannt: „frame, x_axis, y_axis: surface not closed — a part wholly inside them is not found“ (`CollisionModel.open`, `geometryNote`).
- Seine Paare behalten die Garantie der Oberflächen.
- Ein statischer Ausschluss entsteht für sie wie bisher nur aus der Oberflächenberührung, nie aus einer Innenlage **in** dem offenen Körper. Die Gegenrichtung, ein offener Körper ganz in einem geschlossenen, wird weiter erkannt (Codex R101).

Die Gegenrichtung bleibt geprüft: Ein geschlossener Körper in einem offenen wird gegen den geschlossenen gefragt, falls umgekehrt.

## Reihenfolge (Codex R96)

1. Gültigkeits- und Unentscheidbarkeitsvertrag mit den kleinen Gegenproben (Kantenstrahl, gedrehter Quader, Hohlkörper).
2. Zentraler Paarentscheid mit Basislinie und Verfeinerung.
3. Sprünge und Werkzeugvarianten.
4. Gleichheit über alle Worker-Wege und der haus-Modellfall.
5. Kostenmessung.

## Antworten auf Codex R96

| Punkt | Antwort | Planänderung |
|---|---|---|
| VP96-01 | Angenommen; die Quader-Gegenprobe ist richtig. | Abschnitt 3: Ausschluss nur per Punkttest gegen die exakten lokalen Boxen des umgebenden Körpers; die Gegenprobe wird Test. |
| VP96-02 | Angenommen. Trefferparität ohne Regel zählt eine Kante doppelt; „Mehrheit“ und „Uneinigkeit → unentschieden“ waren zwei Regeln. | Abschnitt 2: ein nicht degenerierter Strahl entscheidet (Degeneration nach ε_b / ε_n / ε_t), alle K degeneriert → `undecidable`. Abschnitt 5: analytische Fälle plus Windungszahl als anders hergeleiteter Kontrollweg. |
| VP96-03 | Angenommen. | Abschnitt 1: dreiwertig bis zu den Verbrauchern; `undecidable` gibt weder Zertifikat noch statischen Ausschluss. Abschnitt 4: Laufzeitprüfung der Netze, Werkzeugvarianten, Kappung, beschädigte Körper. |
| Frage 1 | Einzelstrahl mit Degenerationsregel im Produkt, Windungszahl als Kontrolle. | Abschnitte 2 und 5. |
| Frage 2 | Ein Kern vor jeder Schlussfolgerung „getrennt“, nicht nur in `noteQuery`. | Abschnitt „Was die stetige Bewegung schon leistet“ (vier Stellen, Horizont) und Abschnitt 6. |
| Frage 3 | Bestehende Schnittpaar-Semantik, keine Ausweitung. | Abschnitt 1. |
