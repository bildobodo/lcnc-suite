# R74 · Codex · Prüfprotokoll · 2026-10-05

Review: `15a7f3a..4a7dc87`; Anfrage im Live-Stand `af58628`.
Arbeitskopie: `/tmp/codex-r74-w8dspjni/archive` aus `git archive 4a7dc87`.
Produktcode unverändert. Live-Checkout nur gelesen und anschließend um Review und
neue Belege ergänzt. Kein Zugriff auf :5173/:8000, keine LinuxCNC-/HAL-Befehle.

## Isolierung und Wiederholung

1. Archiv des geprüften Commits in ein neues temporäres Verzeichnis entpacken.
2. Abhängigkeiten aus derselben Installation verwenden. Hier enthielt
   `lcnc-webui/node_modules` einzelne Symlinks auf vorhandene Pakete, aber keine
   übernommenen `.tmp`, `.vite`, `.vite-temp` oder `.cache`-Verzeichnisse.
3. Nur in der Archivkopie: tsconfig-Buildcache von `./node_modules/.tmp/` nach
   `../r74-ts-cache/`, Vite `cacheDir: '../r74-vite-cache'`.
4. In der Kopie `e2e/ctl.ts`: `localhost:4174` durch `127.0.0.1:4188` ersetzen.
   Alle Verbindungen gehen an diesen eigenen Mock; er liefert auch den lokalen
   Produktionsbuild aus. Einen Ordner `evidence` neben `lcnc-webui` anlegen.
5. Die beigefügten Konfigurationen in `lcnc-webui` als `r74.vitest.config.ts`,
   `r74.playwright.config.ts`, `r74.probes.config.ts` ablegen; die Sonde als
   `lcnc-webui/e2e/r74.probe.spec.ts`.

Befehle jeweils aus `lcnc-webui`, alle mit `nice -n 19`, Browser mit einem Worker:

```sh
VITE_GATEWAY_PORT=4188 npm run build
node node_modules/vitest/vitest.mjs run --config r74.vitest.config.ts --maxWorkers=1
node node_modules/@playwright/test/cli.js test --config r74.playwright.config.ts --grep 'viewcube.viewer|reach.viewer|injected reach soup|a reach chain with two visible pieces|CSS-px objects keep|Program head is two rows|Program keeps code lines|Start, Step and Resume fire|Run from line: Start only'
node node_modules/@playwright/test/cli.js test --config r74.probes.config.ts
```

Die eigene Sonde entstand schrittweise: Zuerst liefen ihre ersten zwei Fälle und
bestanden (`probes.txt`). Dann kam der gezielte dritte Fall hinzu und wurde separat
mit `--grep 'visible axis glyph'` ausgeführt (`glyph-clipping.txt`, Exit 1).
Ein Gesamtlauf der beigefügten endgültigen Sondenfassung soll deshalb ebenfalls
an der dritten Probe scheitern.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Produktionsbuild | PASS |
| Unit-Auswahl | PASS, 4 Dateien / 65 Tests |
| Bestehende Browserauswahl | PASS, 12 Tests / 50,6 s |
| Eigene Orbit-Abtastung | PASS nur für Mittelpunkte, 96 Posen; kein Nachweis vollständiger Schrift |
| Eigene schmale Haltebedienung | PASS; Step und Resume je einmal nach Halten, Pause einmal nach Tippen |
| Eigene gezeichnete Achsbuchstaben | FAIL, VP-I35: X wird oben am Canvas abgeschnitten |

Umgebung der Clipping-Probe: Chromium, 1600×1000, DPR 1, Standard-Hellansicht,
100 %, XYZAC-Mock. Die ausgewählten Bilder wurden zusätzlich direkt angesehen.
Bei 5° Neigung und Azimut 150° ist die Deckkraft 1 und der X-Mittelpunkt nur
3,22 px unter dem oberen Rand; bei 10° sind es 0,38 px und Deckkraft 0,708.
Die Pixelprobe prüft die erste Bildzeile der tatsächlich gespeicherten PNG,
also nicht nur Diagnosekoordinaten. Die gerade Ansicht dient als Kontrolle.

Die Kamerapose wird über den bestehenden Diagnoseaufruf eingestellt, der den
normalen Produktsetter `applyViewDirection` verwendet; es werden keine Materialien,
Abmessungen, Buchstaben oder Renderpuffer im Test geändert. Eine separate
physische Mausgeste wurde für die Clipping-Reproduktion nicht vermessen.

Die Datei `cube-clipped-centres.json` enthält bewusst `[]`: Kein Mittelpunkt lag
außerhalb. Das bedeutet nicht, dass die Schrift in den Canvas passt. Die Datei
`cube-5deg.png` stammt aus dieser ersten Abtastung; `glyph-5deg.png` aus der
unabhängigen anschließenden Pixelprobe. Alte Belege wurden nicht verändert.

Der Reichweitenbesitz wurde zusätzlich im Code geprüft: ein Schreibpfad zu
`_reachInjected = true` im Diagnosezugang; Initialisierung false je Viewer-Instanz;
Worker-Antworten und Folgeanfragen respektieren den Besitz. Der Diagnosezugang ist
auch im Produktionsbuild vorhanden. Die echte Worker-Berechnung wurde unabhängig
ohne Einspritzung durch den ausgewählten bestehenden Test geprüft.

Keine komplette Gate-Wiederholung, kein Backend-Rerun, kein Firefox-/macOS-Rerun
und keine Live-Simulationsprüfung. Keine Aussage über außerhalb dieser Runde
liegende Oberflächenzustände oder die bekannte Querformatgrenze ab 150 %.
