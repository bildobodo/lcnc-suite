# R79 — Prüfprotokoll

Stand `554e978..3954401`, Anfrage in `5aba71b`, 2026-10-06.
Archivkopie: `/tmp/codex-r79-mgex7_jw/archive`.

## Herkunft und Isolation

Exportiert aus `git archive 3954401`: `lcnc-webui`, `test-fixtures`,
`scripts/test_fixtures`, `examples/sim_config/machine-5axis-xyzac`.
Einzelne Links auf vorhandene Node-Abhängigkeiten; deren Cache-Verzeichnisse
sind ausgeschlossen. TS-/Vite-/Vitest-Caches liegen in der Kopie. Gegen Git
sind 410 WebUI-Dateien unverändert. Fünf Anpassungen betreffen ausschließlich
Mock-URLs und Cache-Pfade (`isolation.patch`). Keine Änderung unter `src/`.

Ein Worker, `nice -n 19`, Mock auf `127.0.0.1:4188` mit dem hier gebauten
Produktionsbundle. Kein Zugriff auf :5173/:8000 oder LinuxCNC/HAL. Die
Browser senden ihre simulierten Befehle ausschließlich an den eigenen Mock.

`r78-probe.spec.ts` ist bytegleich zum R78-Beleg. Die Sonde schreibt weiterhin
R78-Dateinamen in das neue, zunächst leere Evidence-Verzeichnis; diese neuen
Ergebnisse wurden für die Ablage mit `viewer-palette-fest.r79.r78-` benannt.
Keine bisherigen Belegdateien wurden überschrieben. `context.json` enthält
die Herkunft, `dist-sha256.json` den benutzten Build, `sha256.json` diese
neue Belegserie ohne die Hashliste selbst.

## Ergebnisse

| Lauf | Ergebnis | Protokoll-Suffix |
| --- | --- | --- |
| Build aus dem geprüften Quellstand | PASS | `build-rerun.txt` |
| simRows, clashTargets, findingNav, sweepMerge, scrubTrack | 103/103 PASS | `unit.txt` |
| Chromium: 8 aktuelle + 4 R78 + 3 Übergangstests | 14 PASS, 1 FAIL (VP-I40) | `chromium-rerun.txt` |
| Firefox: 5 aktuelle + R78-Fokus + 3 Übergangstests | 9/9 PASS | `firefox.txt` |
| Chromium: bisherige Zustandswartebedingung | Erwartetes FAIL | `wait-and-exact.txt` |
| Chromium: Testkopie mit exaktem Power-Button | PASS | `wait-and-exact.txt` |

Die Produktkorrekturen bestehen. Die neue rote Gegenprobe zeigt, dass beide
Regex-Wartebedingungen im unverändert bestätigten ON-Zustand erfolgreich
sind. Sie verändert keine Produktlogik. Die private Tastaturtestkopie ändert
nur die Assertion in `machine()` auf einen Button mit exaktem zugänglichem
Namen; alle bisherigen Assertions bleiben erhalten.

Die drei zusätzlichen Fokusfälle verwenden reguläre Mock-Statusmeldungen,
den `viewer_gcode`-Entladeframe und den vorhandenen Diagnosezugang für
Kollisionsergebnisse. Sie prüfen Entladen, einen geänderten Sperrgrund und
außerhalb gehaltenen Fokus. Vor den beiden Jog-Gegenproben weist eine
Kontrollaktion nach, dass die Pfeil-Jog-Belegung tatsächlich aktiv ist.

## Einrichtungskorrekturen

- Der erste Build (`build.txt`) erfolgte versehentlich schon mit der alten
  Review-Sonde unter `e2e/`. Deren unbenutzter Import `simLine` verletzt den
  TS-Check. Die Sonde wurde für den Build herausgenommen und danach bytegleich
  zurückgelegt; der unveränderte Produktstand baut erfolgreich.
- Der erste Browserlauf (`chromium.txt`) hatte zwar die HTTP-Mock-URL auf
  4188, die WebSocket-Steueradresse aber noch auf dem freien Standardport
  4174. Alle Fälle scheiterten bereits an der Einrichtung mit einem
  Verbindungsfehler. Die Steueradresse wurde ebenfalls auf 4188 umgestellt;
  der anschließende Lauf ist `chromium-rerun.txt`.

Diese beiden Einrichtungsfehler sind keine Produktbefunde. Originalprotokolle
liegen zur Nachvollziehbarkeit bei. Die Fehleraufnahme `keyboard-failure.*`
stammt dagegen aus dem korrekt eingerichteten Chromium-Lauf.

## Wiederholung

Archivkopie wie oben erstellen, Abhängigkeiten bereitstellen und
`isolation.patch` nur in dieser Kopie anwenden. `evidence/` neben
`lcnc-webui/` anlegen. **Zuerst den Produktbuild ausführen**, bevor die alten
Review-Sonden in das durch TypeScript erfasste `e2e/` kopiert werden.

```sh
nice -n 19 npm run build
```

Danach Dateien dieser Belegserie ablegen als:

- `chromium.config.ts`, `firefox.config.ts`, `vitest.config.ts` →
  `lcnc-webui/r79.<name>.config.ts`
- `r78-probe.spec.ts` → `lcnc-webui/e2e/r78.probe.spec.ts`
- `transitions.spec.ts`, `wait.spec.ts`, `keyboard-exact.spec.ts` →
  `lcnc-webui/e2e/r79.<name>.spec.ts`

Befehle aus `lcnc-webui/`; Browserläufe nacheinander, Port 4188 frei:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r79.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r79.chromium.config.ts sim-panel.viewer.spec.ts r78.probe.spec.ts r79.transitions.spec.ts
env R78_BROWSER=firefox R79_BROWSER=firefox nice -n 19 node node_modules/@playwright/test/cli.js test --config r79.firefox.config.ts r78.probe.spec.ts r79.transitions.spec.ts sim-panel.viewer.spec.ts --grep 'replacing collision|R79:|rows. keys|a result change|mixed kinds|a tool change'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r79.chromium.config.ts r79.wait.spec.ts r79.keyboard-exact.spec.ts --grep 'machine-state wait|rows. keys'
```

Der zusätzliche Dateifilter beim Firefox-Befehl verhindert, dass die später
hinzugefügten VP-I40-Sonden mit ausgeführt werden; der protokollierte
Firefox-Lauf fand vor ihrer Aufnahme in die Konfiguration statt.

Kein vollständiges Offline-Gate, keine reale Maschinen-/Geräteabnahme.
