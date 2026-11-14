# R369 · Codex · Prüfnachweis

Anfrage `13244d3d`, geprüfter Integrationskopf `39e5ccd1`, Differenz zu `d1e2c2e9`. Frische Archivkopie `/tmp/codex-r369`. Die Differenz besteht genau aus `scripts/test_support/live_target.py`, dessen Tests in `scripts/test_native_stage.py` und einer Dokumentationszeile. Gateway, Client, Subroutinen und Beispiele sind unverändert. [Dateiliste, Hashes und Zähler](vor-maschine.p3a.r369.codex-checks.json).

## Eigene Ausführung

**9/9 PASS:** Die drei Fälle der unveränderten [R368-Sonde](vor-maschine.p3a.r368.codex-listeners.py) sowie sechs Repository-Tests für Home-Gruppen-Fixture, Gateway-Ziel, unbekannten Listener und den Treibereintritt. Venv `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv`, Arbeitsverzeichnis `/tmp/codex-r369`:

```text
LCNC_HEAVY_LOCK=/tmp/codex-r369-heavy.lock python3 -m pytest -q scripts/test_r368_target_codex.py scripts/test_native_stage.py -k 'home_group_fixture or gateway_on_the_port or home_step_driver or listener' --junitxml=/tmp/r369-target.xml
```

[Ausgabe](vor-maschine.p3a.r369.codex-tests.txt), [JUnit](vor-maschine.p3a.r369.codex-tests.xml), [R368-Sonde am neuen Kopf](vor-maschine.p3a.r369.codex-listeners-after.json). Die ursprüngliche Sonde legt ihr Ergebnis weiterhin unter `/tmp/r368-listeners.json` ab; die hier verlinkte Kopie stammt ausdrücklich vom R369-Lauf. Ihr Feldname `pids` ist unverändert, enthält jetzt aber die neue Rückgabeform mit einzelnen Listener-Zeilen.

Die unbekannte Zeile bleibt mit leerer PID-Liste erhalten. `gateway_target_problems` nennt sie als `unidentified`; der bekannte Prozess auf einer anderen Adresse kann sie nicht überdecken. Der Repository-Wächter prüft beide Zeilenreihenfolgen. Ein identifiziertes Gateway allein bleibt zugelassen, unbekannt/fehlend/falsche INI bleibt abgelehnt. Die Verwendung der Helfer wurde nachgesucht: Außer den Tests ruft sie nur `home_step_live_check.py` auf.

## Einordnung

Die 929 Backend-Tests aus R368 werden hier nicht erneut gezählt oder wiederholt: Die betreffenden Produktdateien sind unverändert. Ihre Ergebnisse und die in R367/R368 geschlossenen VM-I11-/VM-I12-Punkte bleiben Grundlage des Gesamturteils zu Paket 3a. Die geänderten Dateien der Archivkopie entsprechen dem Commit bytegleich; nur die unveränderte Sonde wurde als zusätzliche Testdatei eingebracht.

Gelesene Fremdbelege: Round-Gate mit `head=39e5ccd1` und `verdict=PASS`, Rotnachweis am Vorgänger sowie Home/Step-Lauf auf 3/5/6 Achsen und Gruppen-Fixture mit Rückgabe der LAN-Sim. CI wurde nicht unabhängig abgefragt; die Anfrage nennt den Lauf noch als laufend. Kein eigener Browser-, Voll-Gate- oder Live-Lauf, keine Maschinenbefehle. Im Live-Baum nur dieser Review-Anhang und neue Belege. Andere, im Gesamtplan getrennt geführte Prüfpakete werden durch das Paket-3a-Agreement nicht geschlossen.
