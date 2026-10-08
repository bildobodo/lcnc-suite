# R103 · Codex · Planprüfung Fassung 2

Stand `b9b26a61`, Planänderung `4d8faefd..e897dfc9`, danach nur Anfrage. Geprüft gegen VP102-01 bis -05. Keine M600-Umsetzung vorhanden; kein Produktcode geändert. Kein Build, Browserlauf, vollständiges Test-Gate oder Zugriff auf die Live-Suite nötig oder durchgeführt.

## Gegenproben

`codex-probes.py` läuft in der Archivkopie unter `/tmp`, niedrig priorisiert. Es liest die bestehende `_apply_probe_vars`-Funktion per AST unverändert aus `gateway.py` und führt nur diese Funktion mit vollständig ersetzten Abhängigkeiten aus. Dateispeicherung und Interpreter sind Python-Dictionaries, Befehlsaufrufe sind asynchrone Fakes. Das ist ein Nachweis des bestehenden Kontrollflusses unter einem zulässigen Fehler-/Abbruchverlauf, kein Test einer künftigen Basis-Buchführung und kein Maschinenzugriff.

Zwei Fälle: erster MDI-Chunk erfolgreich, zweiter mit `RCS_ERROR` beziehungsweise `CancelledError`. Der erste Teil ist bereits übernommen, während die gesamte Operation `mdi_set=false` meldet oder abbricht. Vorher #3004=200; nachher #3004=300. #3115 bleibt im Interpreter 0, während die Dateikopie bereits den neuen Wert 3 hat. Weder vorheriger Gesamtsatz noch neue Datei beschreiben jetzt den vollständigen Interpreterstand. Die unvollständige Übernahme muss bei der geplanten Buchführung als solche modelliert werden.

Drei weitere Fälle verwenden den vorhandenen **nativen Offline-Parser**, `native_start_probe.py`, mit zusätzlichen CASES. `linuxcnc.stat()` ist synthetisch; `linuxcnc.command()` wirft. Jede Ausführung hat eigene temporäre INI-, Var- und Werkzeugtabellendateien und einen eigenen Prozess. Vorhandene Python-Umgebung nur als Abhängigkeit, Code ausschließlich aus dem Archiv. Die Fälle sind eine kleine wörtliche Expansion der geplanten Ersatzbewegungen, keine implementierte M600-Routine und keine Live-Messung.

- Ersatzfahrten zum angenommenen Auslösepunkt Z−90, Rückzüge, G43, danach Verzweigung auf #5070 und Y aus #5063: X−100 / Y0. Der Fehlerzweig wird genommen.
- Dasselbe nach einer früheren Offline-G38.3 bis Z−15: X−100 / Y−15. Das alte Ergebnis bleibt stehen.
- Kontrolle: Nach den Ersatzfahrten ausdrücklich #5063=−90 und #5070=1 setzen: X+100 / Y−90. Der Erfolgszweig wird genommen. Diese zwei Zuweisungen sind ein Ursachenbeleg, keine vollständige Umsetzung des benötigten #5061–#5069-Vertrags.

Alle fünf Beobachtungserwartungen bestehen. `native-cases.json`, `native.patch`, `native.json` und `basis.json` halten Eingaben, Extraktionshash und Ergebnisse fest.

## Wiederholung

Archiv von `b9b26a61` mit mindestens `lcnc-gateway/`, dazu Belegskript in `archive/evidence/`. Nur unter `/tmp` ausführen:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python evidence/viewer-palette-fest.r103.codex-probes.py
```

Das Skript schreibt eigene Ergebnisse in den Belegordner der Archivkopie und entfernt die temporäre native Sondendatei wieder. Es verändert keine Produktdatei. Vorhandene Review-Belege nie als Ausgabepfad verwenden.

## Planbefunde ohne Ausführung

Die Zusage „bis zum Ende des Tastsegments bekannt“ in Planzeile 66 und die Zustandstabelle „ab der Probe nichts“ in Zeile 75 widersprechen sich. Bei unbekannter physischer Länge kann ein Kontakt vor dem programmierten Endpunkt liegen. Der volle Suchweg kann als mögliche Hülle gezeigt werden, aber nicht als bestimmter gefahrener Weg mit bestimmter Dauer und bestätigten Kontakten. Dies ist eine Folgerung aus den zwei Planregeln und der G38-Semantik, keine Behauptung über eine schon gebaute UI.

Die bekannten Regeln über M6/TOOL_CHANGE_POSITION bleiben auch im neuen Plan nötig: G53 stellt die betroffenen Endkoordinaten wieder her, beweist aber den unbekannten Anfang der ersten Bewegung nicht nachträglich. Das ist ein Umsetzungshinweis zur Lesart der Tabelle, kein neu geöffneter Produktbefund.

Quelle für die Probe-Ergebnissemantik: [LinuxCNC 2.9, G38](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38), geprüft am 8. Oktober 2026. Erfolgreiches Tasten setzt #5061–#5069 auf die Kontaktkoordinaten im damaligen Arbeitsrahmen und #5070 auf Erfolg. G53/G43 ersetzen diese Ergebnisfortschreibung nicht.

## Isolation

Siehe `context.json`: Archivdateien gegen Git/LFS geprüft, Branchbereich enthält nur die beiden Markdown-Dateien. Vorherige R102-Belege gegen ihr Hashmanifest unverändert. Neue Dateien ausschließlich unter `docs/reviews/viewer-palette-fest.r103.codex-*`; Review nur ergänzt.
