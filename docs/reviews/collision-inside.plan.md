# Innenprüfung — ein Körper ganz in einem anderen

**Plan, Fassung 1 · 8. Oktober 2026 · Kollisionsplan Schritt 2 (Operator 2026-10-06/07) · zur Planprüfung an Codex mit R96, vor dem ersten Code.**

## Befund

Die Kollisionsprüfung misst **Oberflächenabstände** (`pairDistance`, three-mesh-bvh `closestPointToGeometry`). Steckt ein Körper ganz in einem anderen, sind die Oberflächen getrennt, und der Abstand ist größer als null. Das Paar gilt dann als „getrennt“ oder als Beinahe-Kollision.

Live gesehen (Operator 2026-10-07, haus.ngc auf XYZAC, weit außerhalb der Verfahrwege): Die `y_guide_endcaps` stecken ganz im `column_foot` und sind nicht eingefärbt.

## Was die stetige Bewegung schon leistet

Hinein kommt ein Körper bei stetiger Bewegung nur über eine Berührung der Oberflächen. Den Beginn findet der Sweep mit seiner Garantie: Kein Kreuzen breiter als `MIN_ADV` wird übersehen. Die Lücke liegt an drei Stellen:

1. **Trennungsentscheidung.** Ein berührendes Paar, dessen nächste Abfrage `d > CONTACT_EPS` liefert, gilt als getrennt. Steckt der Körper inzwischen tiefer drin, ist das falsch: Der Kontakt endet zu früh, Einfärbung und Ausdehnung brechen ab.
2. **Erste Stellung und Ruhestellung** (Basislinie). Ein Paar, das schon drinsteckt, wird nie als Kontakt erkannt.
3. **Nach einem Sprung.** Gemeint sind Umbenennungspunkte, unbekannte Starts und der Werkzeugtausch, also jede Stelle, an der der Sweep nicht stetig fährt.

Heraus kommt ein Körper ebenfalls nur über eine Berührung: `d` fällt wieder gegen null. Das Ende eines Innen-Kontakts ist also wie heute über die Oberfläche bestimmbar.

## Vorgehen

**1. Prädikat `contained(A, B)`.** Gilt für geschlossene Netze und nur, wenn die Oberflächen sich nicht berühren. Dann liegt eine Zusammenhangskomponente des einen Körpers entweder ganz innen oder ganz außen im anderen. Ein Punkt je Komponente genügt also.

- Je Komponente von A ein Eckpunkt wird gegen B per **Strahlparität** geprüft, und umgekehrt. Ungerade Zahl der Durchstoßungen heißt innen.
- **Umsetzung:** `MeshBVH.raycast` mit `DoubleSide`, alle Treffer.
- **Robustheit gegen Kanten- und Eckentreffer:** drei feste, „schiefe“ Richtungen, Mehrheitsentscheid. Sind sich die drei nicht einig, gilt das als **unentschieden**, und unentschieden zählt als Kontakt (konservativ).
- **Alternative:** die verallgemeinerte Windungszahl, exakt und robust, aber O(Dreiecke) je Punkt. Frage an dich unten.

**2. Vorfilter.** Die Box einer Komponente, in den Rahmen des anderen Körpers gebracht, muss in einer Komponentenbox des anderen liegen, sonst ist sie nicht drin. Das ist billig; `componentBoxes` gibt es schon.
- Neu sind Stellvertreterpunkte je Komponente (`compVerts`), ohne die Kappung `MAX_COMPS`.
- Ein Körper mit sehr vielen Komponenten (Dreieckssuppe) kostet viele Strahlen. Ab einer Grenze wird er als „Innen nicht prüfbar“ benannt statt geprüft.

**3. Wo geprüft wird:**
- (a) Basislinie: Ein Paar, das in der ersten **und** in der Ruhestellung drinsteckt, ist ein statischer Kontakt wie heute. Nur in der ersten Stellung drin heißt: Das Programm beginnt in einer Kollision (Einsatz auf der ersten Zeile).
- (b) Jede Trennungsentscheidung eines berührenden Paars: drin → weiter Kontakt.
- (c) Nach jedem Sprung: alle Paare, deren Vorfilter passt.
- (d) Die Verfeinerung (Bisektion von Beginn und Ende) nutzt „berührt oder drin“.
- (e) Innen-Kontakt verhält sich in Zertifikaten, Kadenz und Folgemarken wie Berührung (EXPLORE-Kadenz, Zeilenmarken). Die Schnittpaare Werkzeug × Rohteil bekommen dieselbe Vorschub/Eilgang-Semantik. Ein Fräser ganz im Rohteil ist Zerspanen, sein Beginn im Eilgang bleibt der Befund.

**4. Geschlossene Netze als Voraussetzung.** Ein Modelltest verlangt für jeden kollidierenden Körper geschlossene Komponenten: Zu jeder gerichteten Kante gibt es die Gegenkante, keine doppelte Kante in gleicher Richtung.

Stand 2026-10-08:
- **XYZAC und TWP-Portal:** alle Körper geschlossen.
- **3-Achs-Modell:** `frame`, `x_axis` und `y_axis` haben 270, 122 und 184 gleichgerichtete Doppelkanten (Display-STLs ohne Kollisionsproxy). Für Paare mit ihnen ist die Innenprüfung nicht entscheidbar. Das wird in `uncertified` benannt („enclosure not checked: frame, x_axis, y_axis“), bis Proxies (Boxen je Komponente, `stl_collision_proxy.py`) sie ersetzen.

**5. Orakel.** `collisionOracle.test.ts` bekommt eine eigene Innen-Wahrheit: Parität über alle Dreiecke, ohne BVH, unabhängig vom Produkt. Die Zufallsbahnen werden um Stellungen ergänzt, in denen ein Körper ganz in einem anderen steckt.

**6. Tests:**
- **Einheiten:** verschachtelte Boxen; ein Hohlkörper (Punkt im Hohlraum ist außen); mehrere Komponenten; Strahl genau durch eine Kante oder Ecke.
- **Sweep:**
  - hineinfahren und drin bleiben: ein Kontakt bis zum Herausfahren;
  - drin beginnen: Beginn auf der ersten Zeile;
  - nach einem Sprung drin;
  - drin in der Ruhestellung: statisch.
- **Echtes Modell:** die Endkappen-Stellung aus haus.ngc auf XYZAC.
- **Mutationen:** Prädikat aus, nur an der Basislinie, Mehrheit ersetzt durch einen Strahl, unentschieden als außen.

**7. Kosten.** Gemessen wird am haus-Payload vor und nach (`profile`). Prüfungen fallen nur an Trennungsentscheidungen, an der Basislinie und an Sprüngen an. Im Dauerkontakt mit berührenden Oberflächen entfallen sie. Ganz drin kostet jede EXPLORE-Probe Komponenten × 3 Strahlen; die Endkappen haben 16 Komponenten.

## Fragen an dich

1. **Mehrheit aus drei Strahlen oder Windungszahl?** Bei der Mehrheit zählt unentschieden als Kontakt. Die Windungszahl ist exakt, kostet aber O(Dreiecke) je Punkt; bei 5576 Dreiecken der C-Planscheibe sind das etwa 0,1 ms je Punkt.
2. **Teil- und Zwischenstände (Shards, Peek):** Reicht es, das Prädikat in den Kern zu legen? Alle Wege laufen über `noteQuery` und die Verfeinerung. Oder siehst du einen Pfad, der es umgeht?
3. **Fräser im Rohteil:** Soll „ganz drin“ für das Schnittpaar anders gelten? Der Schaft im Rohteil zählt heute als Zerspanen.
