# R41 — unabhängige Nachprüfung

Stand `e4921e7`, Archiv `/tmp/codex-r41-mpjm39qb`. Ausschließlich künstliches STAT,
Mock `127.0.0.1:4188`, echte Offline-Interpreter-/Worker-Logik und lokale Modelle.
Keine Zugriffe auf Live-Ports, keine Maschinenbefehle, kein Produktcode geändert.

## Backend und Wiederholung R40

Gateway-Python mit nativen LinuxCNC-Modulen:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  midrun-tool-reparse.r41.worker-probe.py /path/to/archive
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  midrun-tool-reparse.r41.refusal-probe.py /path/to/archive
```

Die Worker-Probe ist eine Kopie der unveränderten R40-Evidenz mit drei Anpassungen:
Runden-/Commitnamen, Erfassen des neuen `__PARAMS__`-Markers, dessen `text`/`g92`
nach dem ersten Parse in `param_text`/`g92_offset` zurückgeben. Die vier fachlichen
Gleichheitsbedingungen bleiben unverändert und sind jetzt alle TRUE. Block Delete
bleibt wie dokumentiert live. Eigene INI/Parameterdateien in /tmp, `linuxcnc.stat`
vor Worker-Import ersetzt, `linuxcnc.command` ausdrücklich verboten.

Die zweite Probe verwendet die produktive `BulkPipeline`, den Tabellenvergleich
und die Midrun-Zulassung; nur der Worker-Ausgang ist durch den dokumentierten
Exitcode 4 ersetzt. Nach dem zuvor veröffentlichten Payload ändert sich T2 von
Z80 auf Z90, T1 bleibt geladen und Z10. Während des Auftrags existiert
`preview_refresh`; nach der Ablehnung ist es null, die Revision bleibt dieselbe,
`pin_unsupported` ist true und die nächste Midrun-Zulassung false. Das JSON wird
von der Browsersonde als Quelle der Statuswerte verwendet.

Gezielte Bestandstests in `lcnc-gateway`:

```sh
env LCNC_LOG_DIR=/tmp/r41-logs nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -B \
  -m unittest test_bulk_pipeline test_gateway_util test_pinned_worker
```

415 PASS, einschließlich der vier nativen Testmethoden mit elf Prüfbedingungen;
kein Skip. Build (`vue-tsc -b`, Vite): PASS, übliche Chunkgrößenwarnung.

## Browser

Archiv bauen. Vorhandene node_modules dürfen verlinkt werden; Build-Info-Dateien
(`tsconfig*.json`) und Vite-Cache müssen im Archiv liegen. `e2e/ctl.ts` auf
`127.0.0.1:4188` umstellen. Sonde als `e2e/r41.spec.ts`, beiliegende Playwright-
Konfiguration ins UI-Verzeichnis kopieren; `evidence/` neben `lcnc-webui` anlegen.
Das Ergebnis der Pipeline-Probe dort als
`midrun-tool-reparse.r41.refusal-probe.json` ablegen.

```sh
env MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
nice -n 19 node node_modules/@playwright/test/cli.js test \
  --config midrun-tool-reparse.r41.playwright.config.ts r41.spec.ts
```

Test 1 wiederholt R40 mit unveränderten Assertions (nur Runden-/Dateinamen
angepasst): echte XYZAC-STLs, zunächst zwei Kollisionsbefunde, neuer Payload
während RUNNING, danach IDLE ohne weiteren Publish. **PASS**; die zwei Befunde
kehren automatisch zurück, Position/Zeile folgen weiterhin, keine Mock-Befehle.

Test 2 verwendet einen kleinen synthetischen Preview und die Statuswerte der
Pipeline-Probe. Materialfarbe Feed: frisch `#00a83c`, während Parse `#cccecf`,
nach Ablehnung wieder `#00a83c`. Keine HUD-Warnung. **ROT** an der Schlussassertion,
dass der unveränderte alte Payload nicht wieder als frisch erscheinen darf.
Das ist MR-I04. Der Screenshot entstand nach der Ablehnung; der Worker-Exit
wurde nicht an einer Live-Maschine ausgelöst.

Alle Prüfungen niedrig priorisiert; ein Browser-Worker. Browser und Mock beendet.
Die Zahlenfeldtests aus R40 wurden nicht wiederholt, da deren Produktcode in
R41 unverändert blieb. Kein vollständiges Offline-Gate und keine Live-Lastmessung.
