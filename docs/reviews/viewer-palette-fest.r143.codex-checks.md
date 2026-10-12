# R143 · Codex · Prüfprotokoll

Planrunde: Fassung 5, verbleibender VP139-04-B-Ankervertrag sowie die beiden Umsetzungsbedingungen aus R142. Kein Produktcode geändert oder ausgeführt.

## Stand und Quellen

- Live-HEAD `67e50634295bea03b3378ee602d59b554105268f`.
- Geprüft: separat geänderte Arbeitsbaumfassung des Plans, SHA256 `0b26cb1fdd30a62e23d74f8b2561992891d493e5124742c61b2f26afe2b4cf40`.
- `3e08df86` in der Anfrage bleibt der Orakel-Testcommit; er ist nicht die Planfassung.
- Initial bereits geändert: `kollision-paket2.plan.md` und `viewer-palette-fest.ideen.md`. Vor Beginn bytegetreu in `/tmp/codex-r143-i3xnt4hv` eingefroren.
- Gelesen: Diff Fassung 4 → 5, Abschnitte 1.1–1.4, 2.2, 3.4–3.5, 7.5, Antworttabelle und Anfrage R143; vorheriger R142-Befund als Gegenanforderung.
- Kein einschlägiges AGENTS.md im Repository. Keine Unteragenten oder Skills verwendet.

## Eigene Ausführung

```sh
python3 /tmp/codex-r143-i3xnt4hv/plan_probe.py
```

Exit 0, alle Assertions bestanden. Python-Standardbibliothek, keine App-Abhängigkeiten. Analytisches Modell der Planregeln, kein ausgeführter Sweep, kein contactView, kein UI-Test. Die Modell-ID-Liste beschreibt die erwartete Navigation; sie testet keinen gebauten Navigationshandler.

1. **R142-Gegenfall plus Kontrolle der alten Regel:** Der vorsichtige Eintritt 1.0003662109375 ist weiterhin unentscheidbar und wird vom gültigen Freiraum entfernt. Die alte Ankerregel findet null Kinder, die neue Zeugenregel mit 2.5 genau eines. Dieses behält ID 11 und Auswahl 11. Damit wird die eigentliche Korrektur geprüft, nicht nur eine gewöhnliche entschiedene Grenze.
2. **Mehrere Schnitte einer Ursprungszeile:** Drei Stücke mit verschiedenen linken Trennbelegen. Der Zeuge liegt absichtlich im letzten Stück. Eindeutige IDs `[12,13,11]`, gleiche IDs beim unveränderten Folgedelta, ausgewählt bleibt das Zeugenstück. Keine Vergabe der alten ID allein nach Stellenreihenfolge.
3. **R140/R141-Kontrollen:** Die bekannte freie Stelle bleibt getrennt; der schmale bestätigte Kontakt bleibt erhalten.
4. **Radius:** Offene Ränder behalten eine Berührung genau am Radiusrand. Sieben f32-Werte werden nach innen gerundet, einschließlich 0.1 (die übliche Rundung wäre hier nach außen). Abschnittsgrenze und V=0 auf den bekannten Abschnitt begrenzt.
5. **Budgetrechnung:** 45 Bytes pro Intervall; T einschließlich Merker und angefangener Blöcke 19 267 584 Bytes. Ableitungen 8 388 608 Bytes. Sechs Haupt- und sechs Seitenhalter plus Ableitungen 138 444 800 Bytes, unter den rund 139 MB des Plans. Dies ist eine Kapazitätsrechnung, keine Heap- oder Implementierungsmessung.

## Ergebnis

VP139-04 B auf Planebene geschlossen; beide R142-Umsetzungsbedingungen übernommen. Fassung 5 angenommen, Runde A kann beginnen. Grenzklassifikation und ID-Vererbung sind nun getrennt und ausreichend definiert.

Redaktionell ist die geschlossene Schreibweise `[p-r,p+r]` in 3.5 noch auf die offenen Ränder aus 2.2 zu vereinheitlichen. Das verbliebene Wort „Anker“ in Auswahlregel und Wächter bedeutet nach Fassung 5 den Zeugen. Keine weitere Grundsatzentscheidung oder Planrunde nötig. Die Wissenslückenregeln aus 1.1 gelten auch für den verbleibenden vorsichtigen Intervallteil.

Builds, Browser, Orakel, Produkt-/Gesamtgate, Live-Ports und Maschinenbefehle wurden nicht verwendet. Der Implementierungsnachweis ist Aufgabe der vereinbarten Runde A/B einschließlich separater Abnahme des letzten Abtastungs-Commits.

Vor dem Veröffentlichen: HEAD und beide eingefrorenen Eingaben unverändert prüfen. Im Live-Baum ausschließlich Review-Anhang und neue `viewer-palette-fest.r143.codex-*`-Belege; alte Belege und Review-Präfix erhalten.
