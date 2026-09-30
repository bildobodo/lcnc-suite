# R52 · Reproduktion und Prüfgrenzen

Stand `650b6b625d2379a2ee180b823638efb42a741cb0`, Basis `6efc2b1`.
Archiv: `/tmp/codex-r52-7wfz08ps` via `git archive 650b6b6`.
Live-Checkout: nur Review-Anhang und neue R52-Belege. Keine Zugriffe auf
:5173/:8000, keine Maschinenbefehle oder Quittierungen.
Eigener Mock `127.0.0.1:4188`, ein Browser-Worker, `nice -n 19`.

## Frontend

Die vorhandenen node_modules wurden als Symlink eingebunden. Vite/Vitest
bekamen im Archiv `cacheDir: ".review-cache"`. In den drei tsconfig-Dateien
wurden die Buildinfo-Pfade von `./node_modules/.tmp/` auf
`./.review-tsbuildinfo/` umgestellt. Alle Ausgaben liegen im Archiv.

- Typecheck: `node node_modules/vue-tsc/bin/vue-tsc.js -b`.
  Der erste Versuch mit `-b --tsBuildInfoFile` war ein eigener Aufruffehler
  (TS5094), kein Produktfehler; korrigierter Aufruf separat protokolliert.
- Build: `node node_modules/vite/bin/vite.js build`.
- Units: `node node_modules/vitest/vitest.mjs run src/codeGlide.test.ts
  src/viewerLayerGroups.test.ts src/gcode*.test.ts src/subRows.test.ts`:
  34 Tests in vier Dateien.
- Browser: ctl.ts im Archiv auf `127.0.0.1:4188` umgestellt.
  `viewer-palette-fest.r52.playwright.config.ts` als
  `lcnc-webui/playwright.r52.config.ts` kopieren;
  `python3 evidence/viewer-palette-fest.r52.browser-run.py` starten.
  Originalauswahl: zwei neue Tests aus layout.spec.ts; beide bestanden.
  Settings-Bilder stammen aus diesem Lauf. Der Glide-Test erreichte 60 fps,
  97 % bewegte Frames und 0 % ganze Paketschritte (3 Zeilen je Paket).
- Eigene Gegenprobe: `browser-probe.ts` als `e2e/r52.spec.ts`,
  `probe.config.ts` als `playwright.r52.config.ts` kopieren, Runner erneut
  starten. Für jeden Lauf vorherige Ergebnisdateien separat sichern.
  4.000 Zeilen, von L200 bis L920, 36 Updates um je 20 Zeilen mit 33 ms
  Wartezeit nach jedem Mock-Senden. Die tatsächlichen Zeitabstände stehen
  in den Frame-Aufzeichnungen; kein Anspruch auf exakt 30 Hz.
  `glide-normal.json`: 87/107 untersuchte Frames ohne sichtbare aktive Zeile.
  `glide-reduced.json`: 0/99. Die Gegenprobe prüft am Ende die richtige
  Zeile und erfasst den Fehler während der Bewegung; ihr grüner Teststatus
  ist keine Abnahme der Animation.

## Planexperiment VP-I20

Kein Produktfix. `native-case.py` wird als `lcnc-gateway/r52_native_case.py`
kopiert und wraps nur den Aufruf von `gcode.parse`, um die geplante Initzeile
`G43.1 X0 Y0 Z…` nach Einheit/G90 einzufügen. XYZ-Identitätskinematik,
eigene temporäre INI/Var-Datei/Tabelle, synthetischer STAT;
`linuxcnc.command` wirft. Jeder Fall läuft in einem frischen Prozess, ohne
Vor-Parse. Python-Umgebung: vorhandene Gateway-venv, nur als Interpreter.
`python3 evidence/viewer-palette-fest.r52.native-run.py` führt die Matrix aus.

`native-probe.json` enthält die wirklichen Worker-Ergebnisse und die
nach Fassung 1 berechnete Anzahl Bewegungen vor der ersten Canon-TLO-Zeile.
`plan-summary.json` verdichtet die sieben relevanten Programmpaare
(14 erfolgreiche native Parses). Bares G43/G49 sind positive Kontrollen;
partielles G43.1/additives G43.2 widerlegen die geplante Unabhängigkeitsregel.
Der grenznahe Fall wechselt bei 10 → 10,005 mm von keinem Befund auf
Z50,004 > 50. Die Payload-Hashes schließen nur den temporären Dateinamen aus.

Zwei zusätzliche diagnostische Parses (`param`, #5083) geben in dieser
synthetischen Umgebung jeweils 0 zurück. Daraus wird keine Aussage zur
Offsetabhängigkeit abgeleitet. Der vorausgegangene M6-Versuch endete wie
bereits die H1-Erweiterung in R51 mit SIGSEGV im nativen Modul; die Ursache
wurde nicht aufgeklärt. Er ist im Vorversuchsprotokoll enthalten und wird
weder als R52-Produktbefund noch als bestandener Test ausgegeben.

`client-probe.ts` als `src/r52PlanProbe.test.ts` ausführen:
`node node_modules/vitest/vitest.mjs run src/r52PlanProbe.test.ts`.
Die Sonde verwendet die echten Clientfunktionen `tloForIndex`,
`wcsTerms`, `liftToJoints` und den nativen G53-Zielpunkt: Parsebasis Z10,
Live10/10,005/20 → rekonstruierter Maschinenwert 0/0,005/10 statt stets0.
Sie belegt eine Lücke im geplanten Vertrag, keinen schon eingebauten
VP-I20-Fix. Danach die Sondendatei vor dem Produkt-Typecheck entfernen
(Node-Dateizugriff gehört nicht zum DOM-tsconfig).

## Quellenkontrolle

LinuxCNC 2.9.4, `convert_tool_length_offset`: G43.1 übernimmt vorhandene
Offsets für nicht genannte Achsen, G43.2 addiert zum vorhandenen Zustand.
Die Gegenbeispiele sind zusätzlich nativ belegt.
https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/rs274ngc/interp_convert.cc

Dieselbe Quelle setzt #5403 aus `tool_table[0].offset.tran.z`; dieser Wert
allein beweist keinen angewandten modalen Offset beim Programmstart.
Die aktuelle Dokumentation nennt neuere Parameter für angewandte Offsets;
für den Live-Nachweis auf 2.9.4 stattdessen direkt den tatsächlich
angewandten STAT-Wert mit erfassen und positive/negative Kontrolle nutzen.
Keine eigene Live-Aussage in dieser Runde.

## Grenzen

Kein vollständiges Offline-Gate und keine Backend-Regressionstests neu
gefahren (kein Backend-Produktcode geändert). Die Plan-Sonden ersetzen
keine Implementierungsabnahme. Kein Mac-Benchmark, keine Live-Fahrt.
Alle Testläufe seriell mit niedriger Priorität. Beide eigenen Mock-Läufe
haben ihren Server im finally-Zweig beendet.
