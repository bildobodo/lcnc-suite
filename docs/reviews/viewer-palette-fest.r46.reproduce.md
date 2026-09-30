# R46 · Codex · isolierte Nachprüfung · 30. September 2026

Archiv von `95aaf08bb496429473689eaf166077bdaa77dda9`, Bereich
`c005eb9..95aaf08`. Arbeitskopie `/tmp/codex-r46-8cgd70p_`.
Nur die beiden Review-Dateien im Live-Baum ergänzen und neue R46-Belege
ablegen. Keine Produktänderungen, Builds oder Tests dort; keine Zugriffe
auf :5173/:8000, keine LinuxCNC-/HAL-Verbindung, kein Maschinenbefehl und
keine Quittierung des Trips. Ein eigener Mock auf `127.0.0.1:4188`, ein
Browserworker, `nice -n 19`, schwere Prüfungen nacheinander.

## Reproduktion

In einer frischen Archivkopie `lcnc-webui/node_modules` mit den bereits
installierten Abhängigkeiten verknüpfen. Vite/Vitest `cacheDir` in der Kopie
auf `./.review-cache`, tsconfig-Buildinfo von `./node_modules/.tmp/` auf
`./.review-tsbuildinfo/` umstellen. `e2e/ctl.ts` auf `127.0.0.1:4188`
richten. Diese Anpassungen betreffen allein Prüfumgebung und Caches.

Im WebUI-Verzeichnis:

```sh
nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b
nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner
nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/viewer/boxLines.test.ts src/viewer/backplotController.test.ts src/viewer/toolpathController.test.ts src/viewer/toolsetterMarker.test.ts
```

Playwright: Chromium headless, `workers: 1`, `fullyParallel: false`,
Timeout 60 s, Expect-Timeout 10 s, Locale `en-GB`, Zeitzone `UTC`, DPR 1;
die Originalspecs setzen DPR 2 selbst, wo erforderlich. Originale Specs
`scenes.viewer.spec.ts`, `toolsetter.viewer.spec.ts`, `reach.viewer.spec.ts`
sowie die eigene [Probe](viewer-palette-fest.r46.browser-probe.ts) als
`e2e/r46.spec.ts`. Mock aus derselben Kopie starten:

```sh
env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
```

Gateway-Unit-Tests mit den vorhandenen Python-Abhängigkeiten, `-B`,
`LCNC_LOG_DIR` unter dem Archiv und **vor** den Tests
`import fake_linuxcnc; fake_linuxcnc.install()` ausführen. Geprüft wurden
`test_status_runtime` und `test_sim_toolsetter`, zusammen 62 Fälle. Kein
Import einer echten LinuxCNC-Verbindung.

Die zwei eigenen Python-Sonden unter `evidence/` kopieren und von der
Archivwurzel ausführen:

```sh
python3 -B evidence/sim-toolsetter.r46.probe.py . > evidence/sim-toolsetter.r46.probe.json
python3 -B evidence/sim-toolsetter.r46.status-probe.py > evidence/sim-toolsetter.r46.status.json
```

Die Statussonde installiert ebenfalls den Fake **vor** dem Import von
StatusRuntime und prüft auch `poll_and_serialize()`. Die Kontaktsonde
kompiliert nur den unveränderten C-Funktionsrumpf aus der `.comp`-Datei zu
einer temporären Bibliothek. Kein HAL-Start.

## Anpassungen gegenüber den R45-Sonden

[Exakter Diff](viewer-palette-fest.r46.probe-adaptations.patch):

- Commit- und Dateinamen auf R46; alte Belege unverändert.
- `tool_table_z` aus dem echten Statuspfad lesen und zum Browser übertragen;
  positiven Ausgangszustand ebenfalls mit diesem Feld versehen. Die
  bisherige Erwartung −170 beim negativen G43-Fall bleibt unverändert.
- Zusätzliche Folgen: negatives G49, nur das Vorzeichen der Tabelle geändert
  bei konstantem Betrag/aktivem Offset, expliziter Tabellenwert 0, keine
  Tabellenzeile mit/ohne aktiven Offset. Kein Backplot-Segment durch einen
  solchen Basiswechsel.
- Der alte Datenname `entirelyLightByShader` heißt jetzt `segmentsUnder3px`:
  Die Längenmessung ist dieselbe, die frühere Schlussfolgerung „ganz hell“
  gilt mit der neuen Tonregel nicht mehr.

## Ergebnisse und Belege

Typecheck Exit 0 ohne Ausgabe; [Build PASS](viewer-palette-fest.r46.build.txt),
[Viewer-Unit-Tests 65/65](viewer-palette-fest.r46.vitest.txt),
[Backend 62/62](sim-toolsetter.r46.backend.txt).

Der [erste Browserlauf](viewer-palette-fest.r46.browser-tests.txt) hat fünf
Fälle bestanden (eigene Sonden, Reichweiten-Wächter, zwei Szenenfälle).
Der separat gestartete Mock endete mit Exit **143/SIGTERM** ohne
Fehlerausgabe. In der Breitenprüfung fehlte anschließend der neue
Modellaufbau; fünf weitere Fälle scheiterten direkt mit
`ECONNREFUSED 127.0.0.1:4188`. Der Auslöser des Signals ist nicht bekannt.
Dieser Lauf wird **nicht** als grün gewertet.

Die sechs betroffenen Fälle wurden ohne Produkt-/Specänderung mit neuem
Mock wiederholt, in einem gemeinsamen Python-Prozessverbund: Server per
`Popen`, Bereitschaft über `http://127.0.0.1:4188/`, Playwright per `run`,
Server anschließend im `finally` beendet. Auswahl:
`width ladder|box edge alone|box dashes hold|tool setter shows|G49 never|drawn tip keeps`.
Die Wiederholung bestand **6/6**, Mock vor der abschließenden Bereinigung noch aktiv.
[Wiederholung](viewer-palette-fest.r46.browser-rerun.txt) und
[kompakte Ergebnisübersicht beider Läufe](viewer-palette-fest.r46.browser-summary.json).
Die Übersicht lässt eingebettete Bildbytes aus, hält Testergebnisse,
Fehler, Laufzeiten und die sechs Reichweiten-Messannotationen fest.

Eigene [Reichweiten-Zustände](viewer-palette-fest.r46.reach.json) und PNGs
zeigen die originale R45-Ansicht mit der neuen Darstellung: nur Part Reach,
XYZAC-Modell samt STL, gleiche Gelenkgrenzen und Werkzeuglänge, Draufsicht
und schräge Ansicht, Hell/Dunkel. Die geometrischen Zähler beweisen keinen
Pixelkontrast; dafür dienen Sichtprüfung und der neue gerenderte Wächter.

[Gateway-Statusdaten](sim-toolsetter.r46.status.json),
[Viewer-Folgezustände](sim-toolsetter.r46.viewer.json) und
[native Kontaktfolgen](sim-toolsetter.r46.probe.json). Die Kontaktfolgen
ignorieren weiterhin Servoperioden-Quantisierung, Finderkorrektur und
Werkstückoffset; sie sind keine nachgespielte LinuxCNC-Taskfolge.

Kein vollständiges Offline-Gate, kein Live-Messlauf und keine Teil-B-
Leistungsmessung. Der Live-Lauf nach Neustart/Homing bleibt separat beim
Operator. Eigene Prozesse vor dem Handshake beendet.
