# R264 · Codex · Prüfprotokoll · 3. November 2026

Prüfstand `feat/per-worker-mock` **490f028f**, Korrekturcode **94b8fc27**, Diff `e7634da3..490f028f`. Isolierter gemeinsamer Git-Klon `/tmp/codex-r264-uo3exasy/repo`, detached auf dem Prüfstand. `node_modules` und vorhandenes `dist` aus dem geprüften Worktree kopiert, Lockdateien bytegleich. Keine Produktänderungen, Builds oder Tests im Live-Baum, keine Live-Ports 5173/8000 oder Maschinenbefehle. Die Tests nutzten eigene lokale Mocks und beim gezielten Browser-Gate eine eigene Preview auf 4173; belegte Ports wurden abgelehnt.

## Eigene Prüfungen

1. Selektor-/Proof-Wächter: `python -m pytest -q scripts/test_select/test_selector.py`: **44/44 PASS**, 2,25 s. `codex-selector-tests.txt`.
2. Unveränderter Isolation-Harness: `python3 scripts/test_select/proof_harness.py --out <result.json>`: **7/7 PASS**. `codex-harness.json` enthält zusätzlich die Ereignisse, Phasenmarken und Statistiken der inneren Läufe; die dort genannten temporären Arbeitsorte sind keine erforderlichen externen Belege.
3. **Unveränderte R263-Sonde:** `per-worker-mock.r263.codex-baseline.spec.ts` bytegleich als `lcnc-webui/e2e-proof/r263/baseline.spec.ts` in die isolierte Kopie gelegt. Ausgeführt über `playwright.proof.config.ts`, ein Worker: **2/2 PASS**, Werkzeugmetadaten im neuen App-Status nach Reset `undefined`. Raw-Report, Ereignisse und Ausgabe: `codex-baseline.*`. R263-Belege unverändert gelassen.
4. **Originaler voller R264-Lauf:** 838 Resultate, jeweils einmal bestanden, keine Auslassungen oder Retries; 3 bound, 838 Start, 838 Ende, 3 stopped. Gate-Kennung `gate-91b14dd9-616c-443b-9bfc-b9825cf254d4` stimmt mit Bericht und Ereignissen überein. Discovery/Ausführung und korrigierter Worker-Prüfer grün. Zusätzlich der unabhängige R263-Prüfer, nur auf den R264-Dateinamen angepasst: keine Zuordnungsfehler (`codex-reports-check.*`). Kein eigener Wiederholungslauf aller 838 Tests.
5. **19 eigene Gegenfälle auf diesen Originaldaten:** falscher bound-Besitzer, Slot, Endpoint, Ereignis-Laufkennung, fremde/fehlende Berichtskennung, verschobene Worker-IDs, fehlendes stopped/bound, doppeltes vollständiges Paar, Start vor bound, Ende nach stopped, fehlendes Ende, fremdes Paar, falscher Retry sowie alte R263-Protokolle statt oder vor dem aktuellen Protokoll. **Alle 19 verweigert**; das Original bleibt grün. `codex-proof-review.*`. Auswertungen verändern ausschließlich Kopien der Daten im Speicher.
6. **Die echte Browser-Stufe zweimal mit demselben Ausgabepfad:** `round_gate.browser`, ausgewählt `mock-baseline`, vor jedem Aufruf absichtlich einen fremden Marker ins Ereignisfile geschrieben. Je Aufruf **2/2 PASS**, Discovery, Ausführung und Worker-Nachweis grün. Unterschiedliche neue Gate-IDs; ausschließlich die jeweils eigenen 2 Start-/Endpaare im Protokoll. `codex-gate-repeat.py`/`.json`. Dies ist ausdrücklich die Browser-Stufe, kein erneutes vollständiges Gate mit Build/Backend.

## Reproduktion der Auswertungen

```sh
python3 per-worker-mock.r264.codex-proof-review.py <geprüfter-Checkout> <Claude-docs/reviews>
python3 per-worker-mock.r264.codex-reports-check.py <Claude-docs/reviews>
python3 per-worker-mock.r264.codex-gate-repeat.py <isolierte-gebaute-Kopie> <neuer-Ausgabeordner>
```

Die lesenden Auswertungen verwendeten `/home/cnc/lcnc-suite-pwm/docs/reviews`, einschließlich der originalen `.gate-round.logs`. Für die Gate-Wiederholung müssen Preview- und Mock-Ports frei sein; das Skript verweigert belegte Ports. Es verändert nur seinen Ausgabeordner und Testartefakte der angegebenen isolierten Kopie.

## Ergebnis

PM263-01 und PM263-02 geschlossen. Agreement für das Paket und die Verwendung von drei Workern im parallelen vollen Browserlauf. Die bereits benannten übrigen Teststrategie-Pakete, insbesondere Firefox, sind damit nicht als umgesetzt erklärt.
