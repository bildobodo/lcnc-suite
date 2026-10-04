# R73 · Codex · Prüfprotokoll · 4. Oktober 2026

## Stand und Isolation

Review `0fab6c5..66b22bc` auf `feat/backlog-integration`, Anfrage im Live-HEAD
`85e7a03`. Geprüft aus `git archive 66b22bc` in
`/tmp/codex-r73-wo4_8y75/archive`. Im Live-Checkout nur Lesezugriffe sowie
Review-Anhang und neue R73-Belege. Keine Produktänderung, kein Checkout,
kein Build dort, keine Verbindung zu :5173/:8000 und kein Maschinenbefehl
an LinuxCNC. Alle Browserprüfungen benutzen ausschließlich den eigenen Mock
auf `127.0.0.1:4188`, jeweils einen Worker und `nice -n 19`.

## Ergebnisse

| Prüfung | Ergebnis | Belegsuffix `viewer-palette-fest.r73.` |
|---|---|---|
| TypeScript/Vite-Produktbuild | PASS | `build.txt` |
| Ausgewählte Unit-Tests: Referenz, Meldungen, WebSocket-Zustand/Transport, Berechtigungen, Hinweisplatzierung | 119 PASS, 10 Dateien | `unit.txt` |
| Bestehende Chromium-Tests: choices, dialogs, gcode-reference, messages, select-writes, tool-table-read | 85 PASS, ein Lauf, 5,6 min | `browser.txt` |
| Eigene vertauschte Werkzeugantworten: alter Fehler + alter Erfolg nach neuer Tabelle | PASS in Tabelle und Werkzeugleiste | `out-of-order.json`, `probes.txt` |
| Eigene echte 60-s-Frist ohne Uhrbeschleunigung, abgelaufene Antworten, Retry beider Leser | PASS; Langsam-Hinweis beobachtet nach 8468 ms, Ende nach 60088 ms | `timeout.json`, `probes.txt` |
| Eigene Gamepad-Auswahl während Status- und Pad-Updates | PASS Chromium und Firefox | `gamepad-edits-chromium.json`, `gamepad-edits-firefox.json` |
| Eigene Meldungsansicht mit langem Text und Safety-Trip, 150 % Hochformat und Desktop | PASS nach Korrektur der Mock-Daten | `messages-rerun.txt`, `messages-layout.json`, `messages-narrow.png`, `messages-desktop.png` |
| Linux-Firefox: Referenz-Menü ohne Mutation, Gamepad-Menüs ohne Mutation, Gamepad-Wahl weiterhin änderbar | 3 PASS, Firefox-Build firefox-1522 | `firefox.txt` |
| Zusatzmessung außerhalb der Abnahmematrix: Querformat 1280×800, 150 %, Safety-Trip | bekannte Grenze bestätigt, Assertion rot | `messages-short.txt`, `messages-short.json`, `messages-landscape-1.5.png` |

Die beiden Meldungsrenderings wurden visuell angesehen. In den abgenommenen
Größen bleiben Text und Aktionen getrennt, die lange Meldung kann im eigenen
Bereich gescrollt werden. Die Desktop- und Portrait-Dialogscans aus dem bestehenden
Lauf enthalten auch Fokus, Tab-Bereich, Rückkehr und gestapelte Dialoge.

### Eigene Fixture-Korrektur

Der erste Lauf der vier eigenen Fälle ergab 3 PASS / 1 FAIL. Die Layoutprobe
hatte nur `data.estop` gesetzt, erwartete aber den **Detailbanner** eines Safety-Trips.
Ein normales E-Stop erzeugt diesen Banner nicht (`App.vue:216ff`), deshalb fand die
Assertion `.msgContent > .statusNote` kein Element. Die korrigierte Probe sendet im
Mock einen `status_delta`-Umschlag mit `safety_trip.reason = hal_heartbeat_timeout`.
Nur dieser Fall wurde wiederholt und bestand. Produktquellen unverändert; das
ursprüngliche Ergebnis bleibt in `probes.txt`. Die beiliegende Sonde enthält die
korrigierten Testdaten. Das war kein Produktfehler und kein flüchtiger Testerfolg.

