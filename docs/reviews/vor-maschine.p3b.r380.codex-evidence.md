# R380 · Codex · Planbelege

Planstand `1285c67f`, Produktstand `cad9ac77`. Geprüft in der schon vorhandenen Archivkopie `/tmp/codex-r379`. Die neun unmittelbar verwendeten Quelldateien sind bytegleich mit `git show cad9ac77:<pfad>`; [Prüfstand und Hashes](vor-maschine.p3b.r380.codex-metadata.json). Keine Produktänderung, kein vollständiges Gate, kein Browser-/Sim-Lauf und kein Zugriff auf die Live-Ports.

## VM380-01 · Panel → Auftrag → native Fixture

[Sonde](vor-maschine.p3b.r380.codex-panel-probe.cjs), [Ergebnis](vor-maschine.p3b.r380.codex-panel-probe.json).

Die Sonde übersetzt ausschließlich `probeVars.ts` und die aus dem Quelltext entnommenen Funktionen `runGridProbe` und `onRunProbe`. Die Vue-Umgebung wird durch einfache Werte und einen Auftragsfänger ersetzt. Das ist **kein Browserlauf** und kein vollständiger Mutations-Gatelauf.

- Der echte Panel-Ausgangspunkt mit `autoZero: false` liefert `3030: 1`.
- Mit `autoZero: true` liefert der echte Grid-/App-Weg `3030: 0` und genau die vorgeschlagene native Karte.
- Gegenfall ausschließlich an der App-Sendestelle: `vars: {...vars, '3030': 1}`. Die Karte selbst bleibt unverändert. Die in `probe-click.spec.ts` vorhandenen Wertprüfungen (Nummernmenge, endlich, Modus in `{0,1}`) akzeptieren den falschen Modus; der separate Map-/Fixture-Vergleich bleibt ebenfalls grün. Ein Vergleich des tatsächlich gesendeten Objekts mit der nativen Fixture lehnt ihn ab.

Quellen: `probeVars.ts:4–13,23`; `ProbePanel.vue:173,242–247,290`; `App.vue:1777–1781`; `e2e/probe-click.spec.ts:35–59,64–84`. Der bisherige Vertrag bindet den nativen Fall an die im Replay belegten Panelwerte (VM349-01, Antwort R350).

## VM380-02 · Rotation vor dem Fenster

[Sonde](vor-maschine.p3b.r380.codex-trace-probe.py), [Ergebnis](vor-maschine.p3b.r380.codex-trace-probe.json).

Zwei gewöhnliche Python-Prozesse importieren den **echten** `lcnc_trace` aus der Archivkopie. Es laufen weder Gateway noch HAL. Der zweite Prozess erzwingt einen einzelnen normalen `RotatingFileHandler.doRollover()`, bevor die Messmarke genommen wird. Das ersetzt nur das Warten auf 50 MB.

1. Kontrollfall ohne Rotation: Ein `features.job` steht im ab Dateigröße gelesenen Fenster.
2. Nach der Rotation wird die Marke aus der aktuellen `trace.ndjson` mit `fstat` am geöffneten Objekt genommen.
3. Der erste Schreiber emittiert ein neues `features.job`.
4. Inode **und Größe** der aktuellen Datei bleiben unverändert, im geplanten Fenster steht kein Job. Der neue Job liegt in `trace.ndjson.1`, mit dem richtigen `proc` und der PID des Schreibers.

Damit reichen die drei Fehlerbedingungen aus Plan §3 nicht: Keine Datei ist unlesbar, ausgetauscht oder kürzer geworden. Trotzdem wurde der Gateway-Datenstrom nicht beobachtet. „Fehlender Handler-Auftrag“ wäre im positiven Fall eine falsche Fehlerdiagnose; „keine Lieferung“ ist aus diesem Fenster ebenfalls nicht bewiesen.

Quellen: `lcnc_trace.py:1–23,155–182` (gemeinsamer Dateiname, unabhängige offene Handler), `gateway.py:5778` (Auftrag), `gateway.py:12168–12180` (bereits vorhandene `client_diag`-Marken), `native_run.py:2007–2022` (alter Leser ignoriert beschädigte Zeilen). Der Gegenfall braucht keine gleichzeitigen Rotationen oder manipulierten Zeitstempel.

## VM380-03 · Geerbte Override-Sperre

[Sonde](vor-maschine.p3b.r380.codex-override-probe.py), [Ergebnis](vor-maschine.p3b.r380.codex-override-probe.json).

Der tatsächliche lokale `ran`-Wächter aus `probe_cases` und `RoutineEnd` werden isoliert ausgeführt. Der synthetische Verlauf beginnt bereits gesperrt, zeigt dann Busy und endet frei/Idle. Er enthält **keinen** zum Auftrag gehörenden Wechsel von frei nach gesperrt. Die vorgeschlagene Wiederverwendung erkennt dennoch den Start und das Ende.

Der Gegenfall ist durch den vorhandenen Ablauf erreichbar: `probe_z_minus_wco.ngc:25` sperrt vor `G38.2` (Zeile 40); ein Fehler dort erreicht das spätere `M50 P1` (Zeile 85) nicht. `probe_cases` endet mit genau dem erwarteten Miss und stellt den Override nicht frei. Plan §6 nennt dafür ebenfalls keine Wiederherstellung. Dies ist ein Nachweis der fehlenden Grundlinienbedingung, keine Behauptung eines neu ausgeführten nativen Fehlers. `_override_free` (`native_run.py:1467`) bestätigt bereits ein frisches freies Statusfeld und kann wiederverwendet werden.

## Reproduktion

Die Skripte in einen beschreibbaren Prüfbereich kopieren; `ARCHIVE` muss die unveränderte Archivkopie von `cad9ac77` sein. Der TypeScript-Pfad ist eine ausschließlich gelesene Abhängigkeit; es wird kein Server gestartet.

```sh
python3 r380-trace-probe.py /tmp/codex-r379
node r380-panel-probe.cjs /tmp/codex-r379 /home/cnc/lcnc-suite-gates/lcnc-webui/node_modules/typescript/lib/typescript.js
python3 r380-override-probe.py /tmp/codex-r379
```
