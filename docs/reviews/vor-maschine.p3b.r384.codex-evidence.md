# R384 · Codex · Belege

Prüfstand `39a73679`, Änderungen seit `be5dd91f`, Gesamtbasis `cad9ac77`. Archivkopie `/tmp/codex-r384`. Kein Live-Zugriff, kein Maschinenbefehl und kein Browserlauf. [Metadaten und Hashes](vor-maschine.p3b.r384.codex-meta.json) bestätigen die unveränderten Quellen und die unveränderten R382-/R383-Sonden.

## Eigene Ausführung

1. Vollständige `scripts/test_native_stage.py` (641 Fälle) plus acht R382- und zwei R383-Proben: **651/651 PASS in 54,55 s**, [Log](vor-maschine.p3b.r384.codex-tests.txt).
2. [Zusätzliche Ablaufprüfung](vor-maschine.p3b.r384.codex-probes.py): **12/12 PASS**, [Log](vor-maschine.p3b.r384.codex-probes.txt). Acht Verlustfälle und vier Kontrollen. Beide Fallhüllen (`probe_cases`, `surface_cases`), jeweils direkter `NotAdmitted`-Ausgang oder als `StepFailed` weitergegebener Fehler; Trip, Verbindungsverlust und kein Verlust.

Die zusätzliche Prüfung führt den echten Orchestrator `run`, die echte `_admitted_sends`-Hülle sowie `_stop_copy` und `SimulatorClient.close` aus. Ersetzt sind die beiden fachlichen Fallkörper, die Host-Gegenstelle (`FakeHost`) und der Socket. Keine echte Verbindung und keine echten Dienste. Der Körper legt eine bereits gemessene Zeile ab, empfängt einen synthetischen Trip beziehungsweise einen Verbindungsfehler und versucht eine weitere Anfrage.

Gehaltene Ergebnisse: Die weitere Anfrage geht nicht hinaus; kein späterer Schritt beginnt; die Zeile bleibt genau einmal im gespeicherten Bericht; Gesamturteil FAIL; die Rückgabe über den FakeHost ist vollständig. Die Hülle ist vor dem globalen Abschluss entfernt. Beim Trip gehen dort ausschließlich `abort` und `arm(false)` hinaus, keine Quittierung, kein Reset, kein Einschalten. Bei verlorener Verbindung ist der fehlgeschlagene Client-Abschluss als `cleanup_error` benannt, der Socket wird geschlossen und die Host-Rückgabe läuft trotzdem. Die Kontrollfälle ohne Verlust führen den späteren Schritt aus und bestehen.

Diese Probe ergänzt die in der Anfrage benannte fehlende Ablaufprüfung; sie ersetzt keinen Live-Abbruchversuch.

Reproduktion nur in der Archivkopie:

```sh
cd /tmp/codex-r384
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r382.codex-probes.py r382_probe.py
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r383.codex-probes.py r383_probe.py
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r384.codex-probes.py r384_probe.py
LCNC_HEAVY_LOCK=/tmp/r384-review-heavy.lock PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -p no:cacheprovider scripts/test_native_stage.py r382_probe.py r383_probe.py
LCNC_HEAVY_LOCK=/tmp/r384-review-heavy.lock PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -p no:cacheprovider r384_probe.py
```

## Quelle und vorhandene Artefakte

Die ausgelagerten Körper `_probe_steps` und `_surface_steps` sind nach Entfernung ihrer neuen Docstrings AST-identisch zu den vorherigen verschachtelten Fallkörpern: [Vergleich](vor-maschine.p3b.r384.codex-body-proof.json). Die Änderung legt somit die Zulassung um die bisherigen Abläufe, ohne dort weitere Operationen hinzuzufügen oder zu entfernen.

Der Round-Gate-Bericht nennt `39a73679`, `uncommitted: 0`, alle ausgewiesenen Schritte PASS, 2657 Unit-/924 Browserfälle. Die 41 Offline- und zwei Browser-Mutationen sind Claudes Nachweise, nicht von mir erneut ausgeführt.

Die drei gespeicherten nativen Berichte und ihre vollständigen Trace-Dateien wurden gelesen. Ein separater JSON-Durchgang prüfte je sechs Markenpaare auf Reihenfolge und gemeinsame Gateway-PID/Prozessname. Bei vorhandenen Jobs: genau eine Parameterlieferung einschließlich `3116=0`, genau eine bestätigte Übernahme mit denselben Schlüsseln. [Audit mit Hashes, Pfaden, Fensterzeilen, Fallzeilen und Surface-Abschluss](vor-maschine.p3b.r384.codex-artifact-audit.json).

Beide Hauptläufe: je 22 Antast-/Surface-Zeilen PASS. MDI-Gegenlauf: genau `probe-run` und `surface-scan.job` FAIL. Alle drei berichten vollständige Rückgabe, keine Crashes und sechs vollständige Surface-Abschlussschritte. Diese Läufe belegen den normalen Ablauf und die Erkennung des MDI-Umwegs. Das Verhalten bei Trip/Verbindungsverlust ist hier durch die Offline-Gegenfälle belegt, nicht durch einen neuen Live-Versuch.