### Bekannte Grenze statt neuer R73-Befund

Die ergänzende fünfte Probe misst 1280×800 bei 100 % und 150 % mit Safety-Trip.
Bei 100 % bleiben 145 px Tabellenhöhe, davon 93 px unter dem Kopf. Bei 150 %
hat der Dialog nur 75 px Höhe und die Tabelle 0 px. Das betrifft die gesamte
Inhaltsfläche. Die Erwartung dieser Zusatzprobe geht über die bestehende Zusage
hinaus: `docs/reviews/ui-design-welle.plan.md:106` grenzt **Querformat ab 150 %
(Gesamtaufteilung) und 200 %** ausdrücklich aus; Zeile 515 führt es als Folgearbeit.
Das rote Ergebnis wird nicht als bestanden ausgegeben und nicht als neuer
R73-Regressionsnachweis gewertet. Die neue Dialog-Mindestbreite löst diese bereits
bekannte Höhengrenze nicht. Die R73-Abnahme schließt sie weiterhin aus.

### Weitere Quellprüfung

- Neue/angepasste Produktkomponenten und beide reinen Ansichtshelfer gelesen;
  keine Gateway-Differenz in diesem Bereich.
- Die zwölf Anpassungen der Werkzeugfixtures erhalten die Assertions und liefern
  zugeordnete Antworten auf echte Lesungen statt unaufgeforderter Tabellen.
- `refControls` nimmt im Hochformat nur den bei Eingabehilfe absichtlich faltenden
  Statusdetailteil aus der Invariante; Arm/E-Stop/Power bleiben Vergleichsziele.
- Das 300-ms-Fenster beim Hinweis ist eine zeitliche Toleranz, kein Nachweis,
  wodurch ein Scroll entstand. Pointerdown/Keydown schließen weiter sofort;
  der gezielte Früher-/Später-Scrolltest besteht.
- `git diff 0fab6c5..66b22bc --check`: sauber. Eigener Review-Diff separat geprüft.

## Wiederholung

In einer Archivkopie Abhängigkeiten aus dem installierten `node_modules`
verfügbar machen; Build-/Testcaches lokal halten. Die TS-Pfade
`./node_modules/.tmp/` wurden auf `../r73-ts-cache/` umgeleitet, Vite erhielt
`cacheDir: '../r73-vite-cache'`, Vitest `../r73-vitest-cache`. In `e2e/ctl.ts`
nur `localhost:4174` durch `127.0.0.1:4188` ersetzen. Die vier beiliegenden
Konfigurationen als `r73.*.config.ts` im archivierten `lcnc-webui/` ablegen,
die Sonde als `e2e/r73.probe.spec.ts`; daneben auf Archivwurzelebene `evidence/`
anlegen. Für Browserstart und lokalen Listen-Socket war Sandbox-Eskalation nötig.

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r73.vitest.config.ts
# Der ursprüngliche Lauf hatte die eigene Sonde noch nicht im Testverzeichnis.
nice -n 19 node node_modules/@playwright/test/cli.js test --config r73.playwright.config.ts --grep-invert 'R73:'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r73.probes.config.ts --grep-invert 'short landscape display'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r73.firefox.config.ts --grep 'nothing writes into the group|Settings › Gamepad|memoized Gamepad'
# Getrennt: der außerhalb der Abnahmematrix liegende, rote Zusatzfall.
nice -n 19 node node_modules/@playwright/test/cli.js test --config r73.probes.config.ts --grep 'short landscape display'
```

`gamepad-edits.json` wurde nach dem jeweiligen Lauf als `gamepad-edits-chromium.json`
bzw. `gamepad-edits-firefox.json` gesichert. Der erste eigene Vierer-Lauf und die
gezielte Fixture-Wiederholung sind getrennte Protokolle, kein behaupteter grüner
Vierer-Gesamtlauf. Es wurde kein vollständiges Offline-Gate wiederholt und kein
Backend erneut getestet, weil unverändert. Kein Test auf macOS oder mit einem
realen Controller; Operator-Sichtprüfung bleibt ausstehend. Die Firefox-Prüfung
misst DOM-Mutationen und Auswahlverhalten, nicht ein macOS-Systemmenü.
