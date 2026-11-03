# R258 — eigene Nachprüfung

Stand: `53610c4b..32e6ba68`, isolierte Git-Kopie `/tmp/codex-r258-pl6mbzah/repo`. Abhängigkeiten aus der vorherigen Prüfkopie kopiert, nachdem der Lockfile bytegleich geprüft war. Keine Produktänderung; temporäre Gegenproben vollständig zurückgenommen; Prüfkopie danach sauber.

- Auswahltests: 38/38 grün nach genehmigter Wiederholung des eigenen Loopback-Socket-Tests (anfangs Sandbox-EPERM).
- R257: zusätzliche Lesung auf derselben Zeile und Umbruch vor der Klammer jetzt erkannt; Alias-Verwendung abgewiesen.
- Weiter offen: `fs .readFileSync` und `fs.\nreadFileSync` in einer bereits gescannten schweren Datei bleiben ohne Beanstandung; auch zusätzlicher gemischter Default-/Named-Import in einem Browser-Spec bleibt unerkannt. Die Ausdrücke lesen mit Node tatsächlich jeweils 1248 Zeichen aus der vorhandenen Fixture. Beim Umbruchfall bestehen weiterhin alle 37 nicht socketbezogenen Auswahltests.
- Eine Datenänderung an `macro_refusals.json` wählt weder collisionContacts noch freecad-import. Sie erreicht weiterhin die 24 bereits deklarierten Browser-Specs.
- Originale [R257-Retry-Sonde](test-strategy.r257.retry-probe.py) unverändert gegen die neue Kopie ausgeführt: zwei tatsächliche Versuche, endgültiger Vitest-Status passed, aber Gate jetzt korrekt FAIL wegen des vorherigen Fehlversuchs. Kontrolltest ohne Wiederholung: PASS.
- Claudes vorhandene Round-3-Rohberichte unabhängig abgeglichen: 2573 gelistet = 2573 Assertion-Ergebnisse; keine Retry-Fehlermeldungen. Hashes stehen in den Ergebnissen. Die dreiminütige Dauer stammt aus Claudes Messung; kein eigener vollständiger Gate-Neulauf, kein Build nötig für die geprüften Python-Korrekturen.
- Kein Zugriff auf die LAN-Sim; keine Maschinenbefehle oder Browser-Server.

Reproduktion: isolierte Kopie von `32e6ba68` unter `TMP_WORK/repo` mit passenden Node-Abhängigkeiten erstellen; zuerst `python3 test-strategy.r257.retry-probe.py TMP_WORK`, dann `python3 test-strategy.r258.probes.py TMP_WORK`. Nur diese Kopie und TMP_WORK werden beschrieben.
