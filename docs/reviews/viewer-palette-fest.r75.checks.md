# R75 · Codex · Prüfprotokoll · 2026-10-05

Scope: VP-I35, `f7f967d..034f9c4`, Fix `f5ae6ee`.
Anfrage im Live-Stand `8565839`.
Archivkopie: `/tmp/codex-r75-t4qhfn_t/archive` aus `git archive 034f9c4`.

## Durchführung

Keine Produktänderungen. Keine Verbindungen zu :5173/:8000, keine Maschinenbefehle.
Alle Prüfungen mit `nice -n 19`, maximal einem Worker; Browser und Mock außerhalb
der Live-Suite. Der Mock auf `127.0.0.1:4188` liefert auch den lokalen Build aus.

Zur Wiederholung:

1. `git archive 034f9c4` in ein neues temporäres Verzeichnis entpacken.
2. Vorhandene Node-Abhängigkeiten verwenden; hier einzelne Symlinks in einem eigenen
   `node_modules`, ohne Übernahme von `.tmp`, `.vite`, `.vite-temp`, `.cache`.
3. Nur in der Kopie: tsconfig-Buildcache `./node_modules/.tmp/` nach
   `../r75-ts-cache/` verlegen; Vite `cacheDir: '../r75-vite-cache'` ergänzen.
4. `e2e/ctl.ts`: `localhost:4174` durch `127.0.0.1:4188` ersetzen.
5. Beigefügte Konfigurationen als `lcnc-webui/r75.vitest.config.ts` und
   `lcnc-webui/r75.playwright.config.ts` ablegen. Die beigefügte, unveränderte
   R74-Sonde als `lcnc-webui/e2e/r74.probe.spec.ts` ablegen. Einen Ordner
   `evidence` neben `lcnc-webui` anlegen.

Aus `lcnc-webui`:

```sh
nice -n 19 env VITE_GATEWAY_PORT=4188 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r75.vitest.config.ts --maxWorkers=1
nice -n 19 node node_modules/@playwright/test/cli.js test --config r75.playwright.config.ts --grep 'viewcube.viewer|all visible cube arrow letters|visible axis glyph'
```

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Build | PASS; nur die bestehende Vite-Warnung zu großen Chunks |
| Unit-Auswahl `cubeFaces.test.ts` | PASS, 6/6 |
| Unveränderte R74-Orbit-Abtastung | PASS, 96 Posen; nur Mittelpunktprüfung |
| Unveränderte R74-Pixelprobe | PASS; vorher rot, X bei 5°/10° vollständig im Bild |
| Bestehende ViewCube-Tests | PASS, 4/4 einschließlich neuem Wächter mit 432 Posen und X-/Y-Pixelprüfungen |
| Browser gesamt | PASS, 6/6 in einem Lauf, 35,3 s |

Browser: Chromium, Desktop 1600×1000, DPR 1, 100 %, Standard-Hellansicht,
XYZAC-Mock. Die 5°- und 10°-Bilder wurden direkt angesehen. Die Pixelprobe liest
die gespeicherte PNG, nicht allein die Diagnosekoordinaten. Die R74-Sonde stellt
die Kamerapose über den bestehenden Diagnoseaufruf des Produktsetters ein.

Die Sondenkopie ist bytegleich zum bestehenden R74-Beleg (Hash in `context.json`).
Sie erzeugt in der temporären Kopie weiterhin Dateien mit `r74` im Namen. Nur die
neuen **Ergebnisdateien** dieses Laufs wurden beim Ablegen als R75-Belege in `r75`
umbenannt; Inhalt unverändert. Die bestehenden R74-Dateien blieben unberührt.
Die Haltebedienungsprobe in derselben Sondendatei wurde nicht ausgewählt, weil der
Program-Kopf in R75 unverändert ist.

Codeprüfung: Vollständiger Diff des angefragten Bereichs; insbesondere Kamera-
Matrix vor der Projektion, Quad-Größe in NDC, Rückprojektion mit unveränderter Tiefe,
Rückkehr zu `home` je Bild, tatsächliche Sprite-Position in der Diagnose. Der
geprüfte Produktcode der Archivkopie stimmt bytegleich mit `034f9c4` überein.

Kein neuer Befund, VP-I35 geschlossen. Kein eigener vollständiger Offline-Gate-
oder Backend-Lauf, kein Firefox-/macOS-Lauf, keine Live-Simulationsprüfung.
