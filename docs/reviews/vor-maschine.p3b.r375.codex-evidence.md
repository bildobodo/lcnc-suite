# R375 · Codex · Planprüfung und Gegenbeispiele

Planstand: `e62636c6`, Abschnitt „Plananfrage R375“ in `vor-maschine.review.md`. Gelesener Produktstand: `d7431f199a510c662e5363035ea8e15d3656d787`, Archiv `/tmp/codex-r374`. Der Plan enthält noch keine Umsetzung.

Keine Live-Prüfung, keine Signale, keine Verbindung zu Gateway/HAL und keine Produktänderung. Die Sonde verwendet den bestehenden reinen Zustandsautomaten sowie zwei aus dem Quelltext extrahierte Zugriffsmethoden; `gateway.py`, `hal_reader.py` und `HalBridge` werden nicht als laufende Dienste importiert.

## Reproduktion

[Sonde](vor-maschine.p3b.r375.codex-probe.py), [Ergebnis und Quelltext-Prüfsummen](vor-maschine.p3b.r375.codex-probe.json).

```sh
python3 /path/to/vor-maschine.p3b.r375.codex-probe.py \
  /tmp/codex-r374 /tmp/r375-plan-probes.json
```

Alle Assertions bestanden. Das bedeutet: Der Ist-Unterschied und die mathematischen Gegenbeispiele sind reproduziert. Es ist kein grüner Test einer neuen Implementierung.

## 1 · Veralteter Cache wird heute ausgewertet

`gateway.py:2258` übergibt `_reader_get("trip_latched")` unmittelbar an `evaluate_trip_latch`. Der Alias führt zu `HalBridge.reader_get` (`hal_bridge.py:684`): Es gibt das vorhandene Feld zurück, ohne Altersprüfung. `reader_is_stale` ist eine getrennte Methode. Auch der tatsächlich altersprüfende Helfer `_reader_fresh_get` wird an dieser Stelle nicht benutzt.

Die Sonde setzt den Ankunftsstempel auf 0 s, die aktuelle Zeit auf 3 s und die Veraltungsgrenze auf 2 s. Der Snapshot enthält `trip_latched: true`; zuvor wurde eine saubere FALSE-Grundlinie ausgewertet.

| Eingabe an den bestehenden Automaten | Ergebnis |
|---|---|
| Tatsächlicher Zugriff: `true`, obwohl `reader_is_stale()` wahr ist | `tripped: true` |
| Vorgeschlagene Ersetzung durch `None` | `tripped: false` |

Das belegt die Verhaltensänderung in A2, unabhängig von einem nativen Lauf.

## 2 · Zeitgrenzen

**Ablesung:** Snapshot-Beginn 10,00 s; SIGCONT-Klammer [10,10; 10,11] s; tatsächliche Latch-Ablesung 10,25 s; Snapshot-Ende 10,26 s. Der Reader wurde zwischen Anfangsstempel und Pin-Ablesung verdrängt. Nach B3 wäre der Frame „nachweislich alt“, tatsächlich liegt die relevante Ablesung nach dem Fortsetzen. Mit einem Ableseintervall wäre er korrekt nicht auflösbar. Zwei Kontrollen mit vollständig vorher bzw. nachher liegendem Intervall liefern „alt“ und „neu“.

**Frist:** SIGCONT-Klammer [10,00; 10,40] s, tatsächliches Signal im Gegenbeispiel 10,01 s, neue Ablesung 10,41 s, Empfang 11,20 s. B7 misst 0,80 s und besteht die Ein-Sekunden-Grenze. Der tatsächliche Abstand im Gegenbeispiel ist 1,19 s. Aus den aufgezeichneten Klammern folgt nur das Verzögerungsintervall [0,80; 1,20] s.

Diese Zahlen sind synthetische Zeugen zur Planlogik, keine behaupteten Messwerte der Sim.

## 3 · Gültigkeit vor Urteil

SIGCONT-Klammer [10,10; 10,11] s, Empfang 10,40 s, behauptetes `reader_t = 1000`, `latched: false`, kein Trip. Die reine B3-Vergleichsregel klassifiziert „neu“ und B7s erster Block liefert FAIL. B6 widerlegt aber die Zeitbasis desselben Frames. Dieser Frame beweist daher keine frische falsche Anzeige; sein Messnachweis ist ungültig.

Ein weiterer zu präzisierender Fall ist: gültiger neuer Frame mit Trip, danach ein Frame ohne Herkunft und ohne Trip, danach wieder gültige neue Frames mit Trip. „Kein Nachweis“ für den mittleren Frame darf keine stillschweigende Ausnahme für seine möglicherweise frische falsche Anzeige sein. Der Plan muss reine Klammerüberlappung und fehlenden/beschädigten Herkunftsnachweis getrennt behandeln.

## Weitere Quellen und Grenzen

- R370: vier Bedingungen und fünf Gegenfälle im selben Review-Dokument, insbesondere alle qualifizierenden Frames bis zur Quittierung.
- `scripts/native_run.py:2239` ff.: `before_trip` verweigert eine fremde wartende Auslösung, danach getrennte Ausfall- und Recovery-Abschnitte. Diese Sicherungen bleiben erforderlich.
- `scripts/test_support/trip.py:42`: Signal heute vor Zustandsdatei; Prozessidentität wird bereits geprüft. Die Klammer gehört an diesen Signalaufruf und nur an den tatsächlich ausgeführten Zweig.
- `scripts/test_support/servo_cases.py:433`: HAL-Verlauf, Heartbeat-Rückkehr, Reset und Anzeige sind bereits eigene Bedingungen.
- `hal_reader.py:206`: mehrere Pin-Ablesungen in Folge; ein Anfangsstempel ist keine obere Grenze der späteren Latch-Ablesung.
- Die 15 zusammengefassten Laufmessungen wurden als Planbegründung gelesen, nicht aus den Rohtraces neu gemessen. Die 1,0-s-Grenze ist eine vorgeschlagene Abnahmegrenze; der bisherige Ankunftszeitnachweis misst noch nicht die neu verlangte Frische.
