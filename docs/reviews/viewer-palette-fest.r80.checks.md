# R80 — Prüfprotokoll

Geprüft `e73d0676..2f9da82a`, Anfrage in `b70a0867`, 2026-10-06.
Archivkopie: `/tmp/codex-r80-1l7jv8mb/archive`.

## Herkunft und Isolation

Exportiert aus `git archive 2f9da82a`: `lcnc-webui`, `test-fixtures`,
`scripts/test_fixtures`, `examples/sim_config/machine-5axis-xyzac`.
Vorhandene Node-Abhängigkeiten sind einzeln verlinkt, ohne Cache-Verzeichnisse.
414 WebUI-Dateien stimmen mit Git überein; nur `e2e/ctl.ts` wurde für den
eigenen Mock auf `127.0.0.1:4188` umgestellt (`isolation.patch`).

Der in R79 gebaute Produktionsstand `3954401` wird wiederverwendet. Git weist
seitdem innerhalb von `lcnc-webui` ausschließlich die Änderung an
`e2e/sim-panel.viewer.spec.ts` aus. Alle 26 Dateien des übernommenen Bundles
wurden gegen die R79-Hashliste geprüft; siehe `context.json` und
`dist-sha256.json`. Kein neuer Build, keine neuen Unit-Tests, kein vollständiges
Offline-Gate. Die korrigierten beiden Browsertests wurden aus dem aktuellen
Commit ohne Änderungen ausgeführt.

Ein Worker, `nice -n 19`, keine Live-Ports und kein LinuxCNC/HAL. Alle
simulierten Befehle gehen an den eigenen Mock. Keine Produktänderung,
keine Veränderung bisheriger Belege.

## Prüfungen

Je Browser drei bestandene Fälle, Chromium und Firefox:

1. Neue unabhängige Gegenprobe: Power-Status Ein → Aus → Ein, erwarteter
   exakter Buttonname sichtbar und genau einmal vorhanden, entgegengesetzter
   Name nicht vorhanden. Die alten Textbedingungen bestehen weiterhin beide;
   der neue Test fällt daher nicht auf dieselbe Mehrdeutigkeit zurück.
2. Aktueller Tastaturtest: Pfeilnavigation bleibt lokal, Enter bei Maschine
   ON erklärt den Grund, nach OFF zeigt Enter den Befund.
3. Aktueller Fokuswechseltest: Zeilenersatz und leere gefilterte Liste behalten
   den Fokus im Panel; bei nachgewiesener Pfeil-Jog-Belegung kein Jog.

Die JSON-Dateien enthalten die drei Zustände; die Protokolle die beiden
unverändert ausgeführten Tests und die zusätzliche Gegenprobe. Alle neuen
Belege sind in `sha256.json` erfasst, außer der Hashliste selbst.

## Wiederholung

Archivkopie und Abhängigkeiten wie oben bereitstellen, `isolation.patch`
anwenden und den unveränderten R79-Build unter `lcnc-webui/dist/` bereitstellen
(alternativ vor Einfügen der Sonde neu bauen). `evidence/` neben `lcnc-webui/`
anlegen. Belegdateien kopieren als:

- `power-state.spec.ts` → `lcnc-webui/e2e/r80.power-state.spec.ts`
- `chromium.config.ts` → `lcnc-webui/r80.chromium.config.ts`
- `firefox.config.ts` → `lcnc-webui/r80.firefox.config.ts`

Aus `lcnc-webui/`, nacheinander, Port 4188 frei:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r80.chromium.config.ts --grep 'rows. keys|a result change|R80:'
env R80_BROWSER=firefox nice -n 19 node node_modules/@playwright/test/cli.js test --config r80.firefox.config.ts --grep 'rows. keys|a result change|R80:'
```

Keine neue Live-, Mac- oder Geräteabnahme; Agreement für den geprüften Umfang.
