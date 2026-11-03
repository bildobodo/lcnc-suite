# R254 — Codex

Produkt: `bcab7cb7..b9e29335`, eigene Archivkopie `/tmp/codex-r254-xi5hkcf6/repo`. Keine Produktänderung. 1013 Dateien unter Frontend-src, Gateway, Skripten, Beispielen und Subroutinen sind bytegleich zum Commit. Die zehn Routinen mit PF-01 sind außerdem bytegleich zum Basisstand `bcab7cb7`: der Befund ist vorbestehend.

Keine Tests/Builds im Live-Baum oder Claudes Worktree, keine LAN-Sim-Zugriffe, keine Maschinenbefehle. Eigener Mock auf 127.0.0.1:4188 nach den Läufen beendet. Kein vollständiges Gate wiederholt. Ein Aufruf von `rs274 -h` in `/tmp` endete bereits beim Start mit `tool_mmap_creator() lseek fail: Bad file descriptor`; weder Programm noch INI wurden übergeben, keine Wiederholung mit erweiterten Rechten. Deshalb ausdrücklich kein nativer Interpreter-/Bewegungsnachweis. PF-01 ist anhand der tatsächlichen Aufrufe, der Hilfsroutinen und der dokumentierten O-call-Semantik nachgewiesen.

## Positive Prüfungen

- Build PASS; `probeVarFiles.test.ts` + `toolsetterSetup.test.ts` 12/12; `test_example_install.py` 34/34.
- Unveränderter `probe-click.spec.ts` aus **44624f2e / feat/test-tiers**, separat in die Testkopie übernommen: 5/5. Er gehört nicht zum Produkt-Diff dieser Runde; keine Abnahme der übrigen Teststrategie hier.
- Eigene Matrix: alle vier Kalibrierungsbuttons × Avg XY/X Error/Y Error × Auto Zero aus/an = 24 empfangene MDI-Befehle. Tatsächlicher Text, sämtliche 33 Variablen und unabhängig davon #3036, #3030, #3017=123, #3033=40, #3034=50, #3035=60 geprüft. Anfangs fehlte meiner Mehrfachklick-Fixture die Antwort auf MDI; nach dem ersten Befehl blieb die App folgerichtig busy. Der Mock beantwortet nun jeden MDI-Befehl mit dessen req_id, und die Probe wartet auf einen wieder freigegebenen Button. Keine Produktänderung. Erstprotokoll erhalten.
- Diese 24 tatsächlich gesendeten Payloads je Profil durch `command_policy.validate_payload` für MDI und set_probe_vars gegeben: 144 Zulassungen mit #3036; dieselben 144 Ablehnungen nach Entfernen allein dieser Deklaration.
- Installer: In zwei Profilen fehlendes #3036 ergänzt, in einem vorhandenes #3036=2 bewahrt. Bestehende WCS-Zeile und alle anderen Zeilen erhalten, Backup exakt, Sortierung streng aufsteigend/eindeutig, zweiter Lauf unverändert. Temporäre Ziele und gemockte Stillstandsprüfung wie im Repository-Test, keine Installation am Live-System.

## PF-01 — statische Gegenprobe

`traverse-guard.py` findet die direkten Aufrufe der vier XY-Antasthelfer und verfolgt das vierte Argument. Die echten Helfer weisen es `#<probe_traverse_fr>` zu und verwenden dieses in G1-Rückzügen. Für drei unterschiedliche Vorwahlen (#3017=123, 1000, 1500) wird die Argumentweitergabe verglichen. Das ist eine begrenzte Auswertung der tatsächlich vorkommenden einfachen Argumentformen, kein selbstgebauter vollständiger G-Code-Interpreter.

112 Aufrufstellen geprüft, **38 falsch in zehn Dateien**, davon **zehn in den beiden Pocket-Kalibrierungen**. Alle falschen Stellen geben die Konstante `[3017]` weiter. Die rote Assertion und jede konkrete Zeile stehen in `checks.txt` / `results.json`. Der erwartete Exitcode ist derzeit 1; nach sachgerechter Korrektur soll die Probe 0 liefern. Keine Mutation des Produktcodes vorgenommen.

## Wiederholung

Archiv von `b9e29335`, passende Node-Abhängigkeiten (hier Lockfile vor Übernahme bytegleich geprüft), `npm run build`. Browser-Proben nach `lcnc-webui/e2e/`, Config als `lcnc-webui/r254.config.ts`. Ausgabepfade in der eigenen Browserprobe anpassen. In den E2E-Kopien Mock-URLs `localhost:4174` → `127.0.0.1:4188`.

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
```

Aus `lcnc-webui`, seriell:

```sh
./node_modules/.bin/vitest run src/probeVarFiles.test.ts src/toolsetterSetup.test.ts --maxWorkers=1
./node_modules/.bin/playwright test -c r254.config.ts e2e/probe-click.spec.ts e2e/r254.codex.spec.ts
```

Die Browserprobe schreibt `calibration-clicks.json` ins gewählte Ausgabeverzeichnis. Danach:

```sh
python3 installer-policy.py /pfad/zum/archiv-repo /pfad/zum/ausgabeverzeichnis
python3 traverse-guard.py /pfad/zum/archiv-repo /pfad/zum/traverse.json
```

Für `installer-policy.py` die Backend-Testabhängigkeiten bereitstellen; hier wurde ausschließlich der vorhandene Python-Interpreter aus der Live-venv genutzt, Imports und Daten stammen aus dem Archiv beziehungsweise temporären Installationen.

Sprachbelege: [LinuxCNC O-call: Argumente werden #1…#N](https://linuxcnc.org/docs/stable/html/gcode/o-code.html#_subroutines), [Parameterzugriffe benötigen #](https://linuxcnc.org/docs/stable/html/gcode/overview.html#_parameters).
