# R61 — Reproduktion und Prüfgrenzen (Codex, 2026-10-01)

Geprüfter Stand: `9edcc9b0e3c6177e72125d2fc5858dfce20e909e`, Basis `557f8b8`.
Eigene Archivkopie: `/tmp/codex-r61-il3mu84q`. Ein Mock auf `127.0.0.1:4188`,
Chromium, ein Worker, Prozesse mit `nice -n 19`; keine Live-Ports, keine
Maschinenbefehle. Der ausführbare Review-Stand liegt im Worktree
`/home/cnc/lcnc-suite-partb` auf `wip/part-b`. Der Live-Checkout auf
`feat/keypad-keys` enthält die ganze R61-Übergabe noch nicht.

## Archiv und Konfiguration

Eine frische Archivkopie von `git archive 9edcc9b` erstellen, darin
`lcnc-webui/node_modules` mit den vorhandenen Dependencies verknüpfen.
Bei dieser Verknüpfung die `tsBuildInfoFile`-Pfade der drei `tsconfig*.json`
in der KOPIE auf `../r61-ts-cache/` umleiten: kein Schreiben durch den
Symlink in die gemeinsamen Dependencies. Die beiliegenden Configs heißen
in der Kopie `lcnc-webui/r61.playwright.config.ts` und
`lcnc-webui/r61.vitest.config.ts`; die Sonde nach `lcnc-webui/e2e/r61.spec.ts`
kopieren. `evidence/` neben `lcnc-webui/` anlegen. In der kopierten
`e2e/ctl.ts` beide `localhost:4174` durch `127.0.0.1:4188` ersetzen.

Build im kopierten `lcnc-webui`:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
nice -n 19 node node_modules/vitest/vitest.mjs run --config r61.vitest.config.ts
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
```

Der Mock serviert den Archiv-Build. Im zweiten Terminal, ebenfalls dort:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r61.playwright.config.ts --grep 'live look 2026-10-01|operator 2026-10-01|the program name and the rows|Settings: as wide|discard: clean|the viewer palette:'
nice -n 19 node node_modules/@playwright/test/cli.js test --config r61.playwright.config.ts --grep R61
```

Die neun vorhandenen Tests sind grün. `r61.browser.txt` enthält den ersten
Sammellauf mit einer zusätzlich roten Vorversion der eigenen Sonde. Deren
Layer-Abfrage war noch nicht gegen den Empfang der Settings-Nachricht und
einen zuvor abgearbeiteten Status synchronisiert; das Ergebnis wechselte
mit dem Timing. Die finale `r61.probe.spec.ts` wartet auf die empfangenen
Frames und misst zwei Aus-/Ein-Schaltfolgen jeweils vor und nach einem
neuen Status. `r61.probe.txt` gehört ausschließlich dieser finalen Sonde.
Ein zwischenzeitlicher Start scheiterte vor der ersten Aktion, weil der eigene
Mock inzwischen beendet war (`r61.probe-infrastructure.txt`, ECONNREFUSED).
Für den finalen Lauf wurden Mock und Sonde in einem gemeinsamen Prozessablauf
mit einer Cleanup-Trap gestartet. Das ist keine Produktfehlermeldung.
Sie speichert ihre JSON-Beobachtungen und Bilder VOR den Soll-Assertions:
auf dem Review-Stand scheitern die zwei falschen G43-Texte (VP-I25) und der
noch sichtbare Marker nach Layer-Aus (VP-I26). Kein grünes Produkturteil
wird aus einem erfolgreichen Messlauf abgeleitet.

Die `quiet`-Funktion unterdrückt nur die Statusantworten des eigenen Mocks;
Pongs kommen weiter. `tool-state.json` protokolliert bei jedem Layerwechsel
die tatsächlich dazwischen empfangenen Frame-Typen. Kein neuer Status ist
nötig, um einen UI-Ebenenschalter zu bedienen. Im normalen Statusstrom
wird VP-I26 beim nächsten Status korrigiert (P3, kein alleiniger Mergeblocker).
`tool-layout.json` misst die G49-Zeile in vier Layouts; kein horizontaler
Überlauf in diesen Messungen. Es ist keine vollständige Layout-Abnahme.

Backend im kopierten `lcnc-gateway`:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 nice -n 19 python3 -m unittest -v test_start_tlo_worker test_gateway_util.TestPercentDelimiter test_gateway_util.TestCanonInitPhase
```

16 Tests bestanden; native Offline-Parses, keine Verbindung zur laufenden
Steuerung. `schema.py /path/to/repo` vergleicht die fünf JSON-Dateien aus
beiden Git-Ständen rekursiv und verlangt ausschließlich Schema 9 → 10.
Die Datei-Hashes stehen im JSON. Ein erneutes Erzeugen der Live-Goldens,
das vollständige Offline-Gate, die Mac-Messung und das TWP-Live-Gate wurden
nicht selbst ausgeführt. Für den Mac wurde der mitgelieferte Bericht geprüft.

`f22ce68` (Keypad) wurde nur statisch gelesen, nicht in diesen Build
übernommen. Alle Anpassungen für die Sonden erfolgten in der Archivkopie.
