# R377 · Codex · Abschluss der Planprüfung

Gelesen: `6491ff35`, Abschnitt „Antwort auf R376, Plananfrage R377“, zusammen mit dem vollständigen Vertrag in R376 und den bereits angenommenen Entscheidungen aus R375/R376. Produktstand unverändert `d7431f19`; seit R376 nur Review-Dokument und Belege.

## Prüfung

[Reproduzierbare Planprüfung](vor-maschine.p3b.r377.codex-plan-check.py), [Ergebnis](vor-maschine.p3b.r377.codex-plan-check.json).

```sh
cd /tmp
python3 /path/to/vor-maschine.p3b.r377.codex-plan-check.py /tmp/r377-plan-check.json
```

**14 Planprüfungen bestanden:**

- Vier Grundlinienfälle: breite Klammer abgelehnt, kurze Klammer zugelassen, Altersobergrenze genau 0,5 s zugelassen und darüber abgelehnt.
- Neun Latch-Formen: nur `false`/`true` gültig; fehlend, null, 0, 1, String, Array und Objekt ungültig. Insbesondere wird keine bloße Wahrheitswert-Konvertierung verwendet.
- Korrigiertes Zeitbeispiel: `read0 ≤ read1 ≤ arrival ≤ t_pub ≤ Empfang` erfüllt, Ablesung nach der SIGCONT-Klammer, Verzögerungsintervall [0,20; 1,20] s. `incomplete` folgt aus der unbewiesenen Ein-Sekunden-Frist, nicht aus einer beschädigten Zeitordnung.

Die Sonde prüft die Regeln des Plans durch reine Berechnungen. Sie ist kein Test einer Umsetzung. Keine Produktänderung, kein Produkt-/Browser-/Live-Test, kein Netzwerk-/HAL-Zugriff und keine Signale. Die bisher angenommenen Verträge zu unveränderter Automaten-Eingabe, einer unveränderlichen Veröffentlichung je Tick, Gültigkeit vor Einteilung, Frist-Untergrenze über `t_pub`, Aufnahme bis zum Quittierungsversuch und unabhängigen HAL-/Reset-Nachweisen bleiben Teil der Abnahme.

Die Umsetzung und ihre vorgesehenen Gegenwächter, nativen Haupt- und `latch-delayed`-Läufe je dreimal sowie `perf-matrix` stehen weiterhin aus.
