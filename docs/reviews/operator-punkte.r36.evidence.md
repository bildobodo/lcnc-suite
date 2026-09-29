# R36 · P6-Nachtrag · eigene Nachweise

Stand: b13d2dfafb421b75db8ad7994b9bb25e8c02b6a3, Vergleich 09ef72e..b13d2df.
Ausführung: 29.09.2026, isoliertes git archive unter /tmp/codex-r36-nj8ge8tq.
Kein Zugriff auf die Live-Dienste :5173/:8000, keine LinuxCNC-Befehle.

## Reproduktion

Archivieren: `git archive b13d2df lcnc-webui test-fixtures scripts examples/sim_config/machine-5axis-xyzac`.
Abhängigkeiten aus bestehendem node_modules nur lesend verlinkt. In der Kopie:
- tsconfig: Build-Info von `./node_modules/.tmp/` nach `./.review-tsbuildinfo/` umgeleitet.
- vite.config.ts / vitest.config.ts: `cacheDir: "./.review-cache"`.
- e2e/ctl.ts: `localhost:4174` durch `127.0.0.1:4188` ersetzt.
- `nice -n 19 node node_modules/vue-tsc/bin/vue-tsc.js -b` und
  `nice -n 19 node node_modules/vite/bin/vite.js build --configLoader runner`.
- `nice -n 19 node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers 1 src/offsetRows.test.ts src/helpPlacement.test.ts`.
- Beiliegende .spec.ts nach e2e/, .playwright.config.ts nach playwright.r36.config.ts kopiert.
- `env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs`.
- `nice -n 19 node node_modules/@playwright/test/cli.js test --config playwright.r36.config.ts`.

Build erfolgreich, 12/12 Vitest, 11/11 Playwright (6 vorhandene, 5 eigene).
Browser seriell mit einem Worker. Mock anschließend beendet.
Screenshots und Mess-JSON gehören zu diesem letzten Lauf.

Die eigene Sonde verwendet für das Öffnen direkte Maus-/Touch-Koordinaten im
sichtbaren Kopf: Locator.click/tap scrollte in einem Vorlauf den Tabellenkopf
selbst ins Sichtfeld und setzte dadurch den Tabellen-Scroll zurück. Direkte
Pointer-Eingaben bestätigen erhaltenen Scrollstand (104, 191, 392, 334 px).
Dieser Automatisierungseffekt ist kein Produktbefund. Die fünf eigenen Fälle
bestanden auch im Vorlauf; der letzte Lauf prüft zusätzlich den Scrollstand.

150 % ist CSS-zoom, keine native Browserzoom-/Betriebssystemprüfung. Die XYZAC-
Tabelle benötigt dabei horizontalen Scrollraum (512 bei 264 CSS-px Innenbreite),
die Hilfe selbst bleibt vollständig im Fenster. Bei 100 % haben alle vier
geprüften Formate keine horizontale Überbreite der Tabelle. Kein vollständiges
Offline-Gate neu ausgeführt und keine Aussage zu anderen Browsern.

## Quellen zur Textprüfung (abgerufen 29.09.2026)

- [LinuxCNC 2.9, Coordinate Systems, G92 und G52](https://linuxcnc.org/docs/2.9/html/gcode/coordinates.html):
  Gemeinsame Register; G92.2 setzt die Wirkung aus, ohne gespeicherte Werte zu
  löschen. Fortbestehen nach Programmende und Neustart ist der Standard, lässt
  sich mit DISABLE_G92_PERSISTENCE = 1 abschalten. Hierauf beruht OP-I07.
- [LinuxCNC 2.9, INI-Konfiguration, RS274NGC](https://linuxcnc.org/docs/2.9/html/config/ini-config.html#sub:ini:sec:rs274ngc):
  DISABLE_G92_PERSISTENCE hat den Standardwert 0.
- [LinuxCNC 2.9, G43 / G43.1 / G43.2 / G49](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g43):
  Tabellenkorrektur, dynamische Ersetzung und additive Korrektur erklären,
  weshalb die wirksamen Werkzeugwerte nicht stets den Tabellenwerten entsprechen.

Die UI liest für den Hilfetext keine Persistenzeinstellung; er ist ein konstantes
Template in src/OffsetPanel.vue:189. Dass die mitgelieferten Sim-INIs den Standard
verwenden, begrenzt den Einsatz der WebUI nicht auf diesen Standard (README.md,
LinuxCNC Configuration: aktive INI zur Laufzeit). Für diesen Befund ist keine
Maschinenfahrt oder Veränderung einer INI erforderlich.
