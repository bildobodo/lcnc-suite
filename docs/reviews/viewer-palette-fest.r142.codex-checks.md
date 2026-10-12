# R142 · Codex · Prüfprotokoll

Planrunde, nur VP139-04 A/B in `kollision-paket2.plan.md`, Fassung 4. Kein Produkt-Sweep, Build, Browser, Gesamtgate oder Controller-Zugriff.

## Stand

- Live-HEAD: `839ea11d36cd26e3ee8ae1ae88a1e68e16d024cc`.
- Geprüfter Plan: Arbeitsbaumfassung 4, SHA256 `b4beb3ac67feae782b2078b50f43ad88f7e8f1ec6b55167d39f27f0742c70219`.
- Der in der Anfrage genannte Head `3e08df86` ist weiterhin nur der Orakel-Testcommit, nicht diese Planfassung.
- Initial bereits geändert: Plan und Review-Datei. Beide vor der Prüfung bytegetreu in `/tmp/codex-r142-sc1b5jus` eingefroren.
- Keine AGENTS.md im Repository gefunden. Kein Unteragent verwendet.

## Gelesen

- Vollständiger Plan und Diff Fassung 3 → 4; Antworten/R140–R142 und zugehörige Codex-Befunde.
- `collision.ts`, insbesondere 2241–2267: `contactAtDist` liefert bei `undecidable` wahr; `bisectBoundary` gibt die verfeinerte Kontaktseite zurück, die deshalb unentscheidbar sein kann.
- `collisionInside.test.ts`, 99–120: bestehender Test „met only by the refinement…“ trennt tatsächlichen Kontaktbeginn 19.5 vom durch unentscheidbare Antworten vorgezogenen Beginn unter 19. Test nur gelesen, in dieser Planrunde nicht ausgeführt.
- `pairV`, 2112–2120 und 2601–2658: Schranke gilt im Chunk, nicht ungeprüft über dessen Grenzen. Keine erneute Abnahme der Schrankenimplementation.
- Handshake-Skriptkopf; `git diff --check` für vorhandene Plan-/Review-Diffs erfolgreich.

## Eigene Ausführung

```sh
python3 /tmp/codex-r142-sc1b5jus/plan_probe.py --source /home/cnc/lcnc-suite/lcnc-webui/src/viewer/collision.ts
```

Exit 0. Nur Python-Standardbibliothek. Die Probe behauptet keine ausgeführte Paket-2-Implementierung. Sie modelliert die Planregeln auf analytischen Intervallen; die abgebildete Bisektion wird gegen den tatsächlichen Quelltext abgeglichen. Die Produktdatei wird nur gelesen.

Ergebnisse:

1. R140 A/B/C: begrenzter Freiraum erhält zwei getrennte Stücke; die freie Stelle 1.0005 wird nicht gefärbt.
2. R141: alle freien Zertifikate bleiben vom bestätigten mittleren Kontakt 1.5 entfernt; `[1.4,1.6]` bleibt erhalten.
3. Datenvertrag zum Austritt ist auch ohne nachfolgende Intervallzeile darstellbar. Dies ist eine Schema-Kontrolle, kein ausgeführter Delta-Transport.
4. Gewöhnlicher Split mit bestätigtem Anker 0: IDs 11 und 12, Selektion 11, unveränderte Wiederholung stabil. Dies ist die neue Zuweisungsregel, kein ausgeführtes contactView.
5. Gegenprobe: tatsächliche Kontaktmenge `[0,.5] ∪ [2,3]`, unentscheidbare Innenantwort auf `[1,1.9]`. Bisektion zwischen freier .75 und berührender 2.5 liefert **1.0003662109375**, also keinen bestätigten Kontakt. Eine entschiedene freie Probe .875 mit V=1 und d=CONTACT_EPS+.375 zertifiziert das Innere von `(.5,1.25)`. Nach korrektem Ausschneiden enthält kein verbleibendes Kind diesen vermeintlich unzerstörbaren Anker; der wirkliche Kontaktzeuge 2.5 bleibt. Abstand zum Schnittrand >1e-3: kein bloßer Rundungskonflikt. Dies ist VP139-04 B Rest.
6. Randbedingung: Bei |q−p|=(d−EPS)/V ist d(q)=EPS möglich, also Berührung. Die Radienprobe benutzt deshalb offene freie Bereiche und behält deren Ränder. Implementierungshinweis, kein neuer Architekturentscheid.
7. Budgetrechnung mit Merkerbytes auch in angefangenen Blöcken: T höchstens 16,908288 MB in dieser konservativen Rechnung, Ableitungen 8,388608 MB, Summe 122,519552 MB. Die Größenordnung der Planrechnung ist angenommen; echte allokierte Puffer bleiben die Abnahme, nicht gerundete Dezimalwerte.

Die JSON-Datei enthält alle Eingaben, Bisektionsschritte und Ergebnisse. Vor Veröffentlichung werden Planhash, HEAD und der vollständige bisherige Review-Präfix erneut abgeglichen. Im Live-Baum ausschließlich neue `viewer-palette-fest.r142.codex-*`-Belege und der angehängte Review. Bestehende Belege unverändert; keine Maschinenbefehle oder Live-Ports.
