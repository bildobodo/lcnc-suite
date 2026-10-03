# R70 · Codex · Nachweise · 3. Oktober 2026

Geprüft: Plan `04ef2e5..ef3be59`, Umsetzung `ef3be59..e74ac8a` auf `feat/macros`.
Live-Baum während der Prüfung: `feat/backlog-integration bee4732`. Die Anfrage und
fünf Nachträge stehen dort in `viewer-palette-fest.ideen.md`; sie sind nicht alle
in der Produkt-Archivkopie enthalten. Keine Änderungen am Produkt, keine Live-
Maschinenbefehle, keine Verbindung zu :5173 oder :8000. Vorhandene Belege unverändert.

Arbeitskopie: `git archive e74ac8a`, entpackt nach
`/tmp/codex-r70-29ou1cy3/archive`. Eigener Mock ausschließlich `127.0.0.1:4188`,
Build/Browser mit `nice -n 19`, ein Worker. `node_modules` als Link auf installierte
Abhängigkeiten, TypeScript-Cachepfade im Archiv auf `../r70-ts-cache/` umgelegt,
Vitest-Cache ebenfalls im Archiv. Keine Cache-/Build-Schreibzugriffe in die
Live-Abhängigkeiten. `e2e/ctl.ts` im Archiv auf Port 4188 umgestellt.

## Ergebnisse

| Prüfung | Ergebnis | Belegsuffix `viewer-palette-fest.r70.` |
|---|---|---|
| Produktionsbuild, `VITE_GATEWAY_PORT=4188 npm run build` | PASS | `build.txt` |
| Vier bestehende Backend-Dateien | 83 PASS, Exit 0 | `backend.txt` |
| Ausgewählte Unit-Tests | 7 Dateien, 35 PASS | `unit.txt` |
| Bestehende Browserfälle | 36 PASS, 2 FAIL im Testaufbau | `browser.txt` |
| Die zwei Originalfehler erneut + drei eigene UI-Proben | Originale erneut rot; 2 eigene rot, 1 grün | `browser-probes.txt` |
| Kopien der zwei Originalfälle mit stabilisiertem Aufbau | 2 PASS | `browser-existing-copies.txt`, `existing-tests.patch` |
| Fünf neue Backend-Gegenproben | 5 erwartete FAIL, vier Befunde | `counterprobes.txt`, `counterprobes.jsonl`, `backend-probe.py` |
| Nativer INI-Leser gegen Driftprüfung | wirksamer Wert 10 → 20, gemeldeter Drift leer | `ini-drift.json`, `ini-probe.py` |

Die zwei kopierten Browserfälle verändern keine Produktquelle: vor der Wahl
zwischen Tab und Select wartet die Layoutprobe auf den Resize; die Jog-Gegenprobe
friert den Mock-Status ein, wartet auf aktive Shortcuts und beobachtet `jog_cont`
noch während des gehaltenen Keys (wie die bestehenden Tab-Tests). Der originale
Lauf wird damit nicht nachträglich als vollständig grün ausgegeben.

Die eigene Frame-Probe ist grün (`frame-gate.json`): Run im Tab und in der Leiste
sind gesperrt. Die beiden roten UI-Proben erzeugen `save-conflict.json/.png` und
`late-editor.json/.png`. Beim zweiten Fall verhindert die Modalität weiterhin
Hintergrundklicks; belegt sind der veraltete sichtbare Text und die fälschlich
saubere/freigegebene Editorbasis, keine ausgeführte Bewegung.

## Wiederholung (nur in einer wegwerfbaren Archivkopie)

Die beigefügten Konfigurationen setzen einen eigenen Mock voraus. Keine Tests
gegen die Live-Suite richten. Kopiere `backend-probe.py` als
`lcnc-gateway/test_r70_review.py`, `browser-probe.spec.ts` als
`lcnc-webui/e2e/r70.review.spec.ts` und die drei Playwright-Konfigurationen als
`r70.playwright.config.ts`, `r70.probes.config.ts`,
`r70.existing-copies.config.ts` nach `lcnc-webui/`. Die Vitest-Konfiguration heißt
dort `r70.vitest.config.ts`. Erzeuge im Archiv `evidence/` und passe `e2e/ctl.ts`
auf `http://127.0.0.1:4188` an.

```sh
# im archivierten lcnc-gateway; der Test importiert zuerst fake_linuxcnc
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider test_r70_review.py

# Bestehende Backend-Auswahl; Installer-Goldens brauchen nur lesende Git-Historie:
PYTHONDONTWRITEBYTECODE=1 GIT_DIR=/home/cnc/lcnc-suite/.git GIT_WORK_TREE=/tmp/codex-r70-29ou1cy3/archive GIT_OPTIONAL_LOCKS=0 python -m pytest -q -p no:cacheprovider test_macro_files.py test_macros_gateway.py test_config_sync_check.py test_example_install.py

# im archivierten lcnc-webui, nach dem Build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r70.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r70.playwright.config.ts --grep 'macros.spec.ts|editor-guards.spec.ts|macro bar is one row|orientation change mid-hold|tab semantics|hidden panel|Abort ends the machine actions'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r70.probes.config.ts --grep 'R70:|never run out sideways|one action row:'
```

Für die angepassten Testkopien: `macros.spec.ts` nach
`r70.existing-copies.spec.ts` kopieren und die Änderungen aus `existing-tests.patch`
anwenden; dann `--config r70.existing-copies.config.ts --grep 'never run out sideways|one action row:'`.

Der erste Backend-Versuch in der Sandbox hing beim Async-Teil und wurde beendet.
Der erste Lauf außerhalb der Sandbox hatte ausschließlich drei historische
Installer-Proben rot, weil `git show 3e501ed` im Archiv ohne Git-Historie nicht
funktioniert. Der dokumentierte finale Lauf erhielt die Historie lesend über
`GIT_DIR`/`GIT_WORK_TREE` und bestand. Logs der erfolglosen Aufbauten sind separat
als `backend-sandbox.txt` und `backend-no-history.txt` erhalten.

## Fachliche Quellen und Grenzen

- LinuxCNC Task-Quelle: `src/emc/task/emctaskmain.cc`, insbesondere 1420–1466
  (MDI-Queue und abgelehnte Befehle), 3395–3407 (Task-Fehler), 3546–3565
  (`RCS_ERROR` gegenüber dem nur bei leeren Queues gesetzten `RCS_DONE`).
  [Upstream v2.9.4](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/task/emctaskmain.cc#L3546).
  Gelesen aus der vorhandenen lokalen Quellkopie unter Claudes `scratchpad/src/`;
  die Webansicht des Tags ist erreichbar, der Raw-Abruf lieferte Cache miss.
  Debian-spezifische Patches und das Queue/Error-Szenario wurden nicht an der
  laufenden Instanz geprüft. Die Gateway-Gegenprobe nutzt Fake-Statuswerte und
  echte Gateway-Funktionen; die Herleitung ihrer Relevanz ist ein Quellbefund.
- `makros.live-r1.txt` wurde geprüft, aber nicht erneut erzeugt: Claudes getrennte
  LinuxCNC-Sim, Cache-Mutation, Einheiten, Spindel und G30/Park. Keine unabhängige
  Live-Abnahme in R70; keine Wiederholung des gesamten Offline-Gates.
- Die INI-Probe nutzt ausschließlich `linuxcnc.ini` mit zwei temporären Dateien;
  sie erzeugt weder `linuxcnc.stat()` noch `linuxcnc.command()`.
