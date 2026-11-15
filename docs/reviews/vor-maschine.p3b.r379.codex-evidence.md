# R379 · Codex · Belege

Prüfstand `cad9ac77`, Nachprüfung seit `0acf2a2b`, Archivkopie `/tmp/codex-r379`. Produktdateien des Gateways unverändert; Änderungen betreffen Treiber, Tests und Doku. Keine Tests oder Builds im ausgelieferten Baum, keine Live-Maschinenbefehle oder Zugriffe auf deren Ports.

## Gezielte Repository-Prüfungen

- **17 Fälle grün:** alle 13 seit R378 neuen/geänderten Testfunktionen in `scripts/test_native_stage.py`, einschließlich Parametrisierungen.
- **7 SimulatorClient-Fälle grün:** Statusaufnahme, Fehler-/Envelope-Historie, tatsächlich empfangene Frames, Settings-Revisionen, Transportfehler, Markierung und unbenannte Quittierungsantwort. Ein Fall überschneidet sich mit der ersten Auswahl; nicht als 24 unabhängige Fälle gezählt.
- [Ausgaben und Auswahl](vor-maschine.p3b.r379.codex-checks.txt).
- Die originale R378-Sonde erneut unverändert: **4 grün, 1 scheitert an der alten Vorbedingung `bad < ack`**. Der während der Auswertung erzeugte Frame liegt jetzt nach der Quittierung, wie von der Korrektur verlangt. Kein verbliebener Gegenfall. [Ausgabe](vor-maschine.p3b.r379.codex-r378-recheck.txt).

## Zusätzliche Verhaltenssonden für die Sperre

[Sonde](vor-maschine.p3b.r379.codex-probe.py), **5 grün**. Sie benutzt die echte `SimulatorClient`-Implementierung, einen Fake-Socket und echte Python-Threads, ohne Netzwerk oder LinuxCNC:

1. Während `request(mark=…)` sendet, versucht ein anderer Thread, einen Status zu verarbeiten. Er erreicht die Sperre, kann aber erst nach dem Senden stempeln und eintragen. Die Endmarke enthält genau die vorherige Anzahl Frames.
2. Ein Frame ist bereits gestempelt, sein Listeneintrag gezielt angehalten. `mark()` wartet, bis dieser Eintrag fertig ist, und zählt ihn mit. Damit ist die von R378 benannte Lücke zwischen Stempel und Eintrag geschlossen.
3. `on_status` und die automatische Werkzeugwechsel-Bestätigung laufen außerhalb der Aufzeichnungssperre.
4. Bereits bekannter Transportverlust erzeugt keine Sendemarke.
5. Ein Fehler beim tatsächlichen Sendeversuch behält dessen Marke; die Sperre wird trotzdem freigegeben.

Aus der Archivkopie ausführen, nachdem die verlinkte Sonde als `r379_probe.py` dorthin kopiert wurde:

```sh
R379_REPO=/tmp/codex-r379 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q /tmp/codex-r379/r379_probe.py
```

**Zwei Gegenmutationen rot, durch Verhaltensassertions:** (1) Marke/Senden ohne Sperre lässt den empfangenen Frame schon während `send` in die Liste; (2) `mark()` ohne Sperre schließt den Abschnitt vor dem angehaltenen Eintrag ab. [Ausgabe](vor-maschine.p3b.r379.codex-mutants.txt), [Skript](vor-maschine.p3b.r379.codex-mutants.py). Nur die Archivkopie wurde temporär geändert und im `finally` wiederhergestellt.

Die lokal installierte Primärquelle `websockets 16.0`, `sync/connection.py:Connection.recv_events`, bestätigt die genannte Reihenfolge: Verarbeitung der Protokollereignisse außerhalb von `protocol_mutex`. Die Prüfung behauptet keine allgemeine Schranke für jeden blockierenden Netzwerkversand.

## Gespeicherte native Läufe

Alle sechs R379-Laufordner unter `~/claude-work/live-tier/` nur gelesen, jeweils `report.json` und `state.json`: Commit `cad9ac77`, gemeldetes PASS, `crashes: []`, Rückgabe `complete`. Die gespeicherten Frame-Herkünfte sind gültig; TRUE-Frames und nachweislich neue Frames zeigen den Trip. Aus erster neuer Veröffentlichung/Empfang und gespeicherter SIGCONT-Klammer nachgerechnet: Hauptläufe 0,0345–0,0359 s, verzögerte Läufe 0,2007–0,2033 s. Die gerundeten Empfangsstempel stimmen innerhalb 2 µs mit den Berichtsgrenzen überein.

[Nachrechnung je Lauf](vor-maschine.p3b.r379.codex-live-check.txt). Die informativen `jog-*`-Zeilen sind weiterhin `incomplete`; die zugehörigen Servo-Zeilen tragen die Bewegungsabnahme. Kein neuer Live-Lauf. Den vollständigen Round-Gate-Bericht an `cad9ac77` mit `uncommitted: 0` und PASS gelesen, aber das vollständige Gate und CI nicht selbst wiederholt. Die Installationsprobe bleibt dem Merge-Gate vorbehalten.
