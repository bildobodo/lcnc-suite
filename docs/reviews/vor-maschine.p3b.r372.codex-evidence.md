# R372 · Codex · Prüfnachweis · 14. November 2026

Geprüft: `3d8a8741..533c71fc`, Anfrage im Dokument an `893f2261`. Neue Archivkopie `/tmp/codex-r372` von `533c71fc`. Kein Build, Test oder Checkout im Live-Baum, keine Verbindung zur Sim, keine Maschinenbefehle. Änderungen im Live-Baum ausschließlich als Review-Anhang und neue Belege.

## Eigene Prüfungen

| Auswahl | Ergebnis |
|---|---|
| `test_console_guard.py`, R370-Abschaltsonde, die beiden eigenen R371-Timer-Fälle | 46 Testfälle PASS, zusätzlich zwei Kindprozess-Subtests; JUnit-Summenzähler 48 |
| Native/install Crash-/Gate-Wächter, R370-Crash-Sonde und eigene R371-Feldtyp-Fälle | 41 PASS, 597 nicht gewählt |

Damit **87/87 gezielte Testfälle grün**, keine Warnung in diesen Läufen. Alle 14 eigenen Fälle aus R370/R371 sind enthalten. Die R371-Sonden sind inhaltlich unverändert; lediglich ihre `/tmp`-Ausgabepfade nennen jetzt R372. [Identitätsnachweis](vor-maschine.p3b.r372.codex-probe-identity.json). Der bereits in R371 erforderliche Reset von `_shutdown_deadline` pro unabhängigem R370-Fall bleibt enthalten.

Die importierte Repository-Klasse im eigenen Timer-Test wurde nicht ein zweites Mal ausgeführt: Dort wurde explizit der eigene Testknoten ausgewählt. Die Repository-Klasse läuft bereits über `test_console_guard.py`.

## Gegenfälle geschlossen

- **Timer startet nicht:** Beide eigenen Kinder erreichen den künstlichen Timer-Fehler und enden selbst mit Code 1. `returned=false`, `timed_out=false`; der Testtreiber muss sie nicht mehr beenden. [Daten](vor-maschine.p3b.r372.codex-deadline-failure.json).
- **Ungültiger Feldtyp:** `level=[]` und `level={}` ergeben keine Ausnahme mehr, sondern einen beschädigten Beleg. `restore_outcome=complete`, `report_exists=true`, `verdict=FAIL`. [Daten](vor-maschine.p3b.r372.codex-crash-types.json).
- **R370-Vergleiche:** Rohe geschlossene Konsolen, fehlgeschlagene Trace-Senke und die volle Pipe halten die ursprünglichen Erwartungen. Die alten ungültigen Crash-Einträge ergeben FAIL; gültiges `crash.signal/info` bleibt PASS. [Abschaltung](vor-maschine.p3b.r372.codex-shutdown.json), [Crash-Leser](vor-maschine.p3b.r372.codex-crashes.json).
- **Erweiterte Repository-Wächter:** Alle fünf entschiedenen Ausstiege enden bei Timer-Fehler vor jeder Diagnose. Die blockierenden Fälle mit startbarem Timer bleiben positiv. Fehler der Crash-Prüfung selbst und ungewöhnliche JSON-Typen in zusätzlichen Fehlerfeldern erreichen den Abschlussbericht sowie `install_cases.gate_status` als benannten FAIL.

## Befehle zur Reproduktion

Die vier Sonden gemäß `codex-probe-identity.json` in einer eigenen Archivkopie an die dort angegebenen Ziele kopieren. Nur die Ausgabepfade ändern. Python: `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3`.

Aus `lcnc-gateway/` der Kopie:

```sh
LCNC_LOG_DIR=/tmp/codex-r372-logs timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q test_console_guard.py test_r370_codex.py test_r371_codex.py::test_timer_start_failure_still_ends_the_gateway --junitxml=/tmp/r372-console.xml
```

Aus der Wurzel der Kopie:

```sh
LCNC_HEAVY_LOCK=/tmp/codex-r372-heavy.lock timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_native_stage.py scripts/test_install_probe.py scripts/test_r370_crashes_codex.py scripts/test_r371_crash_types_codex.py -k 'crash or signal_record or gate_status or record_the_verdict or valid_records or error_record_of_any' --junitxml=/tmp/r372-native.xml
```

[Konsolen-Ausgabe](vor-maschine.p3b.r372.codex-console-tests.txt), [JUnit](vor-maschine.p3b.r372.codex-console-tests.xml), [Native-/Install-Ausgabe](vor-maschine.p3b.r372.codex-native-tests.txt), [JUnit](vor-maschine.p3b.r372.codex-native-tests.xml).

## Quellenprüfung und Grenzen

Die Produktänderung besteht aus dem unmittelbaren Exit beim Scheitern des Timers, dem korrigierten Selbstneustart-Hinweis und der abgesicherten Crash-Auswertung. Der Launcher bestätigt im DEV- und PROD-Pfad ausdrücklich „No respawn“. Die Aufrufe unter `_link_lock`, die Cache-Löschung und `invalidate_var_file_path` enthalten im gelesenen Stand keine explizite blockierende Diagnose. Der neue AST-Wächter ergänzt diese Quellenprüfung; er beweist keine allgemeine Freiheit von Laufzeit-Rückrufen wie GC.

Die benannte Grenze einer allgemeinen Konsolenblockade **vor** dem Schärfen bleibt bestehen. Hier wird kein allgemein blockierungsfreies Gateway abgenommen; die HAL-Sicherheitskette bleibt von diesem Software-Ausstiegsnachweis getrennt. Auch Fehler beim Rückgeben der Sim oder beim Schreiben des Berichts selbst sind nicht durch den neuen Catch um `run_crashes` abgedeckt.

Claudes Round-Gate-Bericht nennt `head=533c71fc`, PASS und die Live-Prüfungen `perf-matrix`/`twp-buttons` als separat zu erbringen. Der neue gezielte Live-Auszug zeigt den normalen Ausstieg über Selbst-SIGTERM und vollständiges Teardown; er ersetzt keinen Test des künstlich nicht startbaren Timers. Die übrigen Live-Berichte bleiben wie benannt an `3d8a8741`. CI und Live-Läufe wurden von mir nicht unabhängig ausgeführt; eigene Evidenz hier ist die Quellenprüfung plus die Offline-Proben.
