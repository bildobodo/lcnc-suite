# R241 · unabhängige Belege

Geprüft: `d11c3d68..0e4deea9`, Produktzweig `feat/fixed-highlight`.
Archiv: `/tmp/codex-r241-1s6zd0w0/repo`, eigener Mock `127.0.0.1:4188`.
Der Mock ist beendet. Kein Zugriff auf die Live-Sim oder ihre Ports.

- `probe.spec.ts`: eigene Browser-Gegenproben, Produktquellen unverändert.
- `config.ts`: isolierte Chromium-Konfiguration, ein Worker.
- `frames.json`: Rohdaten pro Animation Frame (CSS px); darunter die vier Sim-Übergänge.
- `measurements.json`: daraus berechnete Zahlen.
- `validation.txt`: Build, 40 Unit-Tests, 7 vorhandene Follow-Wächter, 28 Full-HD-Layout-/Geometriefälle, eigene Gegenproben und abschließende drei grüne Repository-Prüfungen.
- `integrity.json`: Vergleich aller 409 Produktquelldateien mit `git archive 0e4deea9`; ursprünglicher Review-Inhalt unverändert.

## Wiederholen

Nur in einer eigenen Kopie bauen/testen. Archiv von `0e4deea9` erzeugen, Abhängigkeiten mit passendem Lockfile bereitstellen und `npm run build` in `lcnc-webui` ausführen. Erst danach die Probe nach `e2e/r241.codex.spec.ts` und die Konfiguration nach `playwright.r241.config.ts` kopieren (der Produkt-Build prüft auch TypeScript unter e2e).

Die Probe importiert die vorhandenen `ctl`, `layout-fixtures`, `simTab` und `limitRuns`. In der Kopie wurden die Mock-Adressen der e2e-Dateien von `localhost:4174` auf `127.0.0.1:4188` gesetzt. `OUT` in der Probe ist das oben genannte temporäre Verzeichnis; beim Wiederholen nur diesen Ausgabepfad anpassen und vorher anlegen.

Eigener Server: `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs`.
Probe: `npx playwright test -c playwright.r241.config.ts e2e/r241.codex.spec.ts`.

Die großen Dateien sind synthetischer Programmtext; die Vorschau bleibt klein. Geprüft wird die Darstellung und Scroll-Abbildung des Codes, keine Maschinenbewegung. Die Unterprogrammprobe verwendet eine Vorschau mit Herkunfts- und Aufrufzeilen, einen `/subfile`-Text und den öffentlichen Sim-Regler; keine Vue-Interna oder Produkt-Testhaken.

Der erste Probenlauf hatte die Grenze 1,5 px und noch keine Nachlauf-Assertion (2 grün, 600k rot). Der abschließende Lauf prüft die 1-px-Zusage des vorhandenen Wächters sowie die ausdrücklich behauptete Paketgrenze: 1200 Zeilen rot nur bei der Paketgrenze, 2M rot bei der Bandruhe, Unterprogramm rot bei fehlendem Band und dessen Bewegung. Die Sim-Übergänge waren grün. Die 600k-Rohdaten stammen aus dem ersten Lauf, 1200/2M/Unterprogramm aus dem abschließenden.

FH-03 ist ein Vertragsbefund: Falls die Ein-Paket-Zusage zugunsten eines korrekt beschriebenen Interpolationsverhaltens zurückgenommen wird, ist diese einzelne Assertion entsprechend neu zu vereinbaren; sie darf dann nicht als zufällige Testinstabilität eingeordnet werden.
