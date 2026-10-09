# R115 · Codex · Prüfaufbau

Gegenstand: Plan Fassung 4, `010ebf07..b278117a`, HEAD `b278117ac27c18fe9825627ffdf2f3dea1ec7177`. Nur `restpruefung-lauf.plan.md` und die Anfrage im Review geändert. Auch gegenüber dem in R114 geprüften `60c888a6` ist der Produktcode unverändert.

## Ausgeführt

- Vollständigen Plan, Änderung und Antwort R115 gegen die offenen R114-Punkte gelesen; die Herkunftsregeln, Ergebniswechsel und vorhandenen Quellhelfer gegengeprüft.
- Archiv unter `/tmp/codex-r115-lwy4uee9` erzeugt. Alle Proben dort, `nice -n 19`, nur Python-Standardbibliothek.
- `plan-checks.py` lädt ausschließlich den vorhandenen reinen `pinned_ctx`-Helfer per AST. Die neue Laufbasis, der Digest und die Zulassung sind ausdrücklich ein **Planmodell**, keine Produktimplementierung. Acht Bedingungen bestätigt: A bleibt trotz späterer Publikation B zugelassen; B mit Etikett A wird abgelehnt; Pfad-, Source-, Lauf- und Basisrevisionswechsel werden abgelehnt; nachträgliche Änderung des gebauten Kontexts scheitert; die unveränderliche Startkopie überlebt Änderungen verschachtelter Daten.
- Die drei gespeicherten echten R114-Sweep-Ergebnisse gegen den neuen Ersatzvertrag gelesen: Feed-Fall ohne Kollision; Rapid-Fall mit Beginn L8 und Fortsetzungen L10/L11; bekannter Treffer L9 trotz unbekanntem Anfang, samt Unbekannt-Hinweis. **Nicht erneut ausgeführt.** Der neue Bereichssweep und Ergebnis-Koordinator existieren noch nicht; ihre Laufzeitfunktion wurde nicht getestet.

## Ergebnis und Grenzen

Plan-Agreement; VP112-02-Rest und VP114-01 geschlossen. Das Modell zeigt, wie die neuen Vertragsbedingungen die bisherigen Gegenfälle ausschließen; es beweist keine künftige Implementierung. Umsetzungstests müssen den tatsächlichen Worker-Eingang, die tatsächlich konsumierte Werkzeugtabelle, Publish-Rennen, beide Sweeps und alle Verbraucher der Ergebnisanzeige prüfen. Für Abbruch/ungeprüfte Strecken bleibt die Einschränkung aus Paket 3c maßgeblich.

Keine Builds, Browser, Ports, nativen Parses, Controller-/HAL-Zugriffe oder Maschinenbefehle. Kein Gesamtgate wiederholt, keine Produktdateien geändert. Im Live-Baum nur der Review-Anhang und neue R115-Belege. Frühere Belege unverändert. Die separaten offenen M600-Live-Nachweise aus R111 sind nicht Gegenstand dieses Plan-Agreements.

## Wiederholung

`git archive b278117a` in eine temporäre Kopie entpacken. Dann:

```sh
nice -n 19 python3 docs/reviews/viewer-palette-fest.r115.codex-plan-checks.py /tmp/r115-archive /tmp/r115-plan-checks.json
```

Die Sonde liest ausschließlich aus dem angegebenen Archiv und schreibt die angegebene Ergebnisdatei. Kein Gateway-Import. Das Modell ist kein Vorschlag für das endgültige Digest-Schema.
