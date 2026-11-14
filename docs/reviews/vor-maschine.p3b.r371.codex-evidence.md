# R371 · Codex · Prüfnachweis · 14. November 2026

Produkt `3d8a8741`, Differenz seit R370 `ac26a648..3d8a8741`; Anfrage im Live-Dokument an `05cebc0e`. Getestet ausschließlich in `/tmp/codex-r371`, einer neuen Archivkopie des Produktkopfes. Keine Verbindung zur Live-Sim, keine Maschinenbefehle, keine Builds oder Tests im Live-Baum.

## Prüfungen

| Auswahl | Ergebnis |
|---|---|
| `test_console_guard.py` und R370-Abschaltsonde | 33 Testfälle PASS; zusätzlich zwei Kindprozess-Subtests, JUnit-Summenzähler 35 |
| Native/install Crash-/Gate-Wächter und R370-Crash-Sonde | 28 PASS, 597 nicht gewählt |
| Neue Sonde: Timer-Start scheitert, Diagnose blockiert | 2 FAIL (Anfrage und Instanzende) |
| Neue Sonde: `level` als Array/Objekt im echten Run-Abschluss | 2 FAIL |

Die zehn Fälle der R370-Sonden sind in den 61 grünen Testfällen enthalten. Der neue Merker `_shutdown_deadline` muss pro unabhängigem Fall zurückgesetzt werden; diese Anpassung ist korrekt und kein Produktbefund. [Exakter Diff](vor-maschine.p3b.r371.codex-r370-adaptation.diff); daneben wurden nur die JSON-Ausgabepfade geändert.

Der Konsolen-Testlauf meldet eine `PytestUnraisableExceptionWarning`: Der GC-Callback versucht während eines Tests mit absichtlich roh geschlossenem stdout zu drucken. Die Warnung ist im Originalprotokoll erhalten, nicht unterdrückt oder durch einen Wiederholungslauf ersetzt. Sie ändert die hier nachgewiesenen Ergebnisse der Abschaltketten nicht.

Alle eigenen Testausgaben, Daten und JUnit-Dateien sind unter diesem Präfix gespeichert. Claudes Round-Gate-Bericht nennt `head=3d8a8741` und PASS. CI und die berichteten Live-/nativen Läufe wurden nicht unabhängig wiederholt; sie bleiben Fremdbelege.

## Reproduktion

Python: `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3`. Die Gateway-Sonden installieren vor dem Import die Fake-Bindung. Den Beleg `r370-shutdown.py` als `lcnc-gateway/test_r370_codex.py`, `deadline-failure.py` als `lcnc-gateway/test_r371_codex.py`, `r370-crashes.py` als `scripts/test_r370_crashes_codex.py` und `crash-types.py` als `scripts/test_r371_crash_types_codex.py` in einer eigenen Archivkopie ablegen.

Aus `lcnc-gateway/` dieser Kopie:

```sh
LCNC_LOG_DIR=/tmp/codex-r371-logs timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q test_console_guard.py test_r370_codex.py --junitxml=/tmp/r371-console.xml
LCNC_LOG_DIR=/tmp/codex-r371-logs timeout 30 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q test_r371_codex.py -k timer_start_failure --junitxml=/tmp/r371-deadline-failure.xml
```

Aus der Wurzel dieser Kopie:

```sh
LCNC_HEAVY_LOCK=/tmp/codex-r371-heavy.lock timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_native_stage.py scripts/test_install_probe.py scripts/test_r370_crashes_codex.py -k 'crash or signal_record or gate_status or record_the_verdict or valid_records' --junitxml=/tmp/r371-native.xml
LCNC_HEAVY_LOCK=/tmp/codex-r371-heavy2.lock timeout 30 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_r371_crash_types_codex.py --junitxml=/tmp/r371-crash-types.xml
```

## Neue Gegenfälle

**VM-I14 Rest:** Die neue Sonde verwendet den Kindprozess aus dem Repository-Test `ABlockedDiagnosticCannotOutliveTheDeadline` unverändert bis auf den Timer: Dessen `start()` meldet `RuntimeError("cannot start new thread")`. Das ist eine gezielte Fehlerinjektion, keine tatsächliche Erschöpfung der VM-Ressourcen. Beide Eintrittswege bleiben danach in der echten vollen stderr-Pipe hängen. Nach zwei Sekunden beendet ausschließlich der Testtreiber seinen eigenen Kindprozess. Daten für beide: `entered=true`, `timer_failed=true`, `returned=false`, `timed_out=true`. Die Frist im Vergleichstest beträgt 0,3 s; dort endet das Kind von selbst mit 1. Die neue Sonde erreicht die Frist nicht, weil kein Timer läuft. Externe Signale sind im Kind wie im Repository-Wächter ersetzt; kein Live-Prozess wird adressiert.

**VM-I15 Rest:** Zwei ansonsten gültige JSON-Einträge mit `tag="crash.thread"`, aber `level=[]` beziehungsweise `level={}` laufen durch den echten `native_run.run` mit `FakeHost`. Ergebnis jeweils: `TypeError: unhashable type`, `restore_outcome="complete"`, `report_exists=false`. Das ist jetzt kein falsches PASS, sondern ein abgebrochener Abschluss ohne den geschuldeten Bericht. Die Fehlerstelle ist der Mengenvergleich in `_crash_record_problem`, bevor `run_crashes` einen beschädigten Beleg aufnehmen kann.
