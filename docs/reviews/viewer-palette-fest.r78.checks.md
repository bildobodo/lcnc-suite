# R78 — Prüfprotokoll und Wiederholung

Stand: `67494d4..ff9e6b9`, Anfrage im Live-HEAD `ba35c41`, 2026-10-06.
Arbeitskopie: `/tmp/codex-r78-tgay4bsd/archive`.

## Isolation und Herkunft

- Export aus `git archive ff9e6b9`: `lcnc-webui`, `test-fixtures`,
  `scripts/test_fixtures`, `examples/sim_config/machine-5axis-xyzac`.
- Abhängigkeiten über einzelne Links unter `node_modules`; Cache-Verzeichnisse
  ausgeschlossen. TS-, Vite- und Vitest-Caches liegen in der Archivkopie.
- Der Dateivergleich gegen Git bestätigt 410 unveränderte WebUI-Dateien.
  Fünf Anpassungen dienen nur der Isolation: `e2e/ctl.ts` auf
  `127.0.0.1:4188`; Cache-Pfade in drei TS-Konfigurationen und `vite.config.ts`.
  Keine geänderte Datei unter `src/`; siehe `context.json` und
  `isolation.patch` in dieser Belegserie.
- Ein Worker, `nice -n 19`, eigener Mock `127.0.0.1:4188`, kein Vite-Devserver.
  Der Mock liefert den Produktionsbuild aus dieser Kopie aus. Keine
  Live-Ports, kein LinuxCNC/HAL, keine Maschinenbefehle an die Live-Suite.
- Die bisherigen Review-Belege bleiben unverändert. Die Hashliste erfasst
  diese neue Belegserie ohne sich selbst; `dist-sha256.json` den benutzten Build.

## Ergebnisse

| Prüfung | Ergebnis | Protokoll-Suffix |
| --- | --- | --- |
| Produktionsbuild | PASS | `build-rerun.txt` |
| simRows, clashTargets, findingNav, sweepMerge, scrubTrack | 103/103 PASS | `unit.txt` |
| Bestehende Chromium-Auswahl | 37 PASS, 2 FAIL | `browser-rerun.txt` |
| Unveränderter Pfad-Render-Test nochmals | PASS | `probes-rerun.txt` |
| Unveränderter Tastaturtest nochmals | FAIL nach Machine OFF | `probes-rerun.txt` |
| Tastaturtest als Kopie mit Wartezeiten | PASS | `keyboard-settled.txt` |
| Finale eigene Chromium-Sonde | 3 erwartete FAIL, Layout PASS | `probes-final.txt` |
| Finale Fokussonde in Firefox | Erwartetes FAIL, Jog nach Fokusverlust | `firefox-focus-final.txt` |

Die drei roten Endergebnisse sind unabhängig: andere Reihenfolge bei gleichen
Zeitpunkten, Fokusverlust beim Ergebniswechsel, veraltete temporäre
Pfadfreigabe beim Werkzeugwechsel. Die JSON-Dateien halten die beobachteten
Werte fest. `setCollisionHits` ersetzt Ergebnisse über den schon vorhandenen
Diagnosezugang, ohne DOM oder Navigation zu verändern. Die Fokussonde
reproduziert nicht einen gesamten neuen Sweep. Beide Browser verlieren den
Fokus auf BODY und schicken danach `jog_cont`/`jog_stop` an den Mock.

### Testpflege und eigene Korrekturen

- Der erste Build lief vor Ergänzung von `test-fixtures` aus demselben Commit
  in einen fehlenden JSON-Import (`build.txt`). Die erste Browser-Sammlung
  brauchte außerdem `scripts/test_fixtures` (`browser.txt`). Das sind Fehler
  bei der Einrichtung dieser Review-Kopie, keine Produktbefunde.
- `probes.txt` dokumentiert einen Syntaxfehler in der ersten eigenen Sonde.
  Dieser wurde vor der Ausführung ihrer Fälle korrigiert.
