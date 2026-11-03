# R256 · Codex · Prüfprotokoll

Stand `08fb69d9` gegen `4ad87515`. Eigene lokale Git-Kopie unter `/tmp/codex-r256-pus6kuln/repo`, abgekoppelt auf dem Zielcommit; nur der Objektspeicher wurde lesend geteilt. Abhängigkeiten aus der R254-Prüfkopie nach bytegleichem `package-lock.json` kopiert. Live-HEAD zu Beginn `c27a5f87`; keine Builds/Tests/Checkouts dort, keine Maschinenbefehle, keine Verbindung zur LAN-Sim und kein Mock-Server gestartet.

## Eigene Prüfung

- `pytest scripts/test_select/test_selector.py lcnc-gateway/test_command_policy.py`: 28 Auswahl- und 136 Policy-Tests grün; JUnit zählt zusätzlich drei Subtests, insgesamt 167.
- `vitest run src/commandShapes.test.ts src/probeVarFiles.test.ts`: 12/12 grün. Der erste Lauf scheiterte am Sandbox-EPERM des rein lesenden Python-Unterprozesses; genehmigte Wiederholung grün, Produkt unverändert.
- `npm run build`: PASS.
- Playwright `--list` am vollständigen und selektiven Projekt: 836 beziehungsweise 251 Tests; keine Discovery-Fehler, Dateiprojekt-Abgleich grün. Der erste vollständige Listenaufruf traf dasselbe Sandbox-EPERM; genehmigt wiederholt. Listen brauchen weder Browser noch Server.
- Eigene Gegenproben siehe `test-strategy.r256.probes.py`: echte Auswahlfunktionen mit gezielt eingespeisten Einzelpfad-Diffs, vorhandene transitive Fixture-Kette, echte Dateilesungs-/Graph-Wächter mit vorübergehender Änderung nur der Kopie, reine Ergebnisprüfer mit unvollständigem Bericht. Die Rückmutationen sind wiederhergestellt. Die Graph-Verdrahtung des Rundengates ist zusätzlich im Quelltext geprüft; kein vollständiger künstlich grüner Gate-Lauf behauptet.
- Reales Playwright-Verhalten für `test.only`: temporär ein fokussierter Sentinel in `probe-click.spec.ts`; Auswahl nur dieser Datei. Beide normalen Discovery-Konfigurationen listen sechs Fälle. Die Ausführung benutzt dieselbe Auswahlkonfiguration mit ausschließlich `webServer: []` überschrieben, weil der Sentinel keine Browser-/Page-Fixture braucht. Tatsächlich läuft nur der Sentinel: 1 PASS, 0 skipped. Die unveränderten drei Auswerter (`check_listing`, `check_order`, `judge`) akzeptieren das. Keine Produkt-Browserprüfung daraus behauptet.
- Volle Playwright-Konfiguration ohne CI ausgewertet (TypeScript transpileModule, keine Server gestartet): beide webServer haben `reuseExistingServer: true`. Der volle Zweig von round_gate setzt keinen abweichenden Wert.
- Am Ende: `git status --porcelain` der Kopie leer. Produkt-/Teständerungen aus Gegenproben vollständig zurückgenommen.

## Wiederholen

Eine eigene Git-Kopie mit Historie auf `08fb69d9` unter `/tmp/R256/repo` und passende node_modules bereitstellen. Anschließend mit dem Python-Interpreter der Gateway-Testumgebung:

```sh
python test-strategy.r256.probes.py /tmp/R256/repo /tmp/R256/evidence
python test-strategy.r256.only-probe.py /tmp/R256
```

Die zweite Sonde benötigt wie die normale vollständige Playwright-Discovery die Erlaubnis zum rein lesenden Python-Unterprozess eines Specs; sie startet keine Server. Die gespeicherten JSON-Berichte sind original aus der Gegenprobe. `test-strategy.r256.results.json` enthält zusätzlich kompakte vollständige Discovery-Inventare je Datei/Projekt und die Auswahlergebnisse.

Kein vollständiger Gate-Neulauf, keine Wiederholung der bereits in R254 geprüften unveränderten Probe-Klick-Implementierung, keine neue Firefox- oder native Messung. Die vorgelegten 24 Minuten und die historischen Laufzeitschätzungen sind Claudes Belege, keine eigenen Messungen dieser Runde.
