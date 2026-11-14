# R367 · Codex · Prüfnachweis

Produkt `6cc51e64..47fd2c5b`, Anfrage an `51a2f07a`. Ausführung in einer frischen `git archive 47fd2c5b`-Kopie unter `/tmp/codex-r367`. Kein Produktcode geändert. Die fünf wesentlichen geprüften Produktdateien entsprechen bytegleich dem Commit ([Hashes und Zähler](vor-maschine.p3a.r367.codex-checks.json)). Im Live-Baum nur dieser Nachweis, die neuen Belege und der Review-Anhang; keine Live-Verbindung, kein nativer Maschinenbefehl.

## Ausführung

1. Gezielter Backend-Lauf: **915/915 PASS**, einschließlich der fünf unverändert übernommenen R366-Sonden. Venv `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv`, Arbeitsverzeichnis `/tmp/codex-r367/lcnc-gateway`, `LCNC_LOG_DIR=/tmp/codex-r367-logs`:

   ```text
   python3 -m pytest -q test_r366_codex.py test_payload_contract.py test_payload_scan.py test_command_policy.py test_command_dispatch.py test_g30.py test_toolsetter_rules.py test_feature_switches.py --junitxml=/tmp/r367-targeted.xml
   ```

   [Ausgabe](vor-maschine.p3a.r367.codex-tests.txt), [JUnit](vor-maschine.p3a.r367.codex-tests.xml). Die R366-Sonde modellierte noch die falsche Zahl 255; ihre Gegenfälle liegen nicht auf dieser Kante. Den korrekten 254/255-Vergleich prüfen in diesem Lauf die neuen Repository-Wächter. Die falsche Zahl aus R366 wird ausdrücklich berichtigt.

2. Eigene neue Dispatch-Sonde: **2 rot / 2 grün**. [Quelle](vor-maschine.p3a.r367.codex-wire.py) als `test_r367_codex.py` in derselben Archivkopie, Aufruf `python3 -m pytest -q test_r367_codex.py`. [Ausgabe](vor-maschine.p3a.r367.codex-wire.txt), [Befehle/Buchungen](vor-maschine.p3a.r367.codex-wire.json). Echte Schema-/Dispatch-/Schreibweglogik; LinuxCNC ist der Repository-Fake. `z_eoffset_enable=0`, frischer Reader und ein stabiler `z_eoffset` sind injiziert. Die Parameterdatei wird nicht geschrieben; Buchungen werden aufgezeichnet. Das ist kein nativer Nachweis dafür, dass beliebig große Koordinaten ausführbar wären, sondern ein Nachweis der zugesagten Ablehnung vor der ersten Schreibung.

3. Client: **5/5 PASS**. [Quelle](vor-maschine.p3a.r367.codex-client.cjs), [Ergebnis](vor-maschine.p3a.r367.codex-client.json). `node /tmp/r367-client.cjs /tmp/codex-r367` extrahiert `confirmToolChange` **und beide Konstanten aus der tatsächlichen App.vue** über den TypeScript-Parser. Timeout, Ablehnung, Annahme, inzwischen beendete Anforderung und inzwischen neuer Besitzer. Kontrollierte Promise-Auflösung, keine DOM-/Browserprüfung; die Status-Wächter werden hier durch die Änderung von `confirmSent` nachgestellt. Der gelesene neue Browser-Spec und sein Late-Timeout-Mutationsnachweis ergänzen diese Grenze; ich habe sie nicht erneut ausgeführt.

4. Neuer Live-Treiber: **zwei rote Zulassungsfälle**, vollständig offline. [Quelle](vor-maschine.p3a.r367.codex-live-target.py), [Ergebnis](vor-maschine.p3a.r367.codex-live-target.json). Aufruf mit der genannten Venv: `python3 /tmp/r367-live-target.py /tmp/codex-r367`. Vor dem Import ist `linuxcnc` durch ein reines Objekt ersetzt; auch WebSocket, Hintergrundtasks und Antworten sind ersetzt. Der echte `main`-, `Gateway.__aenter__`- und `cmd`-Pfad bleibt erhalten. Eine minimale Nicht-Sim-INI sowie eine vom gefälschten laufenden Controller abweichende INI erreichen jeweils `arm`, `estop_reset`, `machine_on`; der Aufruf endet absichtlich an letzterem. **Keine echten Ports oder NML-Kanäle verwendet.**

Der erste Sandboxversuch der vier Dispatch-Sonden erreichte wegen gesperrter asyncio-Sockets innerhalb 60 s kein Ergebnis; der begrenzte Offline-Wiederholungslauf mit freigegebenen lokalen Sockets lieferte die genannten zwei reproduzierbaren Assertion-Fehler. Der Fake und die Unterbindung der Host-Sim-Erkennung bleiben dabei aktiv.

## Grenzen und Quelle

Kein vollständiges Gate wiederholt, kein Browser gestartet, keine eigene Live-Abnahme, CI nicht unabhängig abgefragt. Claudes Live-/Rot-Protokolle sind gelesene Fremdbelege. Die Bytegrenze ergibt sich aus [emcmodule.cc in LinuxCNC 2.9.4](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/usr_intf/axis/extensions/emcmodule.cc#L922), `EMC_TASK_PLAN_EXECUTE.command[LINELEN]` in [emc_nml.hh](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/nml_intf/emc_nml.hh#L1258) und `LINELEN=255` (auch lokal `/usr/include/linuxcnc/linuxcnc.h:18` gelesen): **254 Nutzbytes**. Der letzte Schreibweg verhindert in den roten Dispatch-Fällen die zu lange MDI selbst; der Befund betrifft die schon vorher gesendeten Vorbereitungen bzw. Parameter.
