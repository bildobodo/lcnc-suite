# R132 · Codex · Prüfprotokoll

Geprüfter Code: `fix/start-dep`, `0d75dcf9..9bb093de7a735740f9bf1e79e95ba31492aa94e8`, als `git archive` in `/tmp/codex-r132-p13455hz/src`. Plan: `parity-ef.plan.md`, Fassung 7, aus dem aktuellen Review-Zweig. Live-HEAD beim Beginn: `fd1aef8aefd3c07f22cf206cacb8912b57a9f7d0`. Kein Checkout oder Build im Live-Baum, keine Zugriffe auf Live-Ports, keine Maschinenbefehle.

## Bestandstests

Aus `ARCHIVE/lcnc-gateway`, mit der vorhandenen virtuellen Python-Umgebung:

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_start_dep_worker.py test_tool_change_motion_worker.py test_m600_preview_worker.py test_start_tlo_worker.py
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -q test_gateway_util.py
```

Beide Läufe Exit 0. 138 + 425 = **563 gesammelte Testfunktionen PASS**. Die Collection ist mitprotokolliert; nicht die durch `unittest`-Unterfälle höhere JUnit-Aggregatzahl als Testfunktionszahl verwendet. Die vier nativen/Canon-Dateien enthalten auch die 46 neuen E-Tests, die realen Suite-Bindungskontrollen und die bestehenden M600-/Werkzeugwechseltests. Claudes gesamtes Backend-Gate und Mutationen wurden gelesen, nicht als eigener Lauf ausgegeben. Keine Frontend- oder Parity-Abnahme für dieses noch ungemergte Backend-Paket.

## Eigene Proben

```sh
nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python viewer-palette-fest.r132.codex-audit.py ARCHIVE > audit.json
python3 viewer-palette-fest.r132.codex-contracts.py audit.json > contracts.json
```

`ARCHIVE` ist die Wurzel des aus `9bb093de` exportierten Repositories. Der erste Lauf endet mit 0, der zweite am geprüften Stand **absichtlich mit 1**: 22 Bedingungen PASS, 11 Vertragsbedingungen FAIL, gruppiert in fünf Befunde. Die JSON-Dateien enthalten vollständige Programme, Zusatzkonfiguration, native Payload-Felder und beobachtete Canon-Zustände vor/nach Rückrufen. Keine erwarteten Befunde aus bloßen Suchtreffern.

- **17 getrennte native Prozesse** über den vorhandenen `native_start_probe.py`: synthetischer STAT, private INI/Parameterdatei/Werkzeugtabelle und privates Tool-Mapping, `linuxcnc.command` wirft. Das Harness wird im Speicher um Fälle und beobachtende Wrapper ergänzt; keine Produktdatei wird verändert. Alle 17 liefern keinen Parsefehler; das private Tool-Mapping bleibt jeweils unverändert.
- VP-I78: sechs echte Eingaben mit Positionslesung vor dem ersten Programmrückruf; darunter `#5420`, `#<_x>`, `%`, Leerzeile und modaler Vorspann. Alle sechs vermissen die vereinbarte `position_read`-Kennzeichnung. Die Lesung direkt im ersten Bewegungssatz wird dagegen erkannt.
- VP-I79: frühes M6 mit `TOOL_CHANGE_POSITION`, mit/ohne vorangehendes `G53 Z0`. Native Beobachtung: `dep ∩ stale` bleibt nicht leer, die folgenden G91-Endpunkte tragen weiter Startmasken. Kontrollen ohne Wechselposition und mit erst nach bekannten XYZ ausgeführtem M6 verhalten sich verschieden wie vorgesehen.
- VP-I80: ausdrücklich **Fehlerinjektion** `interp() = None`/`interp_this() = None`, sonst echter Worker und nativer Parser. Trace meldet den Ausfall, Draht behandelt die folgenden Koordinaten trotzdem als bekannte Werte. Das ist kein Nachweis, dass das Modul auf der Live-Sim fehlt.
- VP-I81: echter nativer Parse mit Kontext `kins_type: null` und deklarierter `xyzac-trt-kins sparm=identityfirst`, ohne HAL. Zeigt die falsche Worker-Zulassung trotz unbekannten aktuellen Typs; kein Beleg eines real gefahrenen TCP-Wegs.
- VP-I82: ausdrücklich **abweichende Rückruffolge**: das Harness reicht den zweiten nativen G28-Traverse als `straight_feed` an den unveränderten Canon weiter. Damit wird E10 Nr. 17 isoliert geprüft. Der normale native G28-Fall mit zwei Traverses ist die positive Kontrolle. Kein Anspruch, der native Standardinterpreter erzeuge diesen Vorschub von sich aus.

## Quellprüfung

Am geprüften Commit: `gcode_canon.py:565–593` (Walk vor Initialisierung), `:633` (fehlendes Interpreter-Modul), `:805–807` (M6 und dep), `:1022–1041` (Bereich und G28/G30), `:1110`/`:1156` (gleicher Motion-Tag für Traverse/Feed); `gcode_parse_worker.py:308` (None → 0), `:477–482` (nur Trace). Kontextweg für ein echtes unbekanntes `kins_type`: `gateway.py:860–869` → `bulk_pipeline.py:728–738`.

Zusätzlich gelesen: Drahtpräfixe und RDP-Anker, Limitmaskierung, `start_believed`-Normalisierung, Quellenpins/Codeobjektbindung/Hook-Bewertung und Routine-Marken. Die möglichen Namensbindungen im tatsächlich festgehaltenen Suite-Aufrufgraphen wurden geprüft; keine zusätzliche belegte Bindungslücke daraus gemeldet.

Review und neue Belege werden ausschließlich unter `docs/reviews/` abgelegt. Vorheriger Review-Inhalt wird per Länge und SHA256 geprüft und unverändert erhalten. Handshake erst nach dem Anhang.
