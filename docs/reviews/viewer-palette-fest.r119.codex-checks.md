# R119 · Codex · Prüfaufbau

Stand `3c4783c003592d8a84d6f698b77cb3697215a0ac`, Basis `f28ad2f1`, 10. Oktober 2026. Isoliertes `git archive` unter `/tmp/codex-r119-az6f1cgx`. Im Live-Checkout nur Review-Anhang und neue Belege; bestehende Belege unverändert. Keine Live-Ports, keine Maschinenbefehle oder HAL-Ladevorgänge.

## Ergebnisse

- 75 Backend-Repositorytests PASS (8,956 s), fünf neue Skript-Repositorytests PASS.
- Die R118-Abbruchprobe mit geänderter Erwartung bestätigt: kein Befehl, keine Bestätigung in AUTO.
- Vier native Werkzeugfälle ohne Parsefehler oder SKIP: geladenes T7 im Zufallswechsler, Tausch P2, Nicht-Zufallswechsler entladen, unsortierte Tabelle. Frischer Prozess je Fall, Repository-Interpreterhelfer unverändert.
- Acht Zielprüfungen: drei originale Profile akzeptiert; andere aktive INI, fremder Profilname und anderer HAL-Dateiname abgelehnt. Zwei Restfehler reproduziert: abweichender HAL-Inhalt bei gleichem Namen und zusätzlicher HALCMD akzeptiert.

## Wiederholen

Die neuen Dateien `viewer-palette-fest.r119.codex-*` in eine Archivkopie dieses Commits nach `evidence/` kopieren, dabei das Präfix entfernen. Python ist die vorhandene Gateway-Umgebung (hier `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python`); nur ihre Abhängigkeiten werden verwendet, ausgeführt wird der Code der Kopie. Vom Archivwurzelverzeichnis, mit `PYTHONPATH` auf `ARCHIV/lcnc-gateway:ARCHIV/evidence` und `PYTHONPYCACHEPREFIX` auf ein Verzeichnis in der Kopie:

```bash
python evidence/backend_runner.py test_g30 test_toolsetter_basis \
  test_gateway_util.TestTloEvents \
  test_tool_change_motion_worker.TestToolNumberIsTheRowsId \
  test_tool_change_motion_worker.TestRandomToolchangerAndUnload \
  test_m600_preview_worker.TestPredictedMeasurement.test_the_measured_tool_is_named_by_its_number_not_its_row \
  test_suite_runner
python -m pytest -q -p no:cacheprovider scripts/test_toolsetter_readback_check.py
python evidence/backend-probe.py evidence/auto-read-race.json
python evidence/target-probe.py evidence/target-probe.json
python evidence/native-runner.py
```

Die Läufe wurden mit `nice -n 19` ausgeführt. `backend_runner.py` ist der bereits dokumentierte R118-Runner mit Selector-Weckruf alle 20 ms, ohne ersetzte Produktfunktionen oder Assertions. Der Argumentparser-Fehler im Backend-Protokoll ist die erwartete Ausgabe eines grünen Tests zur Ablehnung nicht freigegebener Live-Bewegung.

## Sonden und Grenzen

`backend-probe.py` übernimmt die R118-Verschränkung (Status IDLE, READING bei Annahme eines etwaigen AUTO-Modusbefehls) und passt nur die erwartete Antwort an. Der Modus-Hook wird nun gar nicht mehr aufgerufen. Es läuft der echte Gateway-Dispatch gegen den Repository-Task-Doppelgänger; kein nativer Task-Abbruch wird provoziert.

`native-runner.py` ruft den unveränderten `native_start_probe.py` mit vier Repository-Fällen auf. `m6_random_loaded` entspricht dem R118-Programm und der damaligen Tabellenbelegung. Die Zufalls-Konfiguration liegt jetzt bereits im Repository-Helfer; die frühere Textinjektion ist deshalb nicht mehr nötig. Der Helfer verwendet synthetischen Status, private temporäre INI/Parameter-/Werkzeugdateien und Werkzeugablage; `linuxcnc.command` ist verboten. `native-results.json` enthält die kompletten ausgewählten Payloadfelder des Helfers. Dies ist kein Live-Wechslernachweis.

`target-probe.py` importiert den neuen Validator mit `fake_linuxcnc`. Jede INI und jede veränderte HAL-Datei liegt in einem temporären Verzeichnis; die angegebene aktive INI ist ein kontrollierter Eingabewert. Es wird nur `validate_sim_target` aufgerufen, nie `Gateway` oder `main`; kein HAL-Text wird ausgeführt. Die Gegenproben belegen die Zulassungsentscheidung, nicht den Betrieb einer echten Maschine. Die unveränderten fünf Repository-Skripttests prüfen ebenfalls nur Validator und PID-Auswahl.

`sources.json` vergleicht die Produkt-/Testdateien der Archivkopie mit den Git-Objekten des Review-Stands. `context.json` hält den vorherigen Review-Hash und den sauberen Arbeitsbaum fest; `sha256.json` umfasst die veröffentlichten Belege außer sich selbst.

Claudes Backend-Gesamtgate, Mutationen und Live-Protokoll gelesen, nicht vollständig wiederholt. Keine Frontend-Änderung in dieser Runde, daher keine Browser- oder Build-Wiederholung. Keine Aussagen über eine vollständige geometrische M600-Parität oder die offenen Lastnachweise.