- In `probes-rerun.txt` war die Layoutsonde zunächst zu streng: Sie wertete
  `scrollWidth - clientWidth == 6` als Überlauf. Dazu trägt die absichtlich
  erweiterte HelpIcon-Trefferfläche bei. Die finale Fassung misst die sichtbaren
  Bedienelemente gegen das Seitenpanel und verlangt Platz für Tabellenzeilen.
  Alle drei Ansichten bestehen (`layout-probe.txt`, nochmals `probes-final.txt`).
  Kein Produktfehler wurde daraus abgeleitet.
- Der bestehende Render-Test verfehlte im ersten Lauf seine X-Richtungs-
  Kontrollmessung (`0.919866` statt `>0.95`).
  Unverändert wiederholt besteht er. Die beiden Bilder und DOM-Kontexte
  `existing-rapid.*` und `existing-keyboard.*` stammen aus den ursprünglichen
  Fehlschlägen.
- Die einzige Änderung in `keyboard-settled.spec.ts` gegenüber der neuen
  `sim-panel.viewer.spec.ts` sind zwei Erwartungen an das Statusbanner
  (`IDLE`, `MACHINE OFF`) und 150 ms nach dem Settings-Frame. Alle Assertions
  bleiben bestehen. Die zusätzliche Zeit ist eine Review-Gegenprobe;
  für den regulären Wächter ist eine beobachtbare Client-Bestätigung besser.
- Die finale Fokussonde wartet ebenfalls auf `IDLE` und die Settings-Zustellung.
  In der ersten roten Fassung fehlten diese beiden Wartezeilen. Die finalen
  JSON-Dateien stammen aus der finalen Fassung in Chromium/Firefox.

## Wiederholung

Neue Archivkopie von `ff9e6b9` mit den oben genannten Verzeichnissen erstellen.
Abhängigkeiten bereitstellen, ohne bestehende Caches in einem anderen
Arbeitsbaum beschreibbar zu verlinken. `isolation.patch` dort anwenden.
Die Dateien dieser Belegserie zurücklegen als:

- `probe.spec.ts` → `lcnc-webui/e2e/r78.probe.spec.ts`
- `keyboard-settled.spec.ts` → `lcnc-webui/e2e/r78.keyboard-settled.spec.ts`
- `chromium.config.ts` → `lcnc-webui/r78.chromium.config.ts`
- `firefox.config.ts` → `lcnc-webui/r78.firefox.config.ts`
- `vitest.config.ts` → `lcnc-webui/r78.vitest.config.ts`

`evidence/` neben `lcnc-webui/` anlegen; Port 4188 muss frei sein.
Folgende Befehle aus `lcnc-webui/` ausführen, Browserläufe nacheinander:

```sh
nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r78.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r78.chromium.config.ts --grep 'sim-panel.viewer|findings.viewer|rapids.viewer|collision jump|entry-move and program contacts|a manual move away|contacts that separate|side-pane navigation|the narrow threshold|scrub bar.s insides|with the HUD layer off|Simulation tab.s speed|every field is named|tabs.spec'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r78.chromium.config.ts r78.probe.spec.ts
env R78_BROWSER=firefox nice -n 19 node node_modules/@playwright/test/cli.js test --config r78.firefox.config.ts --grep 'R78: replacing collision'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r78.chromium.config.ts r78.keyboard-settled.spec.ts --grep 'the rows. keys move'
```

Die finale Sim-Messung enthält CSS-Breiten/-Höhen (durch CSS-Zoom dividiert);
`x`/`y` sind unveränderte Viewportkoordinaten. `outside` vergleicht beide
Rechtecke im selben Koordinatensystem. 150 % Hochformat hat 36 CSS-px hohe
Auswahlen und Schrittknöpfe. Die Tabellenzeile ist als ganze Zeile anklickbar;
die kleinere `.rowPick`-Box ist ihr Tastaturfokus, nicht die gesamte Touchfläche.

Keine vollständige erneute Offline-Suite, keine neue Mac-/Geräteabnahme.
Parken und Wiederaufnahme wurden nicht als zusätzliche Browserabläufe
nachgestellt; Track-/Merge-Tests und Quellprüfung sind separat benannt.
