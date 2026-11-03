# R257 · Codex · Prüfprotokoll

Geprüft `08fb69d9..53610c4b`, Live-HEAD zu Beginn `850b8b1d`. Eigene Git-Kopie `/tmp/codex-r257-gw75svhn/repo`, abgekoppelt auf `53610c4b`; gemeinsamer Git-Objektspeicher nur lesend. node_modules aus der R256-Kopie nach bytegleichem package-lock kopiert. Keine Builds/Tests/Checkouts im Live-Baum, keine Verbindung zur LAN-Sim, keine Maschinenbefehle.

## Wiederholung

Eigene Git-Kopie mit Historie auf `53610c4b` unter `/tmp/R257/repo` und passende node_modules bereitstellen. Die beiden Skripte ändern ausschließlich diese Wegwerfkopie bzw. Dateien unter `/tmp/R257`; die Quelländerungen werden in `finally` zurückgenommen:

```sh
python test-strategy.r257.probes.py /tmp/R257 /home/cnc/lcnc-suite
python test-strategy.r257.retry-probe.py /tmp/R257
```

Das erste Skript liest zusätzlich die vorhandenen R256-Review-Berichte und Claudes Rohberichte unter `/home/cnc/lcnc-suite-tiers/docs/reviews/test-tiers.round2.gate-round.logs/`. Deren Hashes sind in den Ergebnissen festgehalten. Es führt für den Verdrahtungsnachweis die echten Auswahl-Wächter aus; deren Socket-Test braucht die Erlaubnis für einen eigenen kurzlebigen Loopback-Socket auf zufälligem Port. Es startet keinen Browser oder Mock-Server und spricht keine bekannten Produktports an.

## Prüfung

- Auswahl-Wächter: 38/38 grün. Erster Lauf innerhalb der Sandbox: 37 grün, ausschließlich der Socket-Test mit EPERM gescheitert. Genehmigte Wiederholung vollständig grün.
- Build PASS. Keine Produktänderung dieser Runde und keine Wiederholung des vollständigen Browserlaufs.
- Die vorhandene transitive macroFolder-/Daten-Kette wählt jetzt jeweils 24 Specs, darunter probe-click. Alte R256-Lese-Gegenproben mit eigener zusätzlicher Zeile werden abgewiesen.
- Neue Varianten derselben Lese-Gegenprobe: zweiter Aufruf auf der bereits deklarierten Zeile sowie Zeilenumbruch zwischen Funktionsname und öffnender Klammer. Beide bleiben unbemerkt. Ziel ist in beiden Fällen macro_refusals.json; eine Datenänderung wählt freecad-import weiterhin nicht. Kein G-Code-/Maschinenlauf nötig.
- Echter `round_gate.main` mit vorübergehender nicht gedeckter UI-Importbeziehung: Auswahl-Wächter rot, FAIL-Record, `selector.select` nie erreicht. Nach Wiederherstellung 38/38 grün. Die FAIL-Ausgabe ist der erwartete Gegenbeweis.
- Unveränderte R256-Discovery und deren realer test.only-Bericht: `check_executed` nennt nun genau fünf fehlende Tests.
- Claudes Rohberichte unabhängig neu ausgewertet: 836 Browsertests vollständig und genau einmal in der geforderten Reihenfolge; 2573 gelistete Unit-Tests vollständig. Im vorgelegten Unit-Bericht sind keine failureMessages enthalten. Kein eigener erneuter 54-Minuten-Lauf behauptet.
- Neuer realer Vitest-Gegenfall über `round_gate.unit`: Ein Test mit `retry: 1` scheitert beim ersten Versuch und besteht beim zweiten. stdout zeigt beide Versuche. JSON enthält einen passed-Eintrag mit der ersten Assertion in failureMessages. Der Gate-Helfer meldet dennoch PASS mit 1 gelistet/1 bestanden, ohne Retry-Angabe.
- Die Konfigurationen FULL/selektiv setzen beide forbidOnly und reuseExistingServer:false; die tatsächliche FULL-Verdrahtung und Port-Vorprüfung wurden gelesen. Kein fremder Server gestartet.

Am Ende ist die Prüfkopie einschließlich ungetrackter Quellen sauber; keine Produktänderung. Die Belege unterscheiden bestandene Produkt-/Werkzeugtests, erwartete rote Gegenfälle und falsch grüne Auswertungen ausdrücklich.
