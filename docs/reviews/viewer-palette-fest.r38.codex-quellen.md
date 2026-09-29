# R38 · Quellen und Grenzen · 29.09.2026

## Primärquellen

- [Firefox 132 Release Notes](https://www.firefox.com/en-US/firefox/132.0/releasenotes/):
  Wide-Gamut-WebGL für Windows und macOS, P3 mit 8 Bit. Browser-Unterstützung ist
  vorhanden; die tatsächliche Firefox-Version und der angeschlossene Bildschirm
  des Operators wurden in dieser Runde nicht abgefragt oder gemessen.
- [MDN Browser Compatibility Data, WebGLRenderingContext](https://github.com/mdn/browser-compat-data/blob/main/api/WebGLRenderingContext.json):
  `drawingBufferColorSpace` ab Firefox 132; 127–129 waren eine versehentlich
  exponierte, funktionslose Schnittstelle. Ergänzend
  [Mozillas Implementierungsticket 1885491](https://bugzilla.mozilla.org/show_bug.cgi?id=1885491).
- [MDN, drawingBufferColorSpace](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace):
  Werte `srgb` und `display-p3`; ungültige Werte ändern die Einstellung nicht.
- [W3C, Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html):
  3:1 bezieht sich auf relevante grafische Information und angrenzende Farben;
  dünne, geglättete Linien können schlechter lesbar sein als der nominale
  Farbkontrast vermuten lässt. Kein beliebiger OKLab-Abstand ersetzt das.
  In dieser Runde keine Behauptung vollständiger WCAG-Konformität; die vom
  Operator ausgesetzte Farbschwäche-Simulation wurde nicht wieder eingeführt.
- [Three.js LineSegments2](https://threejs.org/docs/pages/LineSegments2.html),
  [LineMaterial](https://threejs.org/docs/pages/LineMaterial.html): breite Linien,
  Breite in CSS-Pixeln bei deaktivierten worldUnits; passende Viewport-Auflösung.
- [Three.js r182, LineSegmentsGeometry](https://raw.githubusercontent.com/mrdoob/three.js/r182/examples/jsm/lines/LineSegmentsGeometry.js):
  Instanzdaten mit zwei Endpunkten = sechs Float32-Werte; gemeinsames Grundmesh mit
  acht Positionen und 18 Indizes = sechs Dreiecken. Nicht sechs getrennte
  Positionsvertices pro Segment im Instanzpuffer.

## Gelesene lokale Quellen am Stand 3237f5e

- `viewer/toolpathController.ts:274–408`: Shared positions, Indizes pro LOD,
  räumliche Chunks, Distanzattribute, Bounds und Overlays; `renderOrder` 10/12.
- `viewer/backplotController.ts`: Backplot mit 2 CSS-px, `renderOrder` 11,
  eigener Ring, `renderer.getSize(mat.resolution)`.
- `viewer/lineChunks.ts`: räumliches Binning, zwei zusätzliche LOD-Stufen,
  Brüche/Frames und vollständige Ausgangspositionen bleiben erhalten.
- `viewer/sceneAppearance.ts`: Hemisphere-Licht 2.5 und drei gerichtete Lichter
  3/2/2; Oberflächen metalness 0.12, roughness 0.48. Ein geänderter Material-Hexwert
  ist deshalb kein Nachweis eines bestimmten gerenderten Grauwerts.
- `ThreeViewer.vue:_tintMesh`: Kollision wird additiv als Emissive-Farbe gesetzt.
  Das fertige Körperpixel ist kein flaches `#c8102e`-Farbfeld.
- `viewer/viewerPalette.ts`: Resolver/Custom-Daten erwarten `#rrggbb`; ein P3-
  Farbraumexperiment muss zusätzlich die Datenrepräsentation berücksichtigen.
- `viewerPerf.ts`: `renderMs` misst CPU-Submission; GPU-Fences zeigen Rückstand,
  keine präzise GPU-Zeitmessung. Vorher/nachher dieselbe Szene und dasselbe Gerät.
- Installierte Three.js-Quellen nur gelesen: `examples/jsm/math/ColorSpaces.js`
  (DisplayP3ColorSpaceImpl), `src/math/ColorManagement.js` und
  `src/renderers/WebGLRenderer.js:outputColorSpace`. Ein P3-Canvas allein ändert
  die Farbmetrik vorhandener sRGB-Hexwerte nicht korrekt in kräftigere Farben.

## Eigene Belege

`viewer-palette-fest.r38.codex-rechnung.py` ist eine eigenständige, deterministische
Diskussionsrechnung (Python 3, stdout JSON). Keine Produktimporte, keine Tests
oder Builds der Live-Suite. Formel: linearisierte sRGB-Luminanz, WCAG-Kontrast,
OKLab auf der Skala 0..1. Ziel-Flächenfarben im JSON sind fertige Anzeigefarben,
keine empfohlenen Rohwerte für die beleuchteten Materialshader.

Der HTML-Vergleich verwendet SVG, kann ohne Server lokal geöffnet werden und hat
keine Netzwerkabhängigkeiten. Szenenhintergrund, Modellfläche, Strichbreite,
Überdeckung und Backplot-Sichtbarkeit sind interaktiv. Ein Chromium-Lauf mit einem
Browser und `nice -n 19` prüfte nur diese Datei und ihre Bedienelemente; HTTP/HTTPS
waren geblockt. Das PNG ist sein unverkleinerter Screenshot, das Check-JSON nennt
Ergebnisse. Dies ist weder ein Maschinenrendering noch ein P3-Displaytest.

Gelesen wurde Claudes `viewer-palette-fest.r38.claude-renders.jpg`. Das angekündigte
D-Rendering war beim Abschluss nicht im Live-Checkout vorhanden. Die 60-%-JPEG-
Montage ist für den Eindruck hilfreich, aber kein pixelgenauer Breitenbeleg.

Archivkopie: `/tmp/codex-r38-nbwcm44y`, `git archive 3237f5e`. Keine Zugriffe auf
`:5173`/`:8000`, kein eigener Mock nötig, keine Maschinenbefehle. Kein Produktcode
geändert. Alle neuen Dateien tragen `viewer-palette-fest.r38.codex-`.
