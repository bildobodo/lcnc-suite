# Codex R126 — Prüfung der Umsetzung F

Stand `cf432355b1d0a291de9eb0011eaccb6379d2a102`, Basis `b8c4e96a`, 10.10.2026.
Ausführung ausschließlich in `/tmp/codex-r126-31qqwza2`, einer Archivkopie. Keine Live-Ports, kein HAL, keine Maschinenbefehle, kein Suite-Stopp. Native Parses benutzen die synthetische STAT/INI/Parameterdatei und private Tool-Mmap von `native_start_probe.py`; `linuxcnc.command` ist dort verboten. Die drei veröffentlichten nativen Parses sind vollständig und verändern ihre Tool-Mmap nicht.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Bestehende Backend-/Parity-Tests | 482 bestanden: `test_gateway_util` 425, `test_m600_preview_worker` 46, `test_tool_touch_off_paths` 7, `test_parity_compare` 4 |
| Bestehende Client-Tests | 231 bestanden in sieben Dateien |
| Eigene Kontakt-Proben | 4 rote Regressionswächter: drei kleine Geometriefälle, ein nativer Payload mit synthetischen Körpern |
| Eigene Hinweis-Proben | 2 rote Regressionswächter: unbekannte Zeile und wiederholte native Aufrufzeile |
| Native Payload → Dekodierung → Spur → Slice → Sim-Zeile | 1 grüne Kontrolle |
| Tatsächlicher `simDump` → `compare_files`, synthetische Referenz | 601 Proben, 67 im Band; keine Markierung nach Bandende; Abdeckung grün, Entfernen der Bandmarkierung rot |
| Aktive externe Z-Versätze | Statischer Vertragsbefund VP-I76; kein Lauf-/HAL-Experiment |

Die sechs roten eigenen Tests scheitern an den im Review genannten Ergebnissen, nicht an Importen oder Parsefehlern. Ein zwischenzeitlich mit leerer Parameterbasis gestarteter Schleifenversuch war als Beleg unbrauchbar; die endgültige Sonde verwendet die reguläre `_m600`-Basis (`None`, nicht `{}`), prüft zwei Längenereignisse und scheitert erst an der fehlenden Warnung. Nur die endgültigen Ausgaben sind beigefügt.

## Wiederholung in einer separaten Archivkopie

Archiv von `cf432355` anlegen. Abhängigkeiten wie für die Repository-Tests bereitstellen; hier wurde das bereits installierte `node_modules` eingebunden und `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python` verwendet. Nicht im Live-Baum ausführen.

Die beigefügten Dateien folgendermaßen in die **Archivkopie** kopieren (Präfix jeweils `viewer-palette-fest.r126.codex-`):

| Beleg-Suffix | Ziel relativ zur Archivwurzel |
|---|---|
| `contact.test.ts` | `lcnc-webui/src/viewer/r126.codex.test.ts` |
| `native-contact.test.ts` | `lcnc-webui/src/viewer/r126.native-contact.codex.test.ts` |
| `notes.test.ts` | `lcnc-webui/src/viewer/r126.notes.codex.test.ts` |
| `chain.test.ts` | `lcnc-webui/src/viewer/r126.chain.codex.test.ts` |
| `native.py` | `lcnc-gateway/r126.codex-native.py` |
| `parity.py` | `r126.codex-parity.py` |
| `truth-header.ndjson` | `lcnc-webui/r126.truth-header.ndjson` |
| `band.msgpack` | `r126.m600-band.msgpack` |
| `exit.msgpack` | `r126.exit.msgpack` |
| `loop.msgpack` | `r126.loop.msgpack` |

Die Payloads können stattdessen neu erzeugt werden. Aus `lcnc-gateway` der Kopie, mit einem Python mit den nativen LinuxCNC-Modulen:

```sh
nice -n 19 python3 native_start_probe.py m600_band ../r126.m600-band.msgpack
nice -n 19 python3 r126.codex-native.py r126_exit_rapid ../r126.exit.msgpack
nice -n 19 python3 r126.codex-native.py r126_loop_band ../r126.loop.msgpack
```

Aus `lcnc-webui` der Kopie:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run src/viewer/r126.codex.test.ts src/viewer/r126.native-contact.codex.test.ts src/viewer/r126.notes.codex.test.ts src/viewer/r126.chain.codex.test.ts --maxWorkers=1
nice -n 19 node scripts/runSimDump.mjs ../r126.m600-band.msgpack r126.truth-header.ndjson ../r126.dump.jsonl --no-entry
```

Der erste Aufruf muss am geprüften Stand Exit 1 liefern: sechs rot, eine grün. Er erzeugt die einzelnen Ergebnis-JSONs in der Archivwurzel. Aus dieser Wurzel anschließend:

```sh
nice -n 19 python3 r126.codex-parity.py .
```

Die Parity-Kontrolle schneidet allein den Bremsschenkel der synthetischen Referenz bei Z −102,13 ab. Wahrheit → Sim und Sim → Wahrheit außerhalb des Bands sind dann jeweils 0; der Hüllenüberschuss ist rund 0,714 mm. Ohne Bandmarkierung schlägt derselbe Vergleich bei Toleranz 0,5 fehl. Das ist ein Test der Exportmarkierung und Vergleichsrichtung, **keine gemessene Bremsstrecke, keine F5-Messreihe und keine Live-Parity-Abnahme**.

Bestehende Prüfungen, aus `lcnc-gateway` bzw. `lcnc-webui`:

```sh
nice -n 19 python3 -m pytest -q -p no:cacheprovider test_m600_preview_worker.py test_tool_touch_off_paths.py test_gateway_util.py ../scripts/test_parity_compare.py
```

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run src/viewer/collision.test.ts src/viewer/probeStop.test.ts src/viewer/scrubTrack.test.ts src/viewer/simRows.test.ts src/viewer/collisionMarks.test.ts src/previewDecode.test.ts src/viewer/sweepMerge.test.ts --maxWorkers=1
```

## Statischer Nachweis VP-I76

- Vertrag: `docs/reviews/parity-ef.plan.md:331` und Wächter F7 Nr. 8, Zeile 386.
- `src/viewer/checkBasis.ts:12–37`: weder im Ergebnis-Snapshot noch in den Live-Eingängen ein externer Z-Versatz/Freigabestatus; entsprechend fehlen sie in `basisFromLive`, `basisFromRun`, `sameCheckInputs`.
- `src/ThreeViewer.vue:3423–3430`: Übergabe der Bremsbänder und nicht vorhergesagten Messungen an den Sweep, kein eoffset-Zustand oder darauf gestützter Grund.
- `src/ThreeViewer.vue:4601,5077`: der vorhandene „Comp Z“-HUD-Hinweis liest den Live-Status und ist nur bei `eoffset_enabled` sichtbar. Er erklärt weder die Modellgrenze des Prüfergebnisses noch einen verbleibenden Versatz bei deaktivierter Freigabe.
- `gateway_util.py:4167`: die neuen Probe-Gründe sind `retract`, `slow_limit`, `brake_unknown`. Ein allgemeiner „slower input“-Hinweis ersetzt den versprochenen Grund „external offset“ nicht.

Die vollständigen Resultate und nativen Ausgaben liegen in `codex-results.json` und `codex-native-results.json`; Quellhashes und Testzahlen in `codex-context.json`. Der Review-Anhang enthält Auswirkungen und Korrekturziele. Keine Browsermessung war für diese Logik-/Vertragsbefunde nötig; Claudes gesamtes Gate wurde nicht wiederholt.
