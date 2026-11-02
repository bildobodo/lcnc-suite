# R252 — Codex, eigene Belege

Geprüfter Produktstand: `bcab7cb7b1e9b556f39a2c0bc95ec104ddb09486`, Basis `4ad87515`.
Archivkopie: `/tmp/codex-r252-x76aweny/repo`. Live-Baum nur gelesen; keine Live-Sim-Zugriffe oder Maschinenbefehle. Der eigene Mock auf `127.0.0.1:4188` wurde nach Abschluss beendet.

928 Produkt-/Test-/Beispieldateien unter `src/`, Gateway, Skripten und Beispielen nach den Prüfungen bytegleich mit dem Git-Archiv. Im Testaufbau wurden ausschließlich die Mock-URLs in der Kopie von `localhost:4174` auf `127.0.0.1:4188` umgestellt und eigene Proben ergänzt. Vorhandene `node_modules` aus einer früheren Review-Kopie genutzt, nachdem die Lockfiles bytegleich waren. Build vor dem Hinzufügen eigener Browser-Proben.

## Läufe

- `npm run build`: PASS.
- Aus `lcnc-gateway`: `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_example_install.py`: 34/34 PASS. Nur der Python-Interpreter stammt aus dem Live-Verzeichnis; Imports und Tests aus dem Archiv.
- Aus `lcnc-webui`: `vitest run src/probeVarFiles.test.ts src/defaults.test.ts src/toolsetterSetup.test.ts --maxWorkers=1`: 2 existierende Dateien, 12 Tests PASS (`defaults.test.ts` existiert nicht und wurde nicht gezählt).
- `installer-probe.py <Archiv-Repo>`: Bereichsgrenzen #2999/3000/3999/4000/5161/5221, bestehende Zeilen, fehlender Schlussumbruch; drei Installations-Upgrades mit eigenen Probing-/G30-/WCS-Werten, exaktem Backup und unverändertem Zweitlauf; gestoppt-Regel vor jeder Änderung; reine `validate_payload`-Prüfung für `set_probe_vars` und `mdi`, einschließlich verweigerter unde­klarierter bzw. Systemnummern. `assert_stopped` und `Path.home` nur in dieser temporären Installation gemockt; keine installierte Sim berührt.
- `mapping.mjs` aus `lcnc-webui`: alte `ProbePanel.vue` via `git show 4ad87515:lcnc-webui/src/ProbePanel.vue` unter `../../legacy-ProbePanel.vue` bereitgestellt. Alte und neue Zuordnung für Defaultwerte und unterschiedliche Feldwerte, je drei Modi, verglichen. Alle 96 Defaultwerte in den drei Templates entsprechen dem Formular (32 je Profil).
- Eigene Browser-Probe (`browser.spec.ts` als `e2e/r252.codex.spec.ts`, Config als `r252.config.ts`): Chromium 148.0.7778.0 und **Stock Firefox 159.0 unter Linux aarch64**, jeweils XYZ/XYZAC, Desktop 1600×1000, Touch-Hochformat 900×1200 und Full-HD-Touch 1920×1080. Sechs Rasteransichten, freigegeben und gesperrt: 144 Ansichten. Prüfung von Zellen, SVG-Abmessungen, nichtleerer Zeichengeometrie, Platz im Rasterabschnitt und identischer Parameter-Anfangslinie. Touch wie die vorhandene Layout-Fixture über die CSS-Klasse gesetzt; kein nativer Touch-/macOS-Test.
- In der eigenen Browser-Probe wurde **nur im DOM** die alte Rasterbreite zurückgesetzt. Firefox zeigt damit Desktop-Zellen 10×10 / SVG 0×0, Touch-Zellen 36×36 / SVG 26×26. Die erste Probenfassung erwartete auch unter Touch 10/0; diese vier Prüfungen scheiterten allein an der Erwartung zur alten Breite. Die korrigierte Gegenprobe erwartet das durch die globale Touch-Mindesthöhe erklärte 36/26; alle vier wiederholten Fälle grün. Produkt unverändert. Initialprotokoll erhalten.
- Repository-Browser-Wächter: `playwright test -c r252.config.ts e2e/layout.spec.ts --project=chromium --grep 'a probe grid.s cells|probe grid sub-tabs keep the parameters'`: 10/10 PASS.

Die eigenen Skripte enthalten die ursprünglichen Archiv-/Belegpfade; bei Wiederholung in anderer Kopie diese Pfade und den Pfad zum Stock-Firefox anpassen. Der Mock wurde mit `MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs` aus der gebauten Archivkopie gestartet. Browserläufe mit einem Worker, niemals gleichzeitig.

## Grenzen

Kein kompletter Gate-Neulauf und kein nativer Antastzyklus an der laufenden Maschine. Die aktuelle Prüfung bestätigt Layout und Parameter-Zulassung/Migration; die in R251 vereinbarte künftige Live-Prüfung wird damit nicht ersetzt. Screenshots des reparierten Firefox-Desktops und Hochformats liegen bei, Messdaten in `results.json`.
