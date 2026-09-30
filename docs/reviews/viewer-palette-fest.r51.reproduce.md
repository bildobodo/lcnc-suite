# R51 · eigene Nachprüfung auf e5585e2

Stand: `e5585e235f91a2fce7767e3306f993ed8dca7228`, Basis `8f9ba47`.
Archiv: `/tmp/codex-r51-fakzpiqh`, erstellt mit `git archive e5585e2`.
Keine Builds/Tests im Live-Checkout; keine Zugriffe auf :5173/:8000,
keine Maschinenbefehle. Eigener Mock `127.0.0.1:4188`, ein Browser-Worker,
Priorität `nice -n 19`. Mock nach dem Lauf beendet.

## Prüfungen

- `vue-tsc -b --tsBuildInfoFile .review-tsbuildinfo` und `vite build`: PASS.
- Vitest `src/g30Form.test.ts src/viewer/tloEvents.test.ts`: **9/9** in zwei Dateien.
  Ein zusätzlich angegebener Filter `src/viewer/staleness.test.ts` traf keine
  Datei; dafür wird keine Testabdeckung beansprucht.
- Backend: `python -B -m pytest -o addopts= -q -p no:cacheprovider
  test_gateway_util.py test_pinned_worker.py`: **372 Tests + 24 Subtests**,
  einschließlich des vorhandenen nativen Worker-Wächters, ohne Skip.
- Browser: **14/14**, keine Flakes/Skips. Zwei eigene R50-Sonden mit
  offengelegten Erwartungsanpassungen, acht vorhandene Toolsetter-Tests und
  vier Fälle aus `collisions.viewer.spec.ts`. Der breite Filter `one line`
  nahm zusätzlich zwei bestehende Wiederkontakt-Fälle mit.
- Eigene native Sonde: **16 frische Prozesse**, je vier angewandte Z-Offsets
  (10 / 10,005 / 0 / 80) für Programme ohne TLO-Wort, mit barem G43,
  mit G43.1/G49 und gemischt mit G53/G43/G49. Kein Vor-Parse.
  Vollständige Payloads, nur ohne den je Prozess anderen temporären
  Dateinamen, per SHA-256 verglichen: je Programm identisch, kein Parsefehler.
- Eigene Driftmatrix: **8/8**; alter Auslöser `tool_offset` entfällt,
  `table_mtime`, `tool_loaded`, `table_row` und die Midrun-Trennung bleiben.

## Reproduktion im neuen Archiv

Belege nach `ARCHIV/evidence/` kopieren. Abhängigkeiten des Projekts verwenden;
Build-, Cache- und Testergebnisse ausschließlich im Archiv halten.
Die native Sonde benutzt die vorhandene Python-Umgebung
`/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python` nur als Interpreter.

1. Frontend bauen (eigene `ctl.json` auf `http://127.0.0.1:4188`, eigener
   Vite-/Vitest-Cache `.review-cache`). Die installierten node_modules wurden
   als Symlink verwendet; Buildausgaben landen im Archiv.
2. `viewer-palette-fest.r51.browser-probe.ts` nach
   `lcnc-webui/e2e/r51.viewer.spec.ts`,
   `viewer-palette-fest.r51.playwright.config.ts` nach
   `lcnc-webui/playwright.r51.config.ts` kopieren.
   `python3 evidence/viewer-palette-fest.r51.browser-run.py` ausführen.
3. `viewer-palette-fest.r51.native-case.py` nach
   `lcnc-gateway/r51_native_case.py` kopieren.
   `python3 evidence/viewer-palette-fest.r51.native-run.py` ausführen.
   Die Sonde ersetzt `linuxcnc.stat` vor Worker-Import durch synthetische Werte,
   sperrt `linuxcnc.command` und legt INI/Parameter/Tabelle temporär an.
4. `python3 -B evidence/viewer-palette-fest.r51.drift-probe.py` ausführen.
   `previous-drift.py` ist die per AST extrahierte Funktion aus `8f9ba47`,
   keine geänderte Produktdatei.

## Prüfgrenzen und Vorversuch

Eine erste Erweiterung der synthetischen nativen Sonde um explizites
`G43 H1` endete im nativen Modul mit SIGSEGV. Das ist weder als bestanden
gezählt noch als durch R51 verursachter Produktfehler gewertet; der
ursprüngliche Worker/Canon wurde in R51 nicht geändert. Die erfolgreiche
Matrix beschränkt sich auf die vier oben benannten Programme mit barem G43
bzw. G43.1. Die Ursache des H1-Vorversuchs wurde hier nicht geklärt.
Der erfolgreiche native Projektwächter bleibt davon separat.

Kein vollständiges Offline-Gate wiederholt. Keine Mac-Leistungsmessung,
Live-Messfahrt oder Bestätigung des angekündigten Live-heavy_test-Laufs.
Die unabhängige Invarianzprüfung trägt die Entfernung des nutzlosen
Offset-Parse-Auslösers; sie bescheinigt ausdrücklich keine vollständige
Richtigkeit aller Limitflags.

## Vorhandene Limitlücke

`native-probe.json`: `inherit`, Live-TLO Z10, Z-Max50, Programmziel Z45,
G54/G92 Null und XYZ-Identitätskinematik → erforderlicher Maschinenwert55,
aber `violations_total=0`, `feed_outside=[0]`.
Positive Kontrolle `g43` mit T1/Z10 im Programm → derselbe Vorschubpunkt45,
Limitbefund `Z=55 > 50`, `violations_total=1`, `feed_outside=[1]`.
`gcode_parse_worker.py` und `gcode_canon.py` sind zwischen Basis und HEAD
unverändert; STAT.tool_offset wird erst als Metadatum gelesen, nicht zur
Limitprüfung des Präfixes verwendet. Die alte Drift-Flanke konnte diesen
Befund daher durch Wiederholen desselben Parses nicht reparieren.
