# R58 — isolierte Nachweise, 724a3d5

Geprüft am 1. Oktober 2026 in `/tmp/codex-r58-_9urw3gm`, einer Archivkopie
von `724a3d5b500c90ca16a7c74e8d9fee3c72a448b2`. Kein Zugriff auf Live-Ports,
keine Maschinenbefehle. Eigener Mock `127.0.0.1:4188`, nach der Prüfung beendet.
Produktdateien im Live-Baum wurden nicht geändert.

## Native Gegenprobe (VP-I22)

`viewer-palette-fest.r58.native.py` verwendet den unveränderten Worker aus
`PYTHONPATH`, synthetisches STAT und einen temporären INI-/Var-/Werkzeugbaum.
`linuxcnc.command` wirft immer. Beobachter an Canon-Methoden protokollieren
Argumente und delegieren unverändert. Je Fall ein eigener Interpreterprozess.

```sh
PYTHONPATH=/tmp/codex-r58-_9urw3gm/lcnc-gateway OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  docs/reviews/viewer-palette-fest.r58.native.py percent_line2 /tmp/r58-line2.mpk
```

Die weiteren Fälle heißen `percent_line1`, `percent_rotary_line1` und
`percent_rotary_line2`. Die JSON-Ausgabe enthält Canon-Aufrufe und Payload-
Zusammenfassung; OUT.mpk und OUT.mpk.json enthalten den vollen Payload.
`native.json` enthält Eingaben und Resultate aller vier Fälle;
`payloads.json` die vollständigen dekodierten Payloads (Bytes als base64).

`consumers.test.ts` nach `<Archiv>/lcnc-webui/src/r58-consumers.test.ts`
kopieren; `payloads.json` nach `<Archiv>/evidence/` unter seinem vollen Namen.
Der Test ruft die echten Funktionen für Dekodierung, Spur, TLO-Zuordnung und
Achsposition auf. Er bestätigt ausdrücklich den Fehler, also ist PASS hier
**keine Abnahme**. `consumers.json` enthält die rekonstruierten Achspositionen.

## Browser-Gegenprobe (VP-I23/24)

`browser.spec.ts` nach `<Archiv>/lcnc-webui/e2e/r58.spec.ts` kopieren,
`playwright.config.ts` nach `<Archiv>/lcnc-webui/r58.playwright.config.ts`.
Nur in der Archivkopie die beiden URLs in `e2e/ctl.ts` auf
`127.0.0.1:4188` umstellen. Ausgabeordner `<Archiv>/evidence` anlegen.

Im Archiv-Frontend bauen und eigenen Mock starten:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
MOCK_PORT=4188 MOCK_HOST=127.0.0.1 nice -n 19 node e2e/mock-gateway.mjs
```

In einem zweiten Terminal, ebenfalls im Archiv-Frontend:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r58.playwright.config.ts
```

Die Sonde übernimmt das VP-I20-Payload aus dem neuen Bestandstest und hält
**nur die Zustellung** der echten Worker-Antwort `4501:0,0,20` zurück. Das
bildet einen noch nicht fertig eingetroffenen Dekodier-/Bake-Auftrag ab; weder
Worker-Resultat noch Produktzustand werden ersetzt. Sie misst zuerst den
frischen Pfad, dann die laufende Gateway-Prüfung, dann die verfrühte
Freigabe bei noch alter Geometrie und schließlich die korrekte Geometrie
nach Zustellung. Danach sendet sie absichtlich dieselbe Revision mit einer
anderen Datei, um die vertragliche Dateibindung zu prüfen. Auch diese
Assertions sind **Fehlernachweise**, keine grünen Produktwächter.

`browser.json` dokumentiert Pfadboxen, Materialfarben, Warntexte und Anzahl
der Downloads. `pending-basis.png` zeigt den Zustand mit zurückgehaltener
Antwort. Die Testdatei greift ausschließlich auf den eigenen Mock zu.

## Vorhandene Prüfungen

- Build: PASS, `build.txt`.
- Backend: `test_start_tlo_worker`, `TestStartTloSeed`,
  `TestComparePreviewPayloads`, `TestStartDrift`, `TestPercentDelimiter`,
  `TestCanonInitLines`: **30/30**, `backend-tests.txt`.
- `test_bulk_pipeline.TestVerifyAtTheActualOffset`: **5/5**,
  `pipeline-tests-unsandboxed.txt`. In der Sandbox blieb der Asyncio-Lauf
  trotz abgeschlossenem Threadjob stehen; isoliert außerhalb der Sandbox
  lief er in 0,009 s. Das ist kein Produktbefund.
- Frontend: `toolBasis.test.ts`, `bulkData.test.ts`, `previewDecode.test.ts`
  und die eigene Verbrauchersonde: **45/45**, `frontend-tests.txt`.
  Konfiguration `vitest.config.ts` als `r58.vitest.config.ts` ins Archiv-
  Frontend kopieren; Cache liegt außerhalb der geteilten Dependencies.
- Eigene Browserdiagnose **1/1**, `browser.txt`; vier native Gegenfälle.

Alle hier genannten Belegnamen tragen das Präfix `viewer-palette-fest.r58.`.
Die vollständigen Offline-/Live-Gates der Implementierung wurden nicht wiederholt.
