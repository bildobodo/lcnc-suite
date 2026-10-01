# R59 — Nachprüfung auf 4aab1d3

Archivkopie: `/tmp/codex-r59-wem3j1_r`, Commit
`4aab1d34cd73c5cd212fda933bdb886a62dea6a3`. Vorherige R58-Belege unverändert.
Eigener Mock auf `127.0.0.1:4188`, nach der Prüfung beendet; keine Live-Ports
und keine Maschinenbefehle. Alle Dateinamen unten haben das Präfix
`viewer-palette-fest.r59.`.

## Native Fälle und Verbraucher

Die bestehende `viewer-palette-fest.r58.native.py` unverändert mit
`PYTHONPATH=<Archiv>/lcnc-gateway` ausführen. Je ein eigener Prozess für
`percent_line1`, `percent_line2`, `percent_rotary_line1`,
`percent_rotary_line2`. Beispiel:

```sh
PYTHONPATH=/tmp/codex-r59-wem3j1_r/lcnc-gateway OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  docs/reviews/viewer-palette-fest.r58.native.py percent_line2 /tmp/r59-line2.mpk
```

Resultate: `native.json`; vollständige dekodierte Payloads: `payloads.json`.
Synthetisches STAT, temporäre INI-/Var-/Werkzeugdateien, `linuxcnc.command`
wirft. `consumers.test.ts` nach `<Archiv>/lcnc-webui/src/r59-consumers.test.ts`
kopieren und `payloads.json` nach `<Archiv>/evidence/` unter seinem vollen
Namen. Die Sonde ist die R58-Sonde mit neuem Dateipräfix und korrigierter
Soll-Z-Folge `[10,20,20]` in beiden Fällen. Ergebnis `consumers.json`.

## Worker-Reihenfolge

`transitions.test.ts` nach
`<Archiv>/lcnc-webui/src/ws/r59-transitions.test.ts` kopieren,
`vitest.config.ts` als `r59.vitest.config.ts` ins Archiv-Frontend.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r59.vitest.config.ts
```

Die neue Unit-Sonde nutzt die echten Status-/Bulk-Handler mit Fake Worker:
Start 10 angewandt → 20 angefordert → Gateway kehrt auf den Start zurück →
verspätete 20-Antwort → weiterer gleicher Status. `transitions.json` zeigt,
dass die alte Antwort trotz gewünschtem Start 10 angenommen wird. Die
abschließenden Assertions **bestätigen den Fehler**; PASS ist hier keine
Abnahme.

## Browser

`browser.spec.ts` nach `<Archiv>/lcnc-webui/e2e/r59.spec.ts`,
`playwright.config.ts` als `r59.playwright.config.ts` kopieren.
In der Archivkopie beide URLs in `e2e/ctl.ts` auf `127.0.0.1:4188` setzen.
Die beiden eigenen Node-Sonden vor dem Build außerhalb von `src` halten
oder nur im Archiv vom DOM-Typecheck ausschließen. Die `tsBuildInfoFile`-
Pfade der Archiv-tsconfigs auf `../r59-ts-cache/` umstellen, damit kein
Buildcache in geteilte Dependencies geschrieben wird.

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
MOCK_PORT=4188 MOCK_HOST=127.0.0.1 nice -n 19 node e2e/mock-gateway.mjs
```

In einem zweiten Terminal, ebenfalls im Archiv-Frontend:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r59.playwright.config.ts
```

Erster Browserfall: R58-Gegenprobe mit neuem Schlüssel
`/basis.ngc#4501:0,0,20`; der Pending-Zustand muss nun sichtbar bleiben,
und die fremde Datei muss auf den eigenen Payload-Start zurückführen.
Resultate `browser.json`, Bild `pending-basis.png`.

Zweiter Browserfall: Rückkehr zur Startbasis, bevor die zurückgehaltene
echte Worker-Antwort zugestellt wird. Nur die Zustellung wird verzögert,
keine Geometrie und kein Produktzustand ersetzt. Die absichtlich den
Fehler bestätigenden Assertions zeigen die Oberkante bei −20 statt −10,
ohne Prüfhinweis. Resultate `return-browser.json`, Bild `obsolete-reply.png`.
Der weitere Statusframe behebt den Zustand nicht.

## Ergebnisse

- Build PASS (`build.txt`).
- Backend 32/32 (`backend-tests.txt`): `test_start_tlo_worker`,
  `TestStartTloSeed`, `TestComparePreviewPayloads`, `TestStartDrift`,
  `TestPercentDelimiter`, `TestCanonInitPhase`.
- Frontend 64/64 (`frontend-tests.txt`): 62 vorhandene Tests plus die beiden
  eigenen Sonden; letztere unterscheiden Abnahme und Fehlernachweis wie oben.
- Browserdiagnosen 2/2 (`browser.txt`), davon ein Fehlernachweis.
- Vier native Offline-Parses. Keine Wiederholung des vollständigen Gates
  oder der Live-Abnahme.
