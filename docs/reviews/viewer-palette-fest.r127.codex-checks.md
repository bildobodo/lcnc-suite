# Codex R127 — Nachprüfung VP-I74 bis VP-I76 und Modell nach F5

Stand `02746e3048783f2ee8aca7901653a28c3513e849`, Basis `c69567b8`, 10.10.2026.
Archivkopie `/tmp/codex-r127-6b1sqve4`. Keine Ausführung im Live-Baum, keine Live-Ports, keine Maschinenbefehle oder HAL-Abfragen. Insbesondere wurde Claudes F5-Skript **nicht ausgeführt**: nur Skript und Messprotokoll gelesen und die Zahlen nachgerechnet.

## Ergebnisse und Grenzen

- Client-Hauptlauf: 144 bestanden in sieben Dateien. Enthält die unveränderten drei kleinen Kontaktproben und zwei Hinweisproben aus R126 sowie die neue Prüfung der Versatznotiz über Leerlauf-/Laufbasis, Sweep und Ergebniszusammenführung.
- Frisch erzeugte native Payloads: drei vollständige Parses (`band`, `exit`, `loop`), private Tool-Mmap unverändert. Zwei Hinweisprüfungen und eine Band-/Folgezeilenprüfung bestehen damit. Die erwartete Tiefe der R126-Kettenprobe wurde ausschließlich von −102,8444 auf −102,9111 geändert; Dateinamen angepasst.
- Backend: 46 Tests `test_m600_preview_worker`, 7 Tests `test_tool_touch_off_paths` bestanden. Der bestehende Start-Snapshot-Test besteht separat.
- Ein vorheriger breiter Lauf einschließlich ganz `test_command_dispatch.py` wurde nach ausbleibendem Fortschritt per Ctrl-C beendet (Exit 130). Er wird **nicht** als bestanden gezählt. Danach nur die betroffene Snapshot-Prüfung und die oben genannten Routineprüfungen ausgeführt. Kein Nachweis eines Produktfehlers aus dem unterbrochenen Lauf.
- F5-Rechnung: alle 42 veröffentlichten Fälle stimmen mit `4*v*T + v²/a` für T = 1 ms und den angegebenen Beschleunigungsanteilen überein, innerhalb der Rundung der Tabelle. Alle berichteten Abstände positiv; Minimum 0,0012 mm. Das prüft die vorgelegten Zahlen, nicht erneut den Maschinenlauf.
- Statische F5-Lücke: `SUB` enthält eine einzelne G38.3, keinen schnellen/langsamen Doppelablauf. HAL-Lesungen im Skript betreffen nur die drei Plattenkoordinaten. Freigabe, manueller Eingang, externer Versatz und Vergleich mit #3100–#3102 werden nicht als Messbasis aufgezeichnet. Siehe VP-I77 im Review.

## Korrektur zur nativen R126-Kontaktprobe

Die unveränderte `r126.native-contact.codex.test.ts` bleibt am alten Payload rot, ebenso die beigefügte Variante mit frisch erzeugter R127-Payload. Das ist **kein verbleibender VP-I74-Beweis**. Eine temporäre Instrumentierung von `noteQuery` in der Archivkopie zeigt den ersten gewöhnlichen Beginn bei L583, Vorschub, Abstand rund 1,965 innerhalb der Prüfzone von 2 mm, **außerhalb** des Bands. Der Testkörper begegnet dem Werkzeug nach G43 auf dem gewöhnlichen Rückzug erneut. Bis zur späteren Eilgangbewegung wird die Trennschwelle 4 mm nicht überschritten. Der Beginn stammt damit aus einem gewöhnlichen Vorschubkontakt; das Urteil folgt der bestehenden Schnittregel.

Die Annahme der alten Probe, ihr Bodenkörper werde ausschließlich vom Hüllenschenkel erreicht, war unzutreffend. Der Review zieht diese zusätzliche R126-Beweisführung ausdrücklich zurück. Die drei kleinen Kontaktproben bleiben gültig: in R126 rot, jetzt grün.

