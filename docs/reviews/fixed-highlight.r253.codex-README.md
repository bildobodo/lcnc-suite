# R253 · FH-07 geschlossen

Stand `64e09b9c`, Diff `a93401fc..64e09b9c`; eigene Archivkopie `/tmp/codex-r253-wcplhf8p/repo`. Keine Produktänderung. Die 411 Dateien unter `lcnc-webui/src` sind nach Abschluss bytegleich zum Git-Archiv. Keine Builds/Tests im Live-Baum oder im Worktree des Implementierers; keine LAN-Sim-Zugriffe oder Maschinenbefehle. Eigener Mock auf `127.0.0.1:4188` nach Abschluss beendet.

## Prüfungen

- Build PASS.
- `src/viewer/toolChangeScan.test.ts`: 8/8 PASS.
- Alte R249-Scannerprobe mit ausschließlich geändertem Ausgabepfad: alle acht Formen nun unbekannt oder mit korrekter Nummer. Resultate vollständig in `results.json`.
- Weitere 42 Scannerprüfungen PASS: einfache Plus-/Dezimal-/Leerraumformen; neue unbekannte Auswahl einschließlich TAN/ATAN/FIX/FUP/SQRT und Parameterindirektion; jeweils T auf derselben und auf eigener Zeile, nachfolgend M600 und M601. Nicht-T-Vorkommen in Funktionen, Operatoren, Namen und Kommentaren bewahren das vorherige T5. Diese Probe prüft die konservative Scannergrenze, nicht die native Zulässigkeit sämtlicher Eingaben (z. B. T-3 ist als Werkzeugnummer unzulässig).
- Drei Browserproben aus R249: 3/3 PASS. Nur Rundennamen/Ausgabepfad und im bisherigen Fehlerfall stärkere Erwartungen geändert: Code-Titel genau T?/T7/T?, Sim-Liste ebenfalls ohne T5, mit T7 und T?. Programmwechsel, Entladen, Neuladen und Vorrang des bestätigten Gateway-T8 grün. Parameter-/O-Namen erzeugen keine zusätzlichen Marken.
- Geänderter Repository-Browserwächter `a code line names its findings …`: 1/1 PASS; T+9 wird T9, TABS[-7] bleibt T?.

## Wiederholung

Git-Archiv des Stands mit passenden Node-Abhängigkeiten, dann `npm run build`. Die Browserprobe nach `lcnc-webui/e2e/r253.codex.spec.ts`, die Config nach `lcnc-webui/r253.config.ts`, die Scannerproben nach `lcnc-webui/` kopieren. Absolute Ausgabepfade an das neue Verzeichnis anpassen. In den E2E-Kopien `localhost:4174` durch `127.0.0.1:4188` ersetzen (auch WebSocket-Kontrollkanal). Die vorhandenen Abhängigkeiten wurden erst nach Bytevergleich der Lockfiles übernommen.

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Die folgenden Läufe seriell in `lcnc-webui`:

```sh
./node_modules/.bin/vitest run src/viewer/toolChangeScan.test.ts --maxWorkers=1
node scanner-probe.mjs
node r253.boundaries.mjs
./node_modules/.bin/playwright test -c r253.config.ts e2e/r253.codex.spec.ts
./node_modules/.bin/playwright test -c r253.config.ts e2e/layout.spec.ts --grep 'a code line names its findings'
```

Kein vollständiges Frontend-Gate erneut ausgeführt; kein nativer Interpreterlauf oder Live-Programmlauf. Der Benutzerwunsch zur Highlight-Füllung und die übrigen bereits geschlossenen Befunde waren unverändert.

## Sprachreferenzen

Leerraum und numerische Schreibweisen gegen die [LinuxCNC-Sprachbeschreibung](https://linuxcnc.org/docs/stable/html/gcode/overview.html) geprüft. Die tatsächliche T-Auswertung steht in [read_t im LinuxCNC-Interpreter](https://github.com/LinuxCNC/linuxcnc/blob/2.9/src/emc/rs274ngc/interp_read.cc#L2787). Die Vorschau bleibt absichtlich konservativer als dieser Interpreter und wertet Funktionen/Parameter nicht aus.
