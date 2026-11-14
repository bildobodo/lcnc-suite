# R370 · Codex · Prüfnachweis · 14. November 2026

Geprüft: Produktdifferenz `39e5ccd1..ac26a648`, Anfrage im Live-Dokument an `25fa4de3`. Eigene Archivkopie `/tmp/codex-r370` von `ac26a648`. Kein Build, Test oder Checkout im Live-Baum; keine Verbindung zur Sim und keine Maschinenbefehle. Die Dateien im Live-Baum sind ausschließlich dieser neue Belegsatz und der angehängte Review-Abschnitt.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Vorhandene `test_console_guard.py` | 17 Testfälle PASS (JUnit-Summenzähler 19 einschließlich der zwei Kindprozess-Subtests) |
| Vorhandene native/install Tests, Auswahl `crash or signal_record or gate_status` | 13 PASS, 597 nicht gewählt |
| Eigene Abschalt-/Trace-Sonde | 3 erwartungswidrig FAIL, 2 positive Vergleiche PASS |
| Eigene Crash-Leser-Sonde | 3 erwartungswidrig FAIL, 2 positive Vergleiche PASS |

Die sechs roten Fälle zeigen die im Review benannten Restbefunde, keinen abgebrochenen Testaufbau. Gezählt nach den Testfall-Einträgen: 34 grün, 6 rot; die zwei Kindprozess-Subtests kommen im JUnit-Summenzähler hinzu. Die vollständigen Claudeschen Gates, CI und Live-Läufe wurden nicht wiederholt; ihre Berichte sind Fremdbelege. Keine zusätzliche Live-Abnahme behauptet.

## Reproduktion

Python: `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3`. Für die Gateway-Prüfung wird vor dem Import ausdrücklich `fake_linuxcnc.install()` ausgeführt. Eigene Sonden in einer Archivkopie ablegen:

- `codex-shutdown.py` als `lcnc-gateway/test_r370_codex.py`;
- `codex-crashes.py` als `scripts/test_r370_crashes_codex.py`.

Aus `lcnc-gateway/` der Kopie:

```sh
LCNC_LOG_DIR=/tmp/codex-r370-logs timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q test_console_guard.py --junitxml=/tmp/r370-console.xml
LCNC_LOG_DIR=/tmp/codex-r370-logs timeout 30 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q test_r370_codex.py --junitxml=/tmp/r370-shutdown.xml
```

Aus der Wurzel der Kopie:

```sh
LCNC_HEAVY_LOCK=/tmp/codex-r370-heavy.lock timeout 60 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_native_stage.py scripts/test_install_probe.py -k 'crash or signal_record or gate_status' --junitxml=/tmp/r370-native.xml
timeout 30 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_r370_crashes_codex.py --junitxml=/tmp/r370-crashes.xml
```

Alle Ausgaben und JUnit-Dateien liegen unter diesem Belegpräfix. Die Sonden schreiben ihre kompakten Daten nach `/tmp/r370-shutdown.json` und `/tmp/r370-crashes.json`; Kopien liegen daneben.

## VM-I14 · Diagnostik vor dem Notausgang

[Sonde](vor-maschine.p3b.r370.codex-shutdown.py), [Daten](vor-maschine.p3b.r370.codex-shutdown.json), [Ausgabe](vor-maschine.p3b.r370.codex-shutdown.txt).

Die Sonde verwendet das echte `lcnc_trace.emit` und einen echten `logging.Logger` mit dem Standard-`StreamHandler`. Nur dessen Ausgabestrom simuliert `OSError(ENOSPC)`. Timer und Signale sind aufgezeichnete Stubs, kein realer Abschaltbefehl.

1. Trace-Senke defekt, stdout/stderr roh und geschlossen: `console()` wirft aus seinem Verlustbericht `ValueError`. `_request_process_shutdown()` wirft mit `_shutdown_requested=True`, ohne Timer und ohne Signal.
2. Vergleich mit gesundem Trace: beide rohen Ströme dürfen geschlossen sein, Timer und Signal werden erreicht.
3. Vergleich mit intaktem stderr-Guard und werfender Senke: Timer und Signal werden erreicht.
4. Eigener Kindprozess, stderr-Guard **intakt**, echte volle Pipe mit offenem Leseende ohne Leseraktivität: Der Standard-Logger versucht seinen Fehler auf stderr zu melden und blockiert. Nach drei Sekunden beendet ausschließlich der Testtreiber seinen eigenen Kindprozess. `entered=true`, `deadline=false`, `returned=false`. Das beweist die Reihenfolge vor dem Notausgang; es ist keine Messung eines tatsächlich gestarteten 5-s-Timers.

Relevante Stellen an `ac26a648`: `gateway.py:2549` ff. (Merker, Trace, Timer), `gateway.py:2595` ff. (Instanzende vor HAL/Shutdown); `lcnc_trace.py:261` ff. (Logger und roher Fehlerbericht), `lcnc_trace.py:339` ff. (`console` meldet seinen Fehler wieder über `emit`). Die existierenden Abschaltwächter ersetzen `emit` durch eine Liste und prüfen diese Rückkopplung nicht.

## VM-I15 · Unbekannte Crash-Einträge

[Sonde](vor-maschine.p3b.r370.codex-crashes.py), [Daten](vor-maschine.p3b.r370.codex-crashes.json), [Ausgabe](vor-maschine.p3b.r370.codex-crashes.txt).

Die echten Funktionen `run_crashes` und `verdict` lesen drei einzeln geschriebene `crash.log`-Dateien: `{}`, `{"tag":"crash.thread","level":null}` und `{"tag":"crash.thread","level":"erorr"}`. Alle ergeben `crashes=[]` und bei sonst gültigem PASS-Bericht `PASS`. Gültige Vergleiche: `crash.signal/info` bleibt PASS, `crash.thread/error` wird FAIL.

Ursache `scripts/native_run.py:285–296`: Gültige JSON-Syntax und Objektform genügen; fehlt eine erkennbare Stufe, fällt der Eintrag durch den einzigen Vergleich auf `error`. Eine unbekannte Stufe belegt keinen fehlerfreien Lauf. Beide Verbraucher verwenden dasselbe Urteil, daher betrifft dies auch die Installationsprobe.

## Latch-Vorschlag: Quellenlesung, keine neue Live-Probe

Gelesen: Claudes `native-run1-latch-trace.txt`, `gateway.py` Poller/Statusversand, `hal_bridge.py` Reader-Cache, `native_run.py:latch_cases`, `test_support/trip.py:cont`, `servo_cases.py:eval_latch_sticky`.

`poller_ts` wird am Ende des Pollers gesetzt, `_status_gen` noch später erhöht. Beides allein beweist nicht, dass die Latch-Ablesung nach SIGCONT lag. `trip.cont` speichert nach SIGCONT den Zustand auf Platte, erst nach seiner Rückkehr setzt `latch_cases` den bisherigen Zeitanker. Ein neuer Zeitanker muss diese Lücke vermeiden. Die Bewertung im Review ist eine Bedingung für den vorgeschlagenen Vertrag, keine Implementierungsabnahme.
