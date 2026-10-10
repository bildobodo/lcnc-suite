# R125 · Codex · Planprüfung E/F Fassung 4

Stand: `6650f51c5ac5ea630afcec45cd7d7684983c98fb`; Umfang `02f2acc0..6650f51c`. Die geprüften Dateien wurden mit `git show <commit>:<path>` nach `/tmp/codex-r125-6kf6fh4x` kopiert. Quellhashes, Änderungsumfang und Hash des unveränderten Review-Präfixes stehen im begleitenden Kontext-JSON.

## Nachverfolgung der R124-Antworten

| R124-Punkt | Stelle in Plan Fassung 4 | Bewertung |
|---|---|---|
| VP124-01: keine allgemeine Tasterlatenz aus der Prüfzone ableiten | F3, Zeilen 312–324; F7 Nr. 5/5a, Zeilen 382–383 | Geschlossen: neue Hilfe ohne Toleranzzusage; alte Zahl ausdrücklich zurückgenommen; Rechnung und Verzweigung als Anzeige-Wächter |
| Herkunft auch an einzelnen Sim-Einträgen | F3, Zeilen 315–319 und 334 | Übernommen: `conditional`, eigene Hilfe mit Messzeile, Erhalt bei Filter/Navigation; `possible` bleibt eigenständige Hüllenbedeutung |
| Kein Ende der Bedingung durch geometrische Trennung | F3, Zeile 318 | Übernommen; ein Fund außerhalb H bleibt von der Messannahme abhängig |
| P_geo − P_rep als Strecke berichten | F5, Zeile 356 | Übernommen; keine Behauptung, die Strecke sei eine gemessene Eingangszeit |
| Fehlende INI-Grenzen ergeben keine erfundene Zeit | E7, Zeile 194; Antworttabelle R124 | Übernommen; dieser Fall hat keine endliche Untergrenze für das betroffene Segment |
| Sim-Messung ist keine Produkt-Zulassung | F2/F3/F5/F6 | Unverändert ausdrücklich begrenzter Modellanspruch |
| Messreihe vor der Parity-Abnahme | Reihenfolge, Zeilen 395–404 | Unverändert |

Die verbliebenen Vorkommen von `t_max` sind Rücknahme/Änderungshistorie, keine aktive Zusage. F1 erklärt weiterhin den direkten Einfluss des fehlerhaften G43-Versatzes; für die Gesamtbahn ist die ausdrückliche Einschränkung in F3 maßgeblich. Für die Umsetzung keine pauschale Aufhebung der Herkunft an G53, einer Trennung oder einem Werkzeugwechsel daraus ableiten.

E7 beschreibt zwei Fälle: mit gültigen Geschwindigkeitsgrenzen die berechnete Untergrenze mit `+`; ohne solche Grenzen unbekannte Segmentzeit. Den anschließenden allgemeinen Satz zur `+`-Anzeige nicht als Rückfall auf eine erfundene Segmentdauer verwenden.

## Prüfgrenze

Dies ist eine Dokument- und Vertragsprüfung, kein Test einer Umsetzung. Der Commit-Bereich ändert ausschließlich Plan und Review-Anfrage. Die R124-Sonde, ihre Ergebnisse und ihr Prüfaufbau sind gegenüber dem Basiscommit unverändert (Bytevergleich, Kontext-JSON). Die sechs nativen Fälle aus R124 werden als vorhandene Gegenbelege herangezogen, **nicht als in R125 neu ausgeführte Tests**.

Keine Produktdateien geändert, keine Builds, kein Browser, keine Live-Ports, kein HAL, keine Maschinenbefehle. Keine neue Messreihe, Parity-Abnahme oder Gesamtgates. Die Implementierungswächter, Mutationen und Live-Nachweise bleiben Teil der folgenden Umsetzung.

Bewertung: `agreement` für Plan Fassung 4, keine neuen offenen Befunde.
