# R263 · Codex · Prüfprotokoll · 3. November 2026

Prüfstand: `feat/per-worker-mock` `e7634da3` (Code `eecabc56`). Isolierter gemeinsamer Git-Klon unter `/tmp/codex-r263-jpk_vopd/repo`, detached auf diesem Stand. Abhängigkeiten aus dem geprüften Worktree kopiert, nachdem die Lockdateien bytegleich waren. Keine Produktänderungen, Builds oder Tests im Live-Baum, keine Zugriffe auf 5173/8000, keine Maschinenbefehle.

## Ausgeführte Prüfungen

- Selektorwächter: `python -m pytest -q scripts/test_select/test_selector.py`: **43/43 PASS**, 1,76 s; `codex-selector-tests.txt`.
- Unveränderter Prüfharness: `python3 scripts/test_select/proof_harness.py --out /tmp/codex-r263-jpk_vopd/harness.json`: **7/7 PASS**. Eigene lokale Ports 4500–4503/4590, kein weiterer Playwright-Lauf daneben. Die sieben Fälle samt Ereignissen, Phasenmarken und Statistiken sind in `codex-harness.json` dauerhaft zusammengefasst; die darin genannten temporären Pfade sind nur die ursprünglichen Arbeitsorte.
- Eigene Baseline-Probe über die **unveränderte automatische Fixture**: die beigefügte `codex-baseline.spec.ts` als `lcnc-webui/e2e-proof/r263/baseline.spec.ts` in die isolierte Kopie legen; `LCNC_E2E_EVENTS=<absolute events.jsonl> PLAYWRIGHT_JSON_OUTPUT_FILE=<absolute report.json> npx playwright test -c playwright.proof.config.ts e2e-proof/r263 --reporter=json`. **1 PASS / 1 erwarteter FAIL**: Nach dem Fixture-Reset sind Snapshot und pristine gleich, aber ein neu verbundener App-WebSocket erhält weiterhin das Werkzeug des vorherigen Tests. Raw-Report, Ereignisse und Ausgabe liegen bei. Kein Eingriff in den Mock für diese Probe.
- Gate-Belege von Claude nochmals gelesen: selected 484/484, full-w2 838/838, full-w3 838/838, jeweils keine Fehler, Auslassungen oder Retries. `codex-reports-check.py` gleicht unabhängig von `proof.check_workers` Identitäten, Resultate, `workerIndex`/`parallelIndex`, Start/Ende, Besitzer, Portabbildung und Lebenszyklus der Instanzen ab: **alle drei unveränderten Belege konsistent**.
- `codex-worker-proof.py` prüft denselben Originalbestand mit der gelieferten Prüffunktion und setzt dann falsche Besitzer/Slots/Endpoints/Laufkennungen. Diese werden nicht zurückgewiesen. Auch **unveränderter Zwei-Worker-Bericht + unverändertes Drei-Worker-Protokoll** ergibt `[]`, obwohl sie aus verschiedenen Läufen mit unterschiedlicher Worker-Verteilung stammen. Positiver Empfindlichkeitsfall: fehlendes bound wird zurückgewiesen. Die JSON-Ausgabe begrenzt lange Fehlermeldungslisten auf drei Beispiele, erhält aber deren Zahl.

Die beiden Python-Auswertungen laufen so:

```sh
python3 per-worker-mock.r263.codex-worker-proof.py <geprüfter-Checkout> <Claude-docs/reviews>
python3 per-worker-mock.r263.codex-reports-check.py <Claude-docs/reviews>
```

Verwendeter Eingang war `/home/cnc/lcnc-suite-pwm/docs/reviews`, nur lesend; dort liegen die `.gate-round.logs` zu den drei R263-Records. Diese Eingangsdaten wurden nicht geändert.

## Grenzen

Kein neuer vollständiger 30–55-Minutenlauf: die unabhängigen Funktionsproben betreffen Fixture und Nachweis; die vorhandenen vollständigen Läufe wurden auf ihre Rohdaten zurückgeführt. Die sieben Änderungen an Tests wurden im Diff auf erhaltene Assertions geprüft. Den Render-/Hold-Lastversuch habe ich nicht erneut mit CPU-Brennern gefahren. Die Zwei-/Drei-Worker-Vergleiche liegen am selben Code-Stand vor; die Ein-Worker- und Kettenmessungen stammen vor den Testkorrekturen und sind nur frühere Referenzen. Firefox bleibt das benannte spätere Paket.
