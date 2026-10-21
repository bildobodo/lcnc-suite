# R178 · Codex · Reproduktion

Review `e8bc45fe..941dfe8e`, `feat/step4-p2b`, 21.10.2026. Ausführung in `/tmp/codex-r178-ioh_c9ie/repo`, niedrig priorisiert. Keine Live-Ports oder Maschinenbefehle.

## Archiv und Abhängigkeiten

`git archive 941dfe8e` in ein eigenes Verzeichnis entpacken; `lcnc-webui/node_modules` als eigene Kopie aus `/home/cnc/lcnc-suite-p2/lcnc-webui/node_modules` übernehmen (`cp -a --reflink=auto`). Keine schreibbare Verknüpfung auf fremde Abhängigkeiten. 479 verfolgte Dateien unter `lcnc-webui/src`, `lcnc-gateway` sowie `CLAUDE.md` mit dem Review-Kopf verglichen, STL-Dateien gegen ihre LFS-SHA256.

## Repository-Prüfungen

Im archivierten `lcnc-webui`:

```sh
nice -n 10 npm run build
nice -n 10 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/viewer/limitPlaces.test.ts src/viewer/limitOriginPayloads.test.ts src/viewer/scrubTrack.test.ts src/viewer/simRows.test.ts src/viewer/probeStop.test.ts src/viewer/toolChangePayloads.test.ts src/viewer/simWindow.test.ts --reporter=json --outputFile=/tmp/codex-r178-ioh_c9ie/unit.json
```

158/158 grün. Diese Vitest-Version unterstützt `--minWorkers` nicht; die oben verwendete Korrektur nutzt allein `--maxWorkers=1`.

Im archivierten `lcnc-gateway`:

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest test_gateway_util.py test_limit_origin_worker.py test_preview_poll_chain.py -q --junitxml=/tmp/codex-r178-ioh_c9ie/backend.xml
```

448 Tests plus 1914 Untertests grün (2362 JUnit-Fälle). Darunter alle neun nativen Herkunftsfälle und der neue Poller-Wächter. Venv nur als Interpreter gelesen; Quellen und Tests laufen aus dem Archiv, `gateway.py` wird vom Poller-Wächter nicht importiert.

## Native eigene Payloads

- Bestehenden Beleg `viewer-palette-fest.r177.codex-native.py` unverändert als `lcnc-gateway/r178_r177_native.py` kopieren.
- Neuen Beleg `viewer-palette-fest.r178.codex-cap-native.py` als `lcnc-gateway/r178_codex_native.py` kopieren. Er ist `native_start_probe.py` von diesem Kopf plus ein neuer Fall: `lim_loop_site` mit 40 statt zwei Wiederholungen. Keine Produktquelle geändert.

Im archivierten `lcnc-gateway`:

```sh
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r178_r177_native.py r177_foreign_limit /tmp/codex-r178-ioh_c9ie/native.msgpack > /tmp/codex-r178-ioh_c9ie/native.json
nice -n 10 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python r178_codex_native.py r178_cap /tmp/codex-r178-ioh_c9ie/cap.msgpack > /tmp/codex-r178-ioh_c9ie/cap-native.json
```

Echter nativer Offline-Interpreter und Worker, temporäre INI/Parameter/Werkzeugtabelle, synthetischer STAT; `linuxcnc.command` wirft. Beide Parses erfolgreich und Werkzeug-mmap unverändert. Originalfall: `sub=r177_child`, `site=3`, `runs=[[4,4]]`. Schleife: 40 Außenpunkte, 40 Abschnitte, davon 32 gesendet. Beide Payloads liegen unverändert als neue Belege vor.

## Browseraufbau

Belege `codex-viewer.spec.ts`, `codex-browser.config.ts`, `codex-own-browser.config.ts` nach `lcnc-webui/e2e/r178.codex.viewer.spec.ts`, `lcnc-webui/playwright.r178.config.ts`, `lcnc-webui/playwright.r178-own.config.ts` kopieren (gemeinsames Präfix `viewer-palette-fest.r178.`). Bei anderem Ausgabeverzeichnis `/tmp/codex-r178-ioh_c9ie` in den Kopien ersetzen.

Nur in der Archivkopie:

- Beide URLs in `e2e/ctl.ts`: `127.0.0.1:4188` (HTTP und WS).
- `e2e/mock-gateway.mjs`: `server.listen(PORT, '127.0.0.1', callback)` statt des variablen Hosts.
- Konfiguration: eigener Mock `MOCK_PORT=4188`, kein `reuseExistingServer`, ein Chromium-Worker, Trace aus. Der Mock liefert den Archiv-Build. Lokale Listener-Ausführung wurde genehmigt.

Im archivierten `lcnc-webui`:

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r178.config.ts sim-panel.viewer.spec.ts -g 'a limit row stands|the summary names|a new result keeps|the timeline:|the list is the timeline'
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.r178-own.config.ts r178.codex.viewer.spec.ts
```

Fünf Repository-Browserfälle grün. Die eigene Spec hat vier Fälle:

1. **Legacy, rot:** exakt der gespeicherte R177-Payload vom damaligen Worker. Sie liest ihn nur als Datei aus `docs/reviews/viewer-palette-fest.r177.codex-native.msgpack`; alternativ den neuen identischen Beleg `codex-legacy.msgpack` verwenden und diesen Dateipfad in der Sondenkopie ersetzen. Sim: Ort unbekannt. Program: Warnmarke auf sicherer L5 `G1 X30`.
2. **Unmarkierte Routine, rot:** der neue Repository-Payload `lim_unmarked.msgpack`. Sim: „no line of this program“. Program: Warnmarke auf Kommentar-L5. Der frisch erzeugte gleichartige native Fall gehört zusätzlich zu den neun Backend-Tests.
3. **Originalfall, grün:** eigener nativer Payload vom neuen Kopf. Sim zeigt L3 bei 00:06, Sprung `cum=6.001`, Code-Marke auf L3. Die Assertion wartet auf die Diagnoseposition.
4. **40 Wiederholungen, rot:** eigener nativer Payload, 32 DOM-Bänder, eine gruppierte Zeile, kein Hinweis auf die acht ausgelassenen Abschnitte in Zeile oder Summary-Hilfe. Die rote Assertion prüft die fehlende Offenlegung, nicht eine bestimmte Gestaltung. Kollisionsprüfung und ihre wechselnde Statusmeldung sind unabhängig von diesem fertigen Soft-Limit-Payload.

Die JSON-Messwerte und Bilder werden vor der roten Assertion gespeichert. Keine Produktänderungen, keine Verwendung der laufenden Suite. Bereits vorhandene Belege unverändert; neue Belege mit eigenen Namen. Vollständiges Gate, historische Mutationen und Browser-PC-Messung nicht wiederholt.
