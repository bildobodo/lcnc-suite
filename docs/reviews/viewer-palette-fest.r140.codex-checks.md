# R140 · Codex · Planprüfung · 2026-10-12

Gegenstand: `docs/reviews/kollision-paket2.plan.md`, Fassung 2, separat im Live-Baum geändert; SHA256 `53eebc206f9a8aad9a80cbcf88f984d53db4a89be1b4fcb89f0296c3c03e553d`. Die Anfrage R140 und die Antworten auf R139 wurden vollständig gelesen. Der genannte Head `3e08df86` ist der einzelne Orakel-Testcommit auf dem ungemergten Zweig `feat/step4-p2`; sein Elternstand ist `6d5e20f7`. Der Live-HEAD blieb `b9541f4555f887074ccba1cfc5548b8f40a9c850`.

## Prüfung

- Fassung 2 gegen die fünf R139-Befunde und die damals eingefrorene Fassung 1 gelesen.
- Gelesene Codegrundlage: `git diff 6d5e20f7..3e08df86 -- lcnc-webui/src/viewer/collisionFixtures.ts lcnc-webui/src/viewer/collisionOracle.test.ts`; außerdem die passenden Abschnitte des unveränderten Sweep-Codes zu Werkzeuggrenzen, unbekannten Werkzeugen und `pairV`.
- Claudes `r140.oracle.txt` und `r140.sensitivity.txt` gelesen. Deren Testzahlen sind fremde Belege, nicht eigene Ausführungen. Der komplette Orakel-/Mutationslauf wurde nicht wiederholt, weil die Anfrage eine Planrunde ist.
- Kein Browser, kein Build, keine Tests im Live-Baum. Keine Live-Ports, Maschinenbefehle oder Neustarts.

## Eigene Gegenprobe

```sh
nice -n 19 python3 /tmp/codex-r140-3d50s0dn/plan_probe.py
```

Das beigefügte `codex-plan-probe.py` kann unabhängig vom Repository mit Python 3 ausgeführt werden. Es schreibt eine gleichnamige JSON-Datei und die Ergebnisse auf stdout. `codex-plan-probe.txt` enthält die Ausgabe des eigenen Laufs; alle Assertions bestanden.

Der Code ist **eine direkte Auslegung der geplanten Ersetzungsregel**, kein Ersatz für Produktcode und kein behaupteter geometrischer Sweep. Er zeigt:

1. Zwei alte Kontakte mit einer bekannten freien Probe bleiben nach eins-zu-eins-Ersetzung zwar zwei Ziele. Ein breites neues Intervall kann die freie Probe dennoch wieder überdecken. Damit genügt die bisherige Regel bzw. ein reiner Zähltest nicht.
2. Die Ableitungen zweier nicht zugeordneter Tabellenbestände haben bis zur doppelten Größe der Ableitungen eines Bestands. Die Budgetzahlen stammen aus Fassung 2; es ist eine Kapazitätsrechnung, keine Heap-Messung.
3. Eine Wissenslücke kann aus einem semantischen Kontakt zwei sichtbare Bandstücke machen. Deshalb ist die Anzahl der Bandstücke nicht allein durch die Anzahl semantischer Kontaktintervalle begrenzt.

Das Ergebnis enthält die konkreten Zahlen und grenzt nicht berücksichtigte weitere Halter ausdrücklich ab. Eine Implementierung mit anderen, begrenzt berechneten Ableitungen ist zulässig; dann ist deren Grenze im Plan anzugeben.

## Integrität

Vor dem Anhängen wurden der vollständige vorhandene Review-Text, der Plan und beide vorhandenen R140-Belege eingefroren und gehasht (`codex-context.json`). Vor Ablage nochmals bytegleich geprüft. Der Live-Baum erhält nur einen Anhang an die Review-Datei und sechs neue `viewer-palette-fest.r140.codex-*`-Dateien. Der Plan bleibt unverändert. Der Handshake folgt erst nach Integritäts- und Linkprüfung.
