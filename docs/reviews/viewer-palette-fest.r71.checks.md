# R71 · Codex · Prüfprotokoll · 3. Oktober 2026

Umfang `e74ac8a..b3ec5ee` auf `feat/macros`; Anfrage/Antwort im Live-Baum
`feat/backlog-integration af0ec1e`. Produktprüfung aus `git archive b3ec5ee` in
`/tmp/codex-r71-x9s3njg3/archive`, nur dort Builds und Tests. Eigener Mock
`127.0.0.1:4188`, ein Worker, `nice -n 19`. Keine Verbindung zur Operator-Suite
(:5173/:8000), keine LinuxCNC-Maschinenbefehle. Live-Protokoll von Claude gelesen,
nicht erneut gefahren. Im Live-Baum nur Review-Anhang und neue R71-Belege.

## Ergebnisse

| Prüfung | Ergebnis | Belegsuffix `viewer-palette-fest.r71.` |
|---|---|---|
| Build mit `VITE_GATEWAY_PORT=4188` | PASS | `build.txt` |
| Makroparser, Gateway, INI-Abgleich, Installer | 119 PASS | `backend.txt` |
| G30, einschließlich mehrfacher Cancellation der nun gemeinsamen Thread-Hilfe | 21 PASS | `g30.txt` |
| Ausgewählte Unit-Tests | 7 Dateien, 35 PASS | `unit.txt` |
| Bestehende Browserauswahl | 39 PASS, 1 Fokus-Fehler beim Ausrichtungswechsel | `browser.txt` |
| Derselbe Ausrichtungsfall, unverändert einzeln | 1 PASS | `orientation-rerun.txt` |
| Zwei originale R70-Browserproben (Frame, verspätetes GET) | 2 PASS | `r70-browser-rerun.txt` |
| Settings/Referenzdialog und schmale 6-Achs-Seitentabs | 3 PASS | `layout.txt` |
| Drei originale R70-Backend-Proben (Fehlerstatus, Konfliktantwort, Symlink) | 3 PASS | `r70-rerun.txt`, `r70-rerun.jsonl` |
| Originale native INI-Probe | PASS, Drift jetzt erkannt | `ini-probe.txt` |
| Zwei neue Gegenproben für nicht reguläre Dateien | 2 erwartete FAIL, ein zusammengehöriger Restbefund | `counterprobes-final.txt`, `counterprobes.jsonl` |
| Zwei native RCS-Kanalobjekte am privaten lokalen Speicherpuffer | PASS: A/B/A bekommen 1/2/3 | `nml-probe.txt` |

Die 40 Browserfälle werden nicht als ein vollständig grüner Lauf ausgegeben.
Der eine Fehler war fehlender Fokus auf Park nach dem Ausrichtungswechsel; der
unveränderte Einzeltest bestand. Ursache nicht isoliert, kein Nachweis einer
neuen Regression in R71 (die betreffende Fokus-/Layoutimplementierung blieb
unverändert). Fehlertext mit Assertion und Call-Log: `browser.txt`. Auch Claudes separat
benannte Schwankung in `choices.spec` wurde damit nicht geklärt.

Die fünf neuen `CancelledWrites`-Fälle im bestehenden Gateway-Test halten
replace/link/unlink/Rollback jeweils an, canceln zweimal und prüfen konkurrierende
Starts/Schreiber; alle grün. Die zwei alten R70-Cancellation-Proben warten explizit
auf die inzwischen korrigierte vorzeitige Lock-Freigabe und sind deshalb keine
unverändert grün werdenden Regressionsfälle. Die übrigen drei alten Backend-Proben
wurden in einer Kopie unverändert ausgeführt (nur Ausgabename auf R71 gesetzt).
Die alte Browserprobe, die ein Keep-editing-Angebot bei fehlender Revision
voraussetzt, ist ebenfalls bewusst ersetzt: der neue bestehende Browsertest prüft
jetzt busy, alte unvollständige Antwort, echten Konflikt und die vier gesendeten
Basisrevisionen. Er ist grün.

## Wiederholung in einer Archivkopie

Node-Abhängigkeiten stammen aus dem vorhandenen `node_modules`-Link; TS-Cachepfade
in den Archiv-tsconfigs wurden von `./node_modules/.tmp/` auf `../r71-ts-cache/`
umgestellt. Vitest nutzt `../r71-vitest-cache`. Produktquellen unverändert.
`e2e/ctl.ts` im Archiv nutzt `http://127.0.0.1:4188` statt localhost:4174.

