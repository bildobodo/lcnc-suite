# R81 — Prüfprotokoll

Stand `0ddd4038..91557369`, Anfrage in `aa5040fd`, 2026-10-06.
Archivkopie: `/tmp/codex-r81-4ytcrmd2/archive`.

## Herkunft und Isolation

Exportiert aus `git archive 91557369`: `lcnc-webui`, `test-fixtures`,
`scripts/test_fixtures`, `examples/sim_config/machine-5axis-xyzac`.
Node-Abhängigkeiten einzeln verlinkt, ohne deren Cache-Verzeichnisse. TS-,
Vite- und Vitest-Caches lokal. 411 WebUI-Dateien stimmen mit Git überein;
fünf Änderungen betreffen nur Mock-URLs und Cache-Pfade (`isolation.patch`).
Keine geänderte Produktquelle unter `src/`.

Ein Worker, `nice -n 19`, eigener Mock auf `127.0.0.1:4188`, der den hier
gebauten Produktionsstand ausliefert. Keine Live-Ports, kein LinuxCNC/HAL,
keine Maschinenbefehle an die Live-Suite. Alte Belege unverändert.

## Ausgeführte Prüfungen

| Lauf | Ergebnis | Protokoll-Suffix |
| --- | --- | --- |
| Build | PASS | `build.txt` |
| simPanelStore, simRows, clashTargets, findingNav, sweepMerge, scrubTrack | 104/104 PASS | `unit.txt` |
| Chromium: Sim, Makrospalten, Layout und Formulardichte | 18/18 PASS | `chromium.txt` |
| Chromium: drei zusätzliche Follow-Fälle | 2 PASS, 1 FAIL | `follow-chromium.txt` |
| Firefox: drei bestehende + drei zusätzliche Fälle | 5 PASS, 1 FAIL | `firefox.txt` |
| Chromium: Wiedergabe mit reduzierter Bewegung, erste Fassung | PASS | `playback-reduced.txt` |
| Chromium: finale Wiedergabe-Sonde mit Bild | Erwartetes FAIL | `playback-capture.txt` |
| Chromium: finale Kontrolle mit reduzierter Bewegung | PASS | `playback-reduced-final.txt` |

Die erste eigene Wiedergabeprüfung verlangte vollständige Sichtbarkeit an
jedem Messpunkt. Zur Unterscheidung von kurzem Animationsverzug wurde die
finale Sonde gelockert: Erst mehr als 500 ms aufeinanderfolgend beobachtete
unvollständige Sichtbarkeit führen zum Fehlschlag. Auch damit bleibt die
normale Animation rot (1465 ms im Bildlauf). Der erste Chromium-Lauf liefert
1514 ms und Firefox 1209 ms. Die beiden anderen eigenen Fälle blieben
unverändert. Die reduzierte Bewegung besteht auch mit der finalen Fassung.

Die Rohdaten werden ungefähr alle 50 ms gelesen; tatsächliche Zeitstempel
schließen den Aufwand der Browserabfragen ein. Die Auswertung behauptet
keine lückenlose Aufnahme jedes gerenderten Frames. `playback-summary.json`
trennt vorhandene Markierungen, teilweise abgeschnittene und vollständig
außerhalb liegende Zeilen. Nach dem letzten Ziel hat die Liste keine
Markierung mehr; solche Messpunkte zählen nicht als Fehler.

Die Sonde nutzt die LONG_PREVIEW/LONG_TEXT-Fixture des neuen Tests, ein
XYZ-Profil, 50 Grenzzeilen, 1280 × 800, Faktor ×100 und den Start bei 15 %.
Die Markierung ist vor Play bereits zentriert. Der normale Lauf und die
Kontrolle unterscheiden sich nur in `prefers-reduced-motion`. Das zusätzliche
Bild wird nur im gesonderten Capture-Lauf aufgenommen, sobald die markierte
Zeile deutlich unterhalb der Ansicht liegt. Die Grundmessungen enthalten
keine Screenshots während der Wiedergabe.

Der Mock-Lauf verwendet drei eintreffende Positionsmeldungen mit
`joint_pos` und laufendem Interpreter; er führt kein Programm auf LinuxCNC
aus. Die Aktionsanmeldung wird im Vue-Renderer getestet, nicht durch einen
echten HMR-Vorgang in einer geöffneten Vite-Seite.

## Wiederholung

Archivkopie und Abhängigkeiten wie oben bereitstellen, `isolation.patch`
anwenden, `evidence/` neben `lcnc-webui/` anlegen. Konfigurationen dieser
Belegserie als `lcnc-webui/r81.chromium.config.ts`,
`r81.firefox.config.ts`, `r81.vitest.config.ts` ablegen; die eigene Sonde
als `lcnc-webui/e2e/r81.follow.spec.ts`.

Aus `lcnc-webui/`; Browserläufe nacheinander, Port 4188 frei:

```sh
nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r81.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r81.chromium.config.ts --grep 'sim-panel.viewer|a table that starts scrolling|On bar and the order|Macros tab and its editor never|side-pane navigation|every field is named'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r81.chromium.config.ts r81.follow.spec.ts
env R81_BROWSER=firefox nice -n 19 node node_modules/@playwright/test/cli.js test --config r81.firefox.config.ts --grep 'R81:|a table that starts scrolling|On bar and the order|the list follows the position'
env R81_CAPTURE=1 nice -n 19 node node_modules/@playwright/test/cli.js test --config r81.chromium.config.ts --grep 'R81: continuous'
env R81_REDUCED=1 nice -n 19 node node_modules/@playwright/test/cli.js test --config r81.chromium.config.ts --grep 'R81: continuous'
```

Kein vollständiges Offline-Gate und keine Live-/Geräteabnahme.
`context.json` dokumentiert Quellstand und Isolation; `dist-sha256.json` den
benutzten Build, `sha256.json` die neue Belegserie ohne sich selbst.
