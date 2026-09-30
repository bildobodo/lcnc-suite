# R45 · Codex · isolierte Nachprüfung · 30. September 2026

Stand `8e2b00541f48c31083c88f58d0a7e6fbc4beaf80`, Archivkopie
`/tmp/codex-r45-_jdohqlz`, Review-Bereich `77966b8..8e2b005`.
Keine Produktänderung im Live-Baum, kein Zugriff auf :5173/:8000,
keine LinuxCNC-/HAL-Abfrage und kein Maschinenbefehl. Der offene Trip blieb
unberührt. Eigener Mock ausschließlich `127.0.0.1:4188`; ein Browserworker,
alle Build-/Testprozesse mit `nice -n 19`, schwere Läufe nacheinander.
Mock und Browser vor der Rückmeldung beendet.

## Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| `vue-tsc -b` | Exit 0, keine Ausgabe |
| Vite-Produktionsbuild | PASS, [Log](viewer-palette-fest.r45.build.txt) |
| boxLines, backplotController, toolpathController, toolsetterMarker | **60/60**, [Log](viewer-palette-fest.r45.vitest.txt) |
| test_sim_toolsetter | **12/12**, [Log](sim-toolsetter.r45.backend.txt) |
| Originale scenes.viewer + toolsetter.viewer | **7/7**, [Log](viewer-palette-fest.r45.browser-tests.txt) |
| Eigene Reichweiten-Beobachtung | PASS (Aufbau/Messung, keine Behauptung einer bestandenen Kontrastanforderung) |
| Eigener G43-Wächter mit negativem Offset | **FAIL: −300 statt −170**, [Log](viewer-palette-fest.r45.own-browser.txt) |
| Nativer Kontakt-Funktionsrumpf | Positive Referenz/Motorversatz stabil; Fehlreferenz erzeugt Folge 45/25/5, [JSON](sim-toolsetter.r45.probe.json) |
| Gateway-Status mit Fake-STAT | `tool_length` ist Betrag, auch beim Fallback, [JSON](sim-toolsetter.r45.status.json) |

[Browser-Ergebnisübersicht](viewer-palette-fest.r45.browser-summary.json):
Metadaten/Fehler aus den beiden Playwright-JSON-Berichten, eingebettete
Bildbytes ausgelassen. Die eigenen PNGs stehen separat daneben. Keine
vollständige Offline-Gate-Wiederholung, kein Live-Messlauf, kein Teil B.

## Reproduktion

Archiv von `8e2b005` anlegen. `lcnc-webui/node_modules` darf auf die bereits
installierten Abhängigkeiten verweisen. In der **Archivkopie** Vite/Vitest
`cacheDir: './.review-cache'` setzen, tsconfig-Buildinfo von
`./node_modules/.tmp/` nach `./.review-tsbuildinfo/` umlegen; `e2e/ctl.ts`
auf `127.0.0.1:4188` statt `localhost:4174` richten. `evidence/` anlegen.
Die Produktsourcen und die beiden mitgelieferten Specs bleiben unverändert.

Im WebUI-Verzeichnis jeweils nacheinander:

```sh
nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/boxLines.test.ts src/viewer/backplotController.test.ts src/viewer/toolpathController.test.ts src/viewer/toolsetterMarker.test.ts
env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
```

Playwright mit `testDir: './e2e'`, `workers: 1`, `fullyParallel: false`,
Chromium headless, Basis `http://127.0.0.1:4188`, Locale `en-GB`, Zeitzone
`UTC`, DPR 1, Timeout 60 s und Expect-Timeout 10 s. Die Originalspecs setzen
DPR 2 selbst, wo ihr Fall es verlangt. Zuerst nur
`scenes.viewer.spec.ts toolsetter.viewer.spec.ts` ausführen.

Eigene [Browserprobe](viewer-palette-fest.r45.browser-probe.ts) als
`lcnc-webui/e2e/r45.spec.ts` kopieren. Die folgenden Sonden unter `evidence/`
kopieren und **aus der Archivwurzel** ausführen (Python mit den vorhandenen
Gateway-Abhängigkeiten):

```sh
python3 -B evidence/sim-toolsetter.r45.probe.py . > evidence/sim-toolsetter.r45.probe.json
python3 -B evidence/sim-toolsetter.r45.status-probe.py > evidence/sim-toolsetter.r45.status.json
```

Danach `r45.spec.ts` ausführen. Erwartet: Beobachtung bestanden,
G43-Regressionswächter rot. Die Statussonde installiert `fake_linuxcnc`
**vor** Import von StatusRuntime; sie benutzt ausschließlich geskriptete
STAT-Werte. Die native Sonde kompiliert ausschließlich den C-Funktionsrumpf
der Kontaktformel zu einer temporären Bibliothek; kein HAL-Start.

## Eigene Messungen und Grenzen

Die Reichweitenprobe verwendet das ausgelieferte XYZAC-Modell samt STL,
Jointlimits und Werkzeuglänge 65. Nur Part Reach ist sichtbar; zwei
Blickrichtungen, Hell/Dunkel. Die Diagnose misst Segmentlängen in CSS px.
[Messdaten](viewer-palette-fest.r45.reach.json) enthalten Zähler, Kamera,
Palette und begrenzte Beispielsätze statt derselben langen Segmentliste
für beide Themes. `entirelyLightByShader` bezeichnet den analytischen Fall
`Länge <= 3`: die lokale Strichphase erreicht keine Dunkelpause. Das ist
keine Pixelklassifikation; dunkle Endkappen/Antialiasingreste sind möglich.
Die tatsächliche Ansicht ist in den vier PNGs festgehalten.

Eine erste lokale Probenfassung schickte beim Themewechsel nur `display`
und setzte dadurch die Layer auf Vorgaben zurück. Diese leere Messung wird
nicht gewertet; die beigefügte Fassung sendet die komplette Layerkonfiguration
und verlangt mehr als 100 projizierte sowie im Bild liegende Segmente.

Die eigene Werkzeugprobe nimmt den negativen Fall aus dem **originalen**
Gateway-Statuspfad, nicht aus einem künstlich negativen `tool_length`.
Gelenk-Z −235, T13/Tabellen-Z −65 ergeben gemeldet L65 und aktiven Offset −65.
Der bisherige G43-/Work-Bezug ergibt −170, die neue Live-Zeichnung −300.
G49 mit positiver Tabellenlänge bleibt korrekt; das zeigt dieselbe Probe.
[Viewer-Zustände](sim-toolsetter.r45.viewer.json).

Die Kontakt-Folgenrechnung ignoriert Servoperioden-Quantisierung,
Finderkorrektur und Werkstückoffset (wie R44). Sie ist keine nachgespielte
LinuxCNC-Taskfolge. Mit korrekter Referenz bleibt 65 auch bei angenommenem
Motor-minus-Gelenk-Versatz +1 erhalten. Mit Platte −300 und Referenz −280
wird das Ergebnis jeder Messung für die nächste wieder als physische Länge
verwendet: 65 → 45 → 25 → 5. Dieser Rückkopplung widerspricht die neue
Behauptung eines konstanten Fehlers; er ist kein erneuter Parameterdatei-Race.
