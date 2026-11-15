# R378 · Codex · Belege

Prüfstand `0acf2a2b`, Basis `d7431f19`, Archivkopie `/tmp/codex-r378`. Die Live-Sim blieb unberührt; keine Builds, Tests oder Checkouts im ausgelieferten Baum. Die Differenz `1e19b741..0acf2a2b` enthält nur `test_trip_basis.py` und `docs/decisions.md`, wie in der Anfrage angegeben.

## Repository-Wächter

- **41 Gateway-Fälle grün:** `test_trip_basis.py` und `test_ws_fanout.py`, einschließlich Reader-Unterprozess und vier WS-Versandpfaden. Der erste Lauf in der Socket-Sandbox scheiterte/hängte; abgebrochen und mit lokalen Socket-Rechten, Fake-LinuxCNC und TestClient erneut ausgeführt, Exit 0.
- **40 Treiber-Fälle grün:** alle 24 seit der Basis neuen/geänderten Testfunktionen aus `test_native_stage.py`, mit Parametrisierungen. Die erste engere Auswahl hatte bereits 26 grüne Fälle; diese Zahlen sind keine unabhängigen Summanden.
- [Ausgaben und Auswahl](vor-maschine.p3b.r378.codex-checks.txt).

## Eigene Ablaufsonden

[Ausführbare Sonde](vor-maschine.p3b.r378.codex-probe.py), [Ausgabe](vor-maschine.p3b.r378.codex-probes.txt). Ergebnis: **3 rot, 2 grün** an `0acf2a2b`. Ausschließlich vorhandener `LatchClient`, `FakeMeasurement` und Monkeypatches; kein LinuxCNC, HAL, Signal an echte Prozesse oder Netzwerk.

Aus einer Archivkopie ausführen:

```sh
R378_REPO=/tmp/codex-r378 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -s /tmp/codex-r378/r378_probe.py
```

Die verlinkte Sonde dazu als `/tmp/codex-r378/r378_probe.py` ablegen.

1. **Vor-Quittierungsbereich:** Während der Auswertung der bereits ausgeschnittenen Liste kommt ein gültiger TRUE/kein-Trip-Frame an, danach wieder einer mit Trip; beide vor dem protokollierten Quittierungsaufruf. Ergebnis trotzdem `PASS`; der Gegenframe fehlt im Bericht. Seine Herkunft wird separat als gültig geprüft. Der unveränderte reine Auswerter erkennt denselben Fehler, wenn der Frame tatsächlich in seiner Eingabeliste steht (grüne Kontrolle).
2. **Fehler am Ende des Servo-Abschnitts:** Die Auslösung wird in gültigen neuen Frames nie gezeigt, zusätzlich meldet der Sampler einen END-Fehler. Der Schritt bricht korrekt ohne Quittierung ab, behält aber nur `latch-same-cycle`; die unabhängige `latch-sticky`-FAIL-Zeile fehlt.
3. **Erster Frame während `cont`:** Ein Frame wird nach der SIGCONT-Klammer, aber vor Rückkehr aus `cont()` verarbeitet (etwa während `save(state)`). Weitere Frames bleiben aus. Der Treiber behauptet „no status frame after …“, sendet kein frühes Reset und endet `incomplete`. Der bereits vorhandene Frame qualifiziert nach dem vereinbarten Auslöser, unabhängig von seinem Trip-Wert.

Die zweite grüne Kontrolle durchläuft den unveränderten nominellen Latch-Schritt mit PASS. Die roten Assertions formulieren das erwartete Verhalten und sind als Korrekturwächter verwendbar.

## Gespeicherte Live-Belege

Die sechs in der Anfrage benannten Laufordner unter `~/claude-work/live-tier/` wurden nur gelesen. Je `report.json` und `state.json`: Commit `1e19b741`, gemeldetes PASS, `crashes: []`, Rückgabe `complete`. Die aufgezeichneten Frame-Herkünfte sind gültig; alle aufgezeichneten TRUE-Frames und alle nachweislich neuen Frames tragen den Trip. Die Verzögerungsgrenzen aus erster neuer Veröffentlichung/Empfang und gespeicherter SIGCONT-Klammer stimmen mit dem Bericht überein: Hauptläufe etwa 35–36 ms, verzögerte Läufe etwa 201–206 ms. Empfangszeiten sind im Bericht auf sechs Dezimalen gerundet; Vergleichstoleranz 2 µs.

[Nachrechnung je Lauf](vor-maschine.p3b.r378.codex-live-check.txt). Das bestätigt die gespeicherten Beobachtungen, ersetzt aber keine Beobachtungen, die der Treiber vorzeitig ausgeschlossen hat. Kein neuer Live-Lauf und keine eigene Wiederholung des vollständigen Gates oder der CI.
