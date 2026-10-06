# R84 · Grundlage des Ideenreviews · 2026-10-06

Referenz `092d00b1beab9d6379a2019293abced5ff3b8a9b`.
Der Bereich `20769171..092d00b1` ändert nur Review-Dokumente und Belege.
Dies ist eine Ideenprüfung, keine Abnahme einer Implementierung.

## Gelesen und eingeordnet

- R84-Anfrage, mitgelieferter `zz_haus_sweep.test.ts` und ausgewählte
  Kinematik-/Statusfelder aus dem privaten Init. Dessen fünf Achsen,
  xyzac-trt-Typ und Zustandsbasis passen zur Beschreibung. Der bereitgestellte
  Volltest wurde NICHT ausgeführt; dessen Laufzeit und Ergebnisstatistik
  werden nicht als eigene Messung ausgegeben.
- Private Binärvorschau und Init werden weder in die Review-Belege kopiert
  noch an Webdienste übermittelt. Die synthetischen Belege verwenden nur
  selbst erzeugte Würfel und Bahnen.
- Unveränderte Quellen aus `git archive 092d00b1 lcnc-webui`, archiviert in
  `/tmp/codex-r84-ftoj61wy/archive`; Abhängigkeiten einzeln verlinkt, eigener
  Vitest-Cache. Kein Build, kein Browser, kein Serverport, kein LinuxCNC-Zugriff.

## Maßgebliche Quellstellen am Referenzstand

| Frage | Quelle | Konsequenz |
| --- | --- | --- |
| Paarweise Färbung | `ThreeViewer.vue:3857`, `_updateClashTint`, `lineHasRecord` | Die Sperre ist heute zeilenweit; die Menge der gefärbten Körper ist bereits die Vereinigung aktiver Paarseiten. |
| Gemeinsame Ableitung | `viewer/clashTargets.ts`; `ThreeViewer.vue:2925,2944`; `ScrubBar.vue:897` | Targets überspringen Fortsetzungen/carried-Anfang; Code-Marken lesen raw hits, Bänder und Tint lesen zusätzlich Intervalle/Spannen. Eine gemeinsame Ereignisquelle braucht mehrere wohldefinierte Abfragen. |
| 200er-Kappung | `viewer/collision.ts:944,1277,1471–1483,1615` | `worst` sammelt intern Zeile/Paar-Datensätze und Samples; erst `buildResult` wählt 200 aus, Onsets zuerst. `truncated` beschreibt die geprüfte Strecke, nicht den Verlust von Meldungen. |
| Zweite Kappung | `viewer/collision.ts:1511–1523` | Mehr als 16 Cluster werden am Ende zu einem größeren Intervall verbunden. Freie Lücken können dadurch verschwinden. |
| Ausgangsausschluss | `viewer/collision.ts:1217–1272` | Innerhalb der Margin an Start UND Ruhepose führt bei betroffenen Maschinenpaaren zu dauerhaftem Überspringen. Werkzeugpaare sind ausgenommen. |
| Geometrisches Maß | `viewer/collision.ts:1020–1030` | Unsigned closest-point-Abfrage von Oberflächen; keine Durchdringungstiefe. |
| Schritte und Kosten | `viewer/collision.ts:245,313,740,790–796,1790–1814,1848–1854` | `EXPLORE=max(5,4)=5` bei den Optionen des gelieferten Tests; `MIN_ADV=0.25` ist etwas anderes. Zusätzlich pro Kontaktzeile erneute Abfrage. `profile` zählt Queries und Zeit je Paar. |
| Garantiebereich | `viewer/collision.ts:10–20,257–263,740–743` | Räumliche Mindestschritte und geprüfte Kinematikfamilien; dies ist weder eine Aussage über ungekappte Ausgabe noch über ausgeschlossene Paare. Track-cum kann Zeit sein und ist nicht die interne räumliche Schrittachse. |
| Anfahrt | `viewer/sweepMerge.ts:14–78` | Verschiebung der Track-Achse, eigene Herkunft und carried/continuation-Semantik müssen erhalten bleiben. |

## Kleine Gegenproben

Aufruf im archivierten `lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r84.vitest.config.ts
```

Zum Wiederholen die beigelegte `viewer-palette-fest.r84.vitest.config.ts`
als `r84.vitest.config.ts` in das archivierte `lcnc-webui` kopieren, die Sonde
als `src/viewer/r84.probe.test.ts` ablegen und neben `lcnc-webui` einen Ordner
`evidence` anlegen. Ergebnis: drei bestandene diagnostische
Prüfungen, rund eine Sekunde Gesamtlaufzeit. Diese Tests bestätigen Grenzen
des aktuellen Verhaltens; PASS bedeutet hier nicht, dass das geplante
Verhalten bereits umgesetzt wäre.

1. MeshBVH mit zwei 2×2×2-Würfeln: 0,1 bzw. 1,8 Überlappung entlang X
   liefern beide Oberflächenabstand 0. Ein mittig eingeschlossener
   0,5×0,5×0,5-Würfel liefert Abstand 0,75.
2. 17 getrennte Eintauch-/Rückzugszyklen zweier 10er-Würfel, gleiche rohe
   Zeilennummer: Ausgabe enthält 16 Intervalle. Das letzte reicht ungefähr
   von 1390 bis 1490; bei 1440 steht der bewegte Würfel aber wieder vollständig
   außerhalb. Kein `truncated`-/`uncertified`-Hinweis.
3. 201 Eintauchzyklen mit getrennten Zeilen: 200 Onsets werden ausgegeben,
   letzter gemeldeter Anfang L400 statt des ebenfalls vorhandenen L402.
   `truncated` und `uncertified` sind null; kein Ausgabe-Vollständigkeitsfeld.

Nicht gemessen: neue Performanceoptimierungen, die reale haus.ngc-Dauer,
Speicherbedarf des großen Programms oder eine neue Kinematikgarantie.
Die vorgeschlagenen Belege im Review sind Abnahmekriterien für die
zukünftige Umsetzung, keine bereits bestandenen Tests dafür.

## Primärquellen für die Alternativen

MoveIt dokumentiert explizite Paar-Ausnahmen in der Allowed Collision
Matrix. Übernommen wird die explizite, überprüfbare Deklaration; eine
automatisch erzeugte Ausnahme ist damit nicht als sicher bestätigt.
[MoveIt: ACM](https://moveit.picknik.ai/main/doc/concepts/kinematics.html#allowed-collision-matrix-acm)

MoveIt trennt Visualisierungs- und Kollisionsmeshes und weist ausdrücklich
auf das Risiko von durch Stichproben fälschlich deaktivierten Paaren hin.
Für unsere Maschine ist ein Nachweis der Geometrie-/Weggrenzen erforderlich,
nicht bloß eine hohe Zahl getesteter Posen.
[MoveIt: URDF/SRDF](https://moveit.picknik.ai/main/doc/examples/urdf_srdf/urdf_srdf_tutorial.html)

Die Bibliotheks-API beschreibt `closestPointToGeometry` als Abstand und
Punkte zwischen Mesh und Geometrie. Die installierte Version wurde mit
den oben beschriebenen Würfelproben unmittelbar geprüft; sie liefert dort
keine Eindringtiefe.
[three-mesh-bvh: closestPointToGeometry](https://github.com/gkjohnson/three-mesh-bvh/blob/master/API.md#closestpointtogeometry)
