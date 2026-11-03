# R260 — eigene Nachprüfung

Stand `0e5f30b1..f1ba6eb0`. Isolierte Kopie `/tmp/codex-r260-q257ker8/repo`; Node-Abhängigkeiten bei bytegleichem Lockfile aus der vorherigen Prüfkopie übernommen. Kein Produktcode geändert.

- 39 Auswahltests bestanden. Anfangs nur der Socket-Test durch die Sandbox blockiert, danach genehmigte Wiederholung vollständig grün.
- Die vier R259-Eingaben beibehalten: benannter Default-/promises-Import jetzt je ein erkannter Leseaufruf; Entnahme und Destrukturierung von fs.promises jetzt je eine Verweigerung. Alle vier Ergänzungen am tatsächlichen Spec werden durch reads.problems beanstandet.
- Zwei Fälle zusätzlich durch den echten Auswahl-Wächter ausgeführt: rot durch die erwartete Assertion, nicht durch einen Ausführungsfehler. Sauberer Baum davor und danach grün.
- Fünf ältere R257/R258-Eingaben weiter erkannt. 13 eigene Syntax-/Einteilungskontrollen prüfen verschachtelte Namensräume, Namespace-Entnahme, Elementzugriff, unbekannte Exports/Member, Schreibzugriffe/Konstanten, Lesealias, Alias-Entnahme, Kommentare/Strings, copyFileSync, spawnSync, dynamischen IO-Import und Re-Export.
- Auswahl für den tatsächlichen Diff: Backend, kein Browser, keine schwere Unit-Gruppe. Claudes Round-5-Rohberichte unabhängig geprüft: 2573 gelistet = 2573 vorhanden, alle passed, keine Retry-Fehlermeldungen. Hashes in results.json. Drei Minuten sind Claudes Messung, kein eigener vollständiger Gate-Neulauf.
- Keine Builds/Tests im Live-Baum, keine Produkt-Browserprüfung, keine Server gestartet, keine Sim-Zugriffe. Temporäre Gegenproben vollständig zurückgenommen; Prüfkopie sauber.

Reproduktion: isolierte Kopie von `f1ba6eb0` mit Node-Abhängigkeiten unter `TMP_WORK/repo`; `python3 test-strategy.r260.probes.py TMP_WORK`. Die Sonde schreibt nur dort und liest die benannten vorhandenen Round-5-Berichte.
