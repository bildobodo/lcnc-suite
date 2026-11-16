# R382 · Codex · Belege zur Nachprüfung

Stand: `cad9ac77..e743061a`, Dokument `bc2caeb8`, 16. November 2026. Geprüft in `/tmp/codex-r382`, erzeugt mit `git archive e743061a`. Kein Live-Zugriff, kein Browserlauf, kein Maschinenbefehl. Produktdateien der Archivkopie unverändert; Hashes und Vergleich mit den Git-Blobs stehen in [meta.json](vor-maschine.p3b.r382.codex-meta.json).

## Eigene Prüfungen

- Die gegenüber der Basis hinzugekommenen oder geänderten Funktionen in `test_native_stage.py`, nach AST verglichen: [Auswahl](vor-maschine.p3b.r382.codex-test-selection.txt), **21/21 grün**, [Log](vor-maschine.p3b.r382.codex-targeted.txt).
- [Gegenproben](vor-maschine.p3b.r382.codex-probes.py): **sechs rote Vertragsassertionen, zwei grüne Kontrollen**, [Log](vor-maschine.p3b.r382.codex-probes.txt). Kein Import-/Aufbaufehler. Die roten Assertions sind die Befunde, keine Produktänderungen oder Produktmutanten.

Die erste Probe führt den echten `_probe_run` mit den Repository-Fakes aus und lässt den Warteweg bei noch laufender Bewegung fehlschlagen. Auf `job:probe-run` folgen `read`, erst dann `wire:abort`. `_vars` ist dort beobachtet; seine produktive Implementierung ruft `_read_params` und darüber MDI-DEBUG auf.

Zwei Proben setzen Trip bzw. Verbindungsfehler während `_standstill`. Der echte `_probe_run_restore` ruft danach trotzdem alle vier Wiederherstellungshelfer auf. Die Helfer sind reine Beobachter; ihr synthetisches PASS behauptet ausdrücklich **keine** Annahme solcher Befehle durch ein echtes Gateway.

Zwei weitere Proben führen `surface_cases` mit `SurfaceSim` aus. Der Scan wirft mit `interp_state=2`, `inpos=False`; einmal ist zusätzlich ein Trip bekannt. Der echte Abschluss ruft zuerst `set_compensation` auf, ohne den erforderlichen Abbruch/Stillstand beziehungsweise ohne bei Trip aufzuhören. Die Probe misst die Ablaufsteuerung mit Fake-Gegenstelle.

Die Cursor-Probe benutzt den echten `SimulatorClient.take/request` und `_probe_job`, mit einem lokalen Socket-Objekt ohne Netzwerk. Zwischen `bounds()` und dem echten Sendeaufruf werden eine Sperre und eine freie Grundlinie empfangen; danach kommen nur freie Busy-/Idle-Frames. Alle Sperrstempel liegen nachweislich vor dem Senden. Dennoch urteilt `.start` PASS und der Helfer endet ohne Fehler. Zwei Kontrollen zeigen: Eine echte Sperre nach dem Senden besteht; eine schon gesperrte Grundlinie sendet nichts.

Reproduktion (ausschließlich in einer Archivkopie):

```sh
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r382.codex-probes.py /tmp/codex-r382/r382_probe.py
cd /tmp/codex-r382
LCNC_HEAVY_LOCK=/tmp/r382-review-heavy.lock PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q -p no:cacheprovider r382_probe.py
```

## Vorhandene Laufartefakte nachgelesen

Der Round-Gate-Bericht nennt `e743061a`, `uncommitted: 0`, PASS, 2657 Unit- und 924 Browserfälle. Diesen vollständigen Lauf habe ich nicht wiederholt.

Die drei gespeicherten nativen Berichte und ihre kompletten Trace-Dateien wurden gelesen. Ein separater JSON-Durchgang prüfte die sechs Markenpaare je Lauf auf Reihenfolge, gemeinsame Gateway-PID und Prozessname. Bei vorhandenen Jobs waren genau ein `features.job`, eine Parameterlieferung einschließlich `3116=0` und eine bestätigte Übernahme mit denselben Schlüsseln vorhanden. Das ist eine Prüfung der gespeicherten Artefakte, kein neuer nativer Lauf und keine Bestätigung des fehlerhaften Sendecursors.

[Audit mit Dateipfaden, SHA-256, Zeilen und Ergebnissen](vor-maschine.p3b.r382.codex-artifact-audit.json): `main1` und `main2` je 22 Antast-/Surface-Zeilen PASS, `mdi-driver` genau `probe-run` und `surface-scan.job` FAIL; alle drei berichten vollständige Rückgabe und keine Crashes. Die erfolgreichen Abläufe stehen damit nicht im Widerspruch zu den Gegenproben der Fehlerwege. Die behauptete Dauer „nach dem Senden“ ist gesondert durch VM-I24 begrenzt.