Beiliegende Konfigurationen als `r71.playwright.config.ts`, `r71.probes.config.ts`,
`r71.layout.config.ts`, `r71.vitest.config.ts` ins archivierte `lcnc-webui/` kopieren.
`r70-browser-probe.spec.ts` heißt dort `e2e/r71.r70.spec.ts`; die beiden Python-
Testdateien heißen im archivierten Gateway `test_r71_r70.py` und `test_r71_review.py`.
Ausgabeordner `evidence/` neben `lcnc-gateway/` und `lcnc-webui/` anlegen.

```sh
# lcnc-gateway, Python mit den Testabhängigkeiten; Tests installieren fake_linuxcnc zuerst
PYTHONDONTWRITEBYTECODE=1 GIT_DIR=/home/cnc/lcnc-suite/.git GIT_WORK_TREE=/tmp/codex-r71-x9s3njg3/archive GIT_OPTIONAL_LOCKS=0 python -m pytest -q -p no:cacheprovider test_macro_files.py test_macros_gateway.py test_config_sync_check.py test_example_install.py
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider test_g30.py
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider test_r71_r70.py -k 'rcs_error or save_conflict or macro_get'
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider test_r71_review.py

# lcnc-webui, nach VITE_GATEWAY_PORT=4188 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r71.vitest.config.ts
nice -n 19 node node_modules/@playwright/test/cli.js test --config r71.playwright.config.ts --grep 'macros.spec.ts|editor-guards.spec.ts|macro bar is one row|orientation change mid-hold|tab semantics|hidden panel|Abort ends the machine actions'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r71.playwright.config.ts --grep 'orientation change mid-hold'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r71.probes.config.ts --grep 'FRAME machine|catalog update'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r71.layout.config.ts --grep 'dialog 2 Settings:|dialog 9 G-code Reference:|6axis-twp touch-portrait: side panel tabs'
```

Der erste Aufruf der neuen Backend-Probe hatte einen falschen relativen Zielpfad;
pytest fand die Datei nicht. Das war ein Aufbaufehler (`counterprobes.txt`). Nach
Ablage am richtigen Ort stehen die zwei tatsächlichen roten Ergebnisse separat
in `counterprobes-final.txt`. Die FIFO-Probe entsperrt ihren eigenen Reader durch
Öffnen des zugehörigen temporären Schreibendes; kein Thread bleibt zurück.

## Native NML-Probe (keine Steuerungsverbindung)

`nml-probe.cc` nutzt **ausschließlich** den beigefügten `LOCMEM`-Puffer `r71Only`
im Speicher des Probeprozesses. Keine SHMEM-Ressource, kein TCP, kein emcCommand,
kein LinuxCNC-Status und kein Maschinenbefehl. Zwei `RCS_CMD_CHANNEL`-Objekte mit
verschiedenen Prozessnamen schreiben drei synthetische Nachrichten (Typ 90071),
alle mit vorher eingetragener Nummer 100. Die Bibliothek setzt daraus 1, 2, 3.

```sh
g++ -std=c++17 -I/usr/include/linuxcnc viewer-palette-fest.r71.nml-probe.cc -lnml -o /tmp/r71-nml-probe
/tmp/r71-nml-probe viewer-palette-fest.r71.nml-probe.nml
```

Installierte Bibliothek: LinuxCNC `1:2.9.4-2+deb13u1`; Paketversion, Bibliothekshash
und gelesene Disassembly-Ausschnitte in `nml-evidence.json`. Der Rückgabepfad
`RCS_CMD_CHANNEL::write → NML::write(..., &serial_number) → CMS` setzt die Nummer
aus dem Pufferzähler. Das widerspricht der R71-Annahme separater Nummernräume
je `linuxcnc.command()`-/RCS-Kanal. Die Aussage gilt für diesen normalen
Bibliotheksweg am selben Puffer, nicht für selbst geschriebene Fremdtransporte.

Task-/Interpreterquellen weiterhin aus der vorhandenen lokalen 2.9.4-Quellkopie
in Claudes scratchpad gelesen, u.a. `emctaskmain.cc`, `emcmodule.cc`,
`rs274ngc_pre.cc`, `interp_remap.cc`. Raw-Webabrufe des Tags scheiterten erneut
mit Cache miss. Die offiziellen INI-Regeln wurden ergänzend geprüft:
[LinuxCNC INI-Konfiguration](https://linuxcnc.org/docs/stable/html/config/ini-config.html).
Die native INI-Gegenprobe ist dieselbe aus R70; sie verwendet nur temporäre Dateien.

Kein vollständiger eigener Offline-Gate-Lauf und keine eigene Live-Abnahme.