`codex-trace.py` fügt nur in der Archivkopie einen Diagnoseeintrag ein, führt die Sonde aus und stellt `collision.ts` im `finally` bytegleich wieder her. `codex-trace.json` protokolliert Abfragen innerhalb der Prüfzone ohne vorherigen sicheren Kontakt. Der eine Eintrag mit `inBand:false` belegt die korrigierte Einordnung. Die originale Produktdatei der Archivkopie wurde anschließend gegen `git show 02746e30:…` geprüft; Quellhash im Kontext.

## Reproduktion

Archiv von `02746e30` verwenden, installierte Abhängigkeiten bereitstellen. Alle folgenden Arbeiten ausschließlich dort.

Aus den R126-Belegen kopieren:

- `viewer-palette-fest.r126.codex-contact.test.ts` → `lcnc-webui/src/viewer/r126.codex.test.ts`
- `viewer-palette-fest.r126.codex-notes.test.ts` → `lcnc-webui/src/viewer/r126.notes.codex.test.ts`
- `viewer-palette-fest.r126.codex-loop.msgpack` → `r126.loop.msgpack`
- `viewer-palette-fest.r126.codex-native.py` → `lcnc-gateway/r126.codex-native.py`

Aus den neuen Belegen (Präfix `viewer-palette-fest.r127.codex-`) kopieren:

| Suffix | Ziel |
|---|---|
| `offset.test.ts` | `lcnc-webui/src/viewer/r127.offset.codex.test.ts` |
| `notes.test.ts` | `lcnc-webui/src/viewer/r127.notes.codex.test.ts` |
| `chain.test.ts` | `lcnc-webui/src/viewer/r127.chain.codex.test.ts` |
| `native-contact.test.ts` | `lcnc-webui/src/viewer/r127.native-contact.codex.test.ts` |
| `band.msgpack` / `loop.msgpack` / `exit.msgpack` | `r127.band.msgpack` / `r127.loop.msgpack` / `r127.exit.msgpack` |
| `f5-audit.py` | `r127.audit-f5.py` |
| `trace.py` | `r127.trace.py` |

Aus `lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run src/viewer/r126.codex.test.ts src/viewer/r126.notes.codex.test.ts src/viewer/r127.offset.codex.test.ts src/viewer/checkBasis.test.ts src/viewer/collision.test.ts src/viewer/probeStop.test.ts src/viewer/sweepMerge.test.ts --maxWorkers=1
nice -n 19 node node_modules/vitest/vitest.mjs run src/viewer/r127.notes.codex.test.ts src/viewer/r127.chain.codex.test.ts --maxWorkers=1
```

Aus `lcnc-gateway`, mit Python samt nativen LinuxCNC-Modulen (hier `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python`):

```sh
nice -n 19 python3 native_start_probe.py m600_band ../r127.band.msgpack
nice -n 19 python3 r126.codex-native.py r126_loop_band ../r127.loop.msgpack
nice -n 19 python3 r126.codex-native.py r126_exit_rapid ../r127.exit.msgpack
nice -n 19 python3 -m pytest -q -p no:cacheprovider test_m600_preview_worker.py test_tool_touch_off_paths.py
nice -n 19 python3 -m pytest -q -p no:cacheprovider test_command_dispatch.py -k the_start_snapshot_reads_like_the_status
```

Aus der Archivwurzel:

```sh
python3 r127.audit-f5.py
python3 r127.trace.py
```

Der Diagnoseaufruf meldet den erwarteten Exit 1 der zurückgezogenen nativen Probe; er ist kein Akzeptanzwächter. Die F5-Auswertung importiert und startet kein Maschinenwerkzeug, sondern liest nur AST und Text.

Die Artefakte enthalten Ausgaben aller genannten Prüfungen und Quellhashes. Bestehende Belege wurden nicht verändert. Kein vollständiger Wiederholungslauf von Claudes Gate und keine eigene Live-Parity-Abnahme.
