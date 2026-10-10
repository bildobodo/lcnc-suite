# R124 · Codex · Prüfaufbau

Geprüfter Stand: `663c3a4c095dd2d42fdf365bc09eae4d5ebbdd10`, Plan Fassung 3. Eigene Archivkopie `/tmp/codex-r124-nxsllx87`. Reine Planrunde; kein Produktcode geändert.

## Native Gegenprobe: Messwert ist ein Programmeingang

Sechs getrennte Prozesse verwenden `native_start_probe.py` und den nativen Offline-Interpreter. Der Adapter ergänzt ausschließlich Fälle im Arbeitsspeicher. Die vorhandene synthetische STAT, private INI-/Parameter-/Werkzeugdateien und die Sperre von `linuxcnc.command` bleiben erhalten. Kein HAL, keine Live-Ports, kein Maschinenbefehl.

Die unveränderte gebündelte Routine liefert bei T2 = 80 und Platten-Z = −180 den idealen Messwert −100. Danach setzt das Testprogramm **explizit einen hypothetischen Ergebnisunterschied**: `#5063 = [#5063 - delta]`, mit delta = 0 bzw. 0,1. `G10 L1 P2 Z[180 + #5063]` und `G43 H2` bilden die dazu passende Werkzeuglänge nach der vorhandenen Formel. Diese Einspeisung ist keine gemessene oder simulierte Eingangsverzögerung. Geprüft wird die Auswirkung zweier möglicher Ergebniswerte auf die native Programmausführung.

Bei F200 entspricht δ = 0,1 mm unter der im Plan verwendeten Rechnung 30 ms, weniger als die dort angegebenen 600 ms. Diese Zeit ist analytisch, nicht gemessen. Das Programm fährt dann ab X100/Y20/Z−90:

| Folgesatz | Ziel-X bei δ = 0 | Ziel-X bei δ = 0,1 | Unterschied |
|---|---:|---:|---:|
| `G1 X150 F100` (Kontrolle) | 150 | 150 | 0 |
| `G1 X[150 + 100 * [#5063 + 100]] F100` | 150 | 140 | 10 |
| `if #5063 < −100,05`, X50, sonst X150 | 150 | 50 | 100 |

Alle sechs Parses ohne Fehler, in allen Fällen privates Tool-mmap unverändert. Die TLO-Ereignisse zeigen als letzte Z-Basis 80 bzw. 79,9. Die Zielpunkte in der Ergebnistabelle und im JSON sind Programmkoordinaten. Die Probe beweist die fehlende Schranke für die Bahnabweichung durch die Programmsemantik; sie führt weder einen Kollisions-Sweep mit Maschinenmodell noch einen realen Messablauf aus.

Reproduktion, aus einer Archivkopie; Ergebnis unter einem neuen Namen ablegen:

```bash
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python \
  /tmp/codex-r124-nxsllx87/docs/reviews/viewer-palette-fest.r124.codex-run.py \
  /tmp/codex-r124-nxsllx87 /tmp/r124-reproduced.json
```

Der erste lokale Aufruf scheiterte vor dem Parse, weil der Runner den venv-Interpreter-Symlink zu `/usr/bin/python` auflöste und damit `msgspec` fehlte. Der veröffentlichte Runner erhält den venv-Pfad; alle sechs Fälle wurden damit erneut ausgeführt. Das ist kein Produktbefund.

## Vertragsprüfung

- E7/E8/E10: Rate auch im Rapid-Strom; Wächter für den ersten G1; Zeituntergrenze aus INI-Grenzen. VP122-02 damit auf Planebene geschlossen. Keine Implementierung dieser neuen Felder vorhanden oder behauptet.
- F1–F3: P_geo, P_rep und Q getrennt; Messfehler wirkt auf Werkzeugbasis und Folgebahn. Bedingte Vorschau auf allen Maschinen angenommen. F2 berücksichtigt beide Antastgeschwindigkeiten.
- F3/F5/F6: keine Produkt-Zulassung einer Tasterkette; Messreihe auf benannter Sim-Konfiguration, späterer vollständiger Maschinenvertrag. VP122-04 dadurch im vorliegenden Plan geschlossen.
- F3: Eine starre relative Translation mit Norm ≤ δ kann einen tatsächlich belegten Abstand höchstens um δ verkleinern. Der Plan garantiert die dafür erforderliche unveränderte Bahnform nicht. Die native Gegenprobe zeigt den Bruch dieser Voraussetzung bereits ohne komplizierte Kinematik.
- `collision.ts:18–20` benennt zudem eine Mindestauflösung (MIN_ADV). Aus dem bloßen UI-Wort „Clear“ darf kein stärkerer, für alle Zwischenlagen bewiesener Abstandssatz abgeleitet werden. Dieser Hinweis ist kein neuer Befund gegen den bestehenden Sweep.

Primärreferenz: [LinuxCNC G38.n](https://linuxcnc.org/docs/2.9/html/gcode/g-code.html#gcode:g38) beschreibt die Messparameter #5061–#5069; die Gegenprobe nutzt #5063 anschließend in normalen Ausdrücken und Verzweigungen. Die vorhandene Routine benutzt ihn für ihre Längenformel (`tool_touch_off.ngc`, −170 bis −190).

Keine neue Parity-Abnahme, keine Live-Messreihe und keine Browser-/Backend-Gesamtgates für diese Planrunde.
