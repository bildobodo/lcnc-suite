# R40 — Reproduktion und Grenzen

Review-Stand: `306226a64e14357f3568011dc05dcab63151a878` (`fd36324..306226a`).
Isoliertes Archiv: `/tmp/codex-r40-y7evrp6f`. Keine Produktänderung im Live-Checkout,
keine Zugriffe auf die Live-Ports und keine Maschinenbefehle.

## Native Worker-Probe

`midrun-tool-reparse.r40.worker-probe.py ARCHIVROOT` mit dem Gateway-Python ausführen.
Die Probe setzt `INI_FILE_NAME`, `LCNC_INI_FILE`, `LCNC_LOG_DIR` auf eigene Temp-Dateien,
ersetzt `linuxcnc.stat` vor dem Worker-Import durch ein künstliches Objekt und
verbietet `linuxcnc.command`. `gcode.parse` und der gesamte produktive Parse-Worker
bleiben echt. Keine laufende LinuxCNC-Instanz wird benutzt. Alle sieben Parses
sind fehlerfrei; die vier Gleichheitsprüfungen im JSON sind erwartungsgemäß FALSE
und belegen MR-I01/MR-I02. Der Block-Delete-Vergleich inventarisiert einen weiteren
Live-Eingang, keine zusätzliche Abnahmeforderung.

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  docs/reviews/midrun-tool-reparse.r40.worker-probe.py /path/to/archive
```

Tool-Tabelle: T1 Z10, T2 Z80; Startkontext bleibt T1, angewandter Offset Z10.
Nur Spindeltasche 0 wechselt von T1 auf T2. `G43` ohne H liefert daraufhin
Z80 statt Z10, zwei Z-max-Befunde statt null; `__TLO__` meldet weiter den Start Z10/T1.
Die Parameterfälle variieren G92 X (0→100) und G30 X/#5181 (10→30) separat.
Alle 90 Fixture-Patches bleiben unverändert. Der letzte Fall variiert ausschließlich
`block_delete` und zeigt, dass auch diese Interpreter-Eingabe live bleibt.

## Browser-Probe

Archiv bauen; `node_modules` darf auf die vorhandenen Abhängigkeiten zeigen,
aber `tsconfig*.json`-Build-Info und Vite/Vitest-Cache müssen im Archiv liegen.
`e2e/ctl.ts` ausschließlich auf `127.0.0.1:4188` umstellen. Eigenen Mock starten:

```sh
env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
```

`midrun-tool-reparse.r40.browser-probe.ts` als `lcnc-webui/e2e/r40.spec.ts` kopieren;
`midrun-tool-reparse.r40.playwright.config.ts` ins UI-Verzeichnis kopieren.
`evidence/` neben `lcnc-webui/` anlegen. Mit einem Chromium-Worker ausführen:

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test \
  --config midrun-tool-reparse.r40.playwright.config.ts r40.spec.ts
```

Die Sonde nutzt die echten XYZAC-STLs, einen kleinen synthetischen Preview-Payload
und ausschließlich Mock-Status. Zuerst werden zwei Kollisionen erkannt. Derselbe
Payload wird bei `interp_state=2` neu veröffentlicht, danach folgt IDLE ohne
weitere Veröffentlichung. Der fehlende Neustart wird nach 2,5 s protokolliert.
Positivkontrolle: Derselbe Payload bei IDLE veröffentlicht liefert wieder zwei
Kollisionen. Die Schlussassertion ist auf dem Review-Stand absichtlich ROT
(MR-I03). Die Zeitleiste findet nach Veröffentlichung L6 bei Position 110 wieder;
kein Eintritt in Sim und keine Befehle im Mock-Log. Screenshot entstand nach IDLE,
vor der Positivkontrolle. `hits` im JSON zählt die vorhandenen Navigationsknöpfe;
die Befundanzahl (zwei) steht im mitprotokollierten Text.

Ein erster Sondenentwurf wartete versehentlich im Leerlauf auf `.codeLine.active`
und lief ins Timeout. Das wurde ausschließlich in der Sonde korrigiert
(`allTextContents`); der beigefügte Lauf erreicht alle Schritte einschließlich
Positivkontrolle und scheitert an der fachlichen Schlussassertion.

## Weitere Prüfungen

- `python -B -m unittest test_bulk_pipeline test_gateway_util`: 408 PASS.
  Der erste Sandbox-Lauf blieb beim asyncio-Threadtest stehen und wurde beendet;
  der isolierte Lauf außerhalb dieser Einschränkung dauerte 0,417 s.
- Vitest `src/useNumberKeypad.test.ts src/ws/statusStore.test.ts`: 35 PASS.
- `vue-tsc -b` und Vite-Produktionsbuild: PASS; übliche Chunkgrößenwarnung.
- `input-session.spec.ts`, Filter `number A|a click, double|Tab|Cancel|dialog|number.*touch|touch.*number|focus`:
  11 PASS, Chromium, inklusive echter Touch-Taps und 100/150-%-Portrait.
- Keine Lastprüfung am echten laufenden Controller, kein Safari-/iOS-Hardwaretest,
  keine unabhängige Wiederholung von Claudes Live-Protokoll.

Alle Ausführungen mit `nice 19`; Browser und Mock wurden nach der Prüfung beendet.
