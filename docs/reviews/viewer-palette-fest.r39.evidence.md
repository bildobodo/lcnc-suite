# R39 · Planprüfung Teil B · Nachweise

Planstand `aa4c701`, Anfrage `76d0cec..aa4c701`. Archivkopie unter
`/tmp/codex-r39-1gxgoqfp`. Beim Beginn stand der Live-HEAD bereits auf `4bb4ff1`
(Teil A); im Verlauf entstanden weitere Änderungen an `ThreeViewer.vue` und
`boxLines.ts`. Diese wurden nicht verändert. Der eingecheckte Unterschied in
`toolpathController.ts` seit dem Planstand betrifft Teil A (Boxfarben/-aufbau),
nicht den hier besprochenen Puffer- und Culling-Pfad.

## Kleine reproduzierbare Sonde

`node viewer-palette-fest.r39.probe.mjs /home/cnc/lcnc-suite/lcnc-webui/node_modules`

Ausgeführt aus der Archivkopie mit `nice -n 19`, Ausgabe in `viewer-palette-fest.r39.probe.json`.
Sie liest Three.js r182, erstellt zwei Segmente im RAM und ruft die dokumentierte
Viewport-Aktualisierung mit einem Renderer-Stub auf. Kein WebGL-Renderer, kein
Browser, keine Verbindung zu einem Gateway. Die Millionen-Segment-Zahlen sind
Arithmetik, es wurden dafür keine großen Puffer angelegt.

Ergebnisse:

- Endpunkte: 48 Byte bei zwei Segmenten. Strichdistanzen: weitere 16 Byte,
  die ein reiner `instanceStart`-Zähler nicht erfasst. Start und Ende referenzieren
  denselben InterleavedBuffer; diesen nicht zweimal zählen.
- `LineMaterial` hat standardmäßig `depthWrite=true`; der bestehende Pfadrenderer
  setzt ausdrücklich `false`.
- `LineSegments2` ist ein Mesh, kein `isLine`-Objekt. Das Grundmesh hat immer acht
  Vertices/18 Indizes; seine Indexzahl zählt nicht die Pfadsegmente.
- Ein zentraler Wert für `resolution` wird vom geerbten `onBeforeRender` durch
  den aktuellen Viewport ersetzt. Die Aufgabenverteilung muss ausdrücklich sein.
- Bei 400 CSS-px Höhe und 800 Framebuffer-px führt eine falsch verwendete
  Framebuffer-Auflösung im 2-px-Shader rechnerisch zu 1 CSS-px Breite, sofern kein
  anderer Hook den Wert korrigiert.
- Ortho-Randfall: Eine Mittellinie bei x=1,001 liegt knapp außerhalb des Frustums
  [-1,1], ihre enge Sphere wird verworfen. Bei 800 CSS-px Breite ragt ein 2-px-
  Strich aber bis x=0,9985 ins Bild. Das ist eine geometrische Gegenprobe, kein
  behaupteter Screenshotfehler einer noch nicht implementierten Fassung.
- Beispiel für Quantile: Zwei gleich große Fenster haben p95 100 bzw. 1 ms.
  Ihr Mittel 50,5 ms ist nicht der p95 ihrer zusammengefassten Stichprobe (1 ms).
  Ein Mittelwert von Fenster-Perzentilen darf nicht als Lauf-p95 bezeichnet werden.

## Lokale Belege im Planarchiv

- `ThreeViewer.vue:3524`: Culling erhält `renderer.domElement.height`.
- `viewer/toolpathController.ts:834`: `heightPx` wird als DEVICE-Pixel-Höhe für
  die LOD-Auswahl verwendet, nicht als vollständige CSS-Viewportgröße.
- `viewer/toolpathController.ts:361–414`: eigener Overlay-Index, geteilte
  Originalpositionen; weiteres Packen der Overlay-Endpunkte wäre zusätzliche
  Speicherung.
- `viewer/toolpathController.ts:613–650`: eigene Reveal-Geometrien und ihre
  Entsorgung; Grundmaterialien gehören dem Set, nicht der Reveal-Ansicht.
- `viewer/toolpathController.ts:415`: `rebuildOverflowEdges` ist ein zusätzlicher
  GL-Linienpfad für den orangefarbenen Box-Überhang mit Clip-Ebenen.
- `viewerPerf.ts:266–310`: Ausgabe von 3-s-Fenster-Quantilen, CPU-Submission,
  rAF-Abständen, Timerlatenz und GPU-Fence-Rückstand. Keine Rohstichprobe pro Lauf.

Primärdokumentation:
[Three.js LineMaterial](https://threejs.org/docs/pages/LineMaterial.html)
(Breite in CSS-Pixeln, Viewport-Aktualisierung durch den Objekt-Hook),
[LineSegments2](https://threejs.org/docs/pages/LineSegments2.html)
(Mesh-basiertes Zeichnen und Distanzattribute). Gelesen am 29.09.2026;
konkrete API-Sonde gegen die installierte Version 0.182.0.

Kein Produkt-Build, kein Produkt-Testlauf, keine Leistungsmessung auf dem Mac und
keine Implementierungsabnahme. Keine Live-Ports oder Maschinenbefehle verwendet.
Die Operator-Entscheidungen zu Teil A sind die neue Vorgabe, keine in dieser Runde
erneut verhandelten Anforderungen.
