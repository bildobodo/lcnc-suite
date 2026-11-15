# R381 · Codex · Plan-Nachprüfung

Dokument `21848d32`, Produktbasis `cad9ac77`. Zehn verwendete Dateien und der Subroutinen-Symlink in `/tmp/codex-r379` wurden erneut byteweise gegen die Git-Objekte des Produktstands geprüft. [Metadaten](vor-maschine.p3b.r381.codex-metadata.json). Kein Produktcode geändert, kein Browser-/Sim-Lauf oder vollständiges Gate, keine Live-Ports benutzt.

## Quellenabgleich

- **VM380-01:** `ProbePanel.vue:242–247,287–290` und `App.vue:1777–1782` senden die berechneten Karten durch `probe_run` beziehungsweise `surface_scan_run`. Die geplanten vollständigen Browservergleiche erreichen genau diese Sendestellen. `probeVars.ts` hält die Karten; der ausdrücklich gesetzte Zustand `autoZero: true` liefert Modus 0. Die Surface-Fixture entspricht `native_run.py:98–99` einschließlich zusätzlichem `3014: 99` am bisherigen Aufruf in `_scan_and_compensate`.
- **VM380-02:** Der `client_diag`-Zweig (`gateway.py:12168`) schreibt die Marke synchron und antwortlos im Reader. Erst später werden die normalen Aufträge an den Command-Worker gegeben. `_feature_job` schreibt `features.job` vor seiner Antwort (`gateway.py:5778`). `SimulatorClient.send` überträgt den Markenrahmen über denselben Socket (`live_session.py:88`); `_gateway_pid` bindet die erwartete PID an die Test-Unit (`native_run.py:2206`). Daher ist die im Plan genannte Reihenfolge ohne neue Produktinstrumentierung möglich.
- **VM380-03:** `_override_free` (`native_run.py:1467`) wartet nach `M50 P1` auf einen neuen empfangenen Status, der die Freigabe bestätigt. Grundlinie, eigene Sperre, normale Freigabe und Cleanup sind im Plan nun getrennt. `surface_cases` und `_surface_cleanup` bleiben der Rahmen für die G2-Ergebnisprüfungen.

## Vier Offline-Proben zur Dateigrenze

[Skript](vor-maschine.p3b.r381.codex-trace-marks.py), [Ergebnisse](vor-maschine.p3b.r381.codex-trace-marks.json).

Die Prozesse verwenden den echten `lcnc_trace` aus `cad9ac77`, schreiben ausschließlich temporäre Dateien und erzwingen gewöhnliche Rotationen durch `doRollover`, um nicht 50 MB erzeugen zu müssen. Es laufen weder Gateway noch HAL. Die Auswertung prüft **nur die Lage der Marken und des Auftrags**, nicht die noch ungeschriebene Reader-Implementierung.

| Fall | Anfang/Ende | Ergebnis nach dem Plan |
|---|---|---|
| Keine Rotation | beide `trace.ndjson`, Auftrag dazwischen | auswertbar |
| Anderer Schreiber rotiert vor der Startmarke | beide `.1`, Auftrag dazwischen | auswertbar |
| Anderer Schreiber rotiert zwischen den Marken | beide `.1`, Auftrag dazwischen | auswertbar |
| Gateway rotiert zwischen den Marken | Anfang `.1`, Ende `trace.ndjson` | `incomplete` |

Alle vier Assertions bestehen. Die jeweils gelesene Identität stammt aus `fstat` am offenen Deskriptor, die Marken gehören zur PID des jeweiligen Test-Schreibers. Reproduktion nach Kopieren des Skripts in einen Prüfbereich:

```sh
python3 r381-trace-marks.py /tmp/codex-r379
```

## Korrektur einer R380-Herleitung

Das ausgelieferte 3-Achs-Profil konfiguriert `ON_ABORT_COMMAND = O<on_abort> call` (`examples/sim_config/lcnc_suite_sim_3axis_xyz.ini:170`). Sein Subroutinen-Symlink zeigt auf die zentrale Routine `subroutines/probe_basic/on_abort.ngc`; sie enthält **`M50 P1` und `G90`**.

R380 hatte nur die abgebrochene Antastroutine und den direkten Abschluss von `probe_cases` betrachtet. Daraus folgt nicht, dass der vollständige native Abbruchweg den Override tatsächlich gesperrt lässt. Dieser behauptete konkrete Restzustand war nicht belegt und wird hier zurückgenommen. Die R380-Sonde zeigt weiterhin korrekt, dass der isolierte Startwächter eine bereits bestehende Sperre ohne eigene freie Grundlinie akzeptiert. Der neue Plan prüft diese Grundlinie ausdrücklich und macht keine Annahme über die Wirkung des Abbruchhandlers. Es wurde dazu kein neuer Live-Versuch ausgeführt.
