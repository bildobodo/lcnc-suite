# R141 · Codex · Planprüfung · 2026-10-12

Gegenstand: `docs/reviews/kollision-paket2.plan.md`, separat geänderte Fassung 3. SHA256 `6651ca6f334c821d5363eb71f16ae0151af9080f832a92f640d023abeca21f3a`. Live-HEAD bei Beginn `d450a67b20dea4d159bf9497299c7583e88dc9a5`. Der genannte `3e08df86` bleibt der Orakel-Testcommit; in dieser Runde ist keine neue Produktimplementierung zu prüfen.

Gelesen wurden die Planänderungen gegenüber Fassung 2, die betroffenen vollständigen Modell-/Budget-/Merge-/Darstellungsabschnitte, die Abnahmeregeln und die Anfrage R141. Bezug sind die beiden R140-Reste. Keine Produktdateien bearbeitet, keine Builds/Browser-/Live-Tests ausgeführt.

## Eigene Vertragsprobe

```sh
nice -n 19 python3 /tmp/codex-r141-qistigzp/plan_probe.py
```

Die beigefügte Datei `codex-plan-probe.py` ist ohne Repository-Abhängigkeiten mit Python 3 ausführbar; sie schreibt die gleichnamige JSON-Datei und dieselben Daten auf stdout. Die ursprüngliche Ausgabe liegt als `codex-plan-probe.txt` bei. Sämtliche Assertions bestanden: Sie prüfen die unten behaupteten Gegenbeobachtungen, nicht eine funktionierende Paket-2-Implementierung.

1. **Positive Kontrolle:** Die Regel „Vereinigung, danach die gesamte Lücke der trennenden Generation ausschneiden“ löst R140 A/B/C korrekt. Der freie Punkt 1.0005 wird nicht mehr überdeckt.
2. **Schmaler bestätigter Kontakt:** Die gehaltene Generation kennt einen Kontakt auf [1.4,1.6], mit einer bestätigten Berührung bei 1.5. Die neue Generation fragt in diesem Bereich bei 1.125, 1.375, 1.625, 1.875 und sieht ihn nicht. Alle ihre freien Proben sind wahr und liegen im Abstand 0.25; es gibt keinen Widerspruch zur positiven Probe bei 1.5. Das Ausschneiden ihrer gesamten Lücke [1,2] löscht dennoch den alten Kontakt. Der Test ist ein analytischer Ablauf der Planregel, kein geometrischer Produktlauf.
3. **Identität:** Zwei neue Stücke eines alten Intervalls überdecken beide dieses eine alte Ereignis. Die wörtliche ID-Regel weist ihnen beide ID 11 zu. Eindeutige Stücke brauchen eine zusätzliche Aufteilungsregel für IDs.
4. **Rastergrenze:** Ein Pixel kann zugleich Kontakt und eine freie Unterpixelstelle enthalten. Die OR-Aggregation setzt das Pixel; die exakte Punktabfrage bleibt frei. Diese Grenze ist im Review als zulässige reine Darstellungsapproximation eingeordnet, nicht als neuer Datenbefund.
5. **Indexrechnung:** Die in Fassung 3 benannten u32-Indizes/Anzeige-IDs für beide Generationen plus deren Seitenanteile und 8192 f64-Bandpaare ergeben 8 388 608 Bytes. Das ist eine Kapazitätsrechnung aus den Tabellenlimits und keine Heap-Messung. Die Ergänzung der Seitenanteile ist eine nicht blockierende Zahlenkorrektur zur angenommenen Speicherstrategie.

Nicht als Probe ausgeführt, sondern als notwendiger Grenzfall im Review benannt: Ein negativer Trennbeleg ist bereits bekannt, obwohl das folgende Intervall noch nicht existiert. Der Transport darf diesen Beleg nicht allein an dessen späteres Entstehen binden.

## Integrität und Grenzen

Plan und vollständiger vorhandener Review-Text wurden vor der Arbeit nach `/tmp/codex-r141-qistigzp` kopiert und gehasht (`codex-context.json`). Vor Ablage nochmals bytegleich geprüft. Der Live-Baum bekommt ausschließlich den Review-Anhang und sechs neue `viewer-palette-fest.r141.codex-*`-Dateien. Plan, frühere Belege, Produktcode und Live-Sim bleiben unverändert. Keine Live-Ports, Maschinenbefehle, Orakel-/Gesamtgate-Ausführung oder Testserver. Der Handshake folgt erst nach Link-, Status- und Integritätsprüfung.
