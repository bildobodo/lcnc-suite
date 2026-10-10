# R122 · Codex · Prüfaufbau

- Ziel: Plan `parity-ef.plan.md`, Fassung 1; `6754232a..fd74f212`.
- Archiv: `/tmp/codex-r122-xy729vat`, per `git archive fd74f212` erstellt. Kein Produktcode verändert.
- Native Bibliothek: installierter LinuxCNC-Vorschau-Interpreter; Python aus `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python`. Der vorhandene Helfer `native_start_probe.py` verwendet synthetischen Status, temporäre INI/Parameter/Werkzeugdateien und ein privates Werkzeugabbild. `linuxcnc.command` wirft eine Assertion. Keine Verbindung zur Live-Steuerung.
- Prozesse seriell mit `nice -n 19`; Bytecodecache im Archiv. Keine Builds, Browser, Ports oder HAL-Instanzen.

## Wiederholung

Aus `lcnc-gateway/` der Archivkopie:

```bash
nice -n 19 env PYTHONPYCACHEPREFIX=/tmp/codex-r122-xy729vat/pycache /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python ../docs/reviews/viewer-palette-fest.r122.native-flags.py e_g53_prefix
```

Denselben Aufruf für `e_g30_forms`, `e_g28_g91`, `e_sub` wiederholen. Diese vier gelieferten Fälle wurden unverändert ausgeführt.

Für die fünf eigenen Fälle denselben Python-Aufruf mit `viewer-palette-fest.r122.codex-native.py` verwenden (weiterhin Arbeitsverzeichnis `lcnc-gateway/`): `r122_feed_f100`, `r122_feed_f200`, `r122_rapid_corner`, `r122_feed_mixed_a`, `r122_feed_mixed_b`. Die Sonde ergänzt die Fallliste des nativen Helfers nur im Speicher. Alle neun vollständigen Ausgaben und Befehle stehen in `viewer-palette-fest.r122.codex-native-results.json`.

Die Assertions und Berechnungen lassen sich ohne native Bibliothek wiederholen:

```bash
python3 docs/reviews/viewer-palette-fest.r122.codex-contract-checks.py docs/reviews/viewer-palette-fest.r122.codex-native-results.json examples/sim_config/lcnc_suite_sim_5axis_xyzac.ini
```

Die Ergebnisdatei bestätigt neun erfolgreiche Parse-/Mmap-Prüfungen, die überprüften G28/G30-Folgen und Achsworte, die zwei entfernten Rapid-Punkte sowie die identischen Nutzlasten bei vertauschten Vorschüben. Die Korrektur auf Start `(100,100,0)` ist nach dem **geplanten** E2/E5-Vertrag berechnet; es gibt noch keine solche Produktimplementierung.

## Bremsmodell: Beleggrenze

Die Rechnungen setzen die im Plan genannten Beschleunigungsfälle ein. Sie sind kein Ersatz für F5 und behaupten keine gemessenen Stillstandspositionen. Das Rückzugsbeispiel widerlegt die Weitergabe einer einzigen Extremposition als segmentweise Hülle; es behauptet keine über den gesamten Routineweg unentdeckte Kollision. Die 20-ms-Rechnung zeigt die Bedeutung einer nicht begrenzten zusätzlichen Signallatenz, ohne eine bestimmte Hardware zu unterstellen.

Primärquelle gegengeprüft: [LinuxCNC v2.9.4, tc.c, tcGetOverallMaxAccel](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/tp/tc.c#L51-L63). Die Halbierung hängt dort von `blend_prev` bzw. `TC_TERM_COND_PARABOLIC` ab; zusätzlich werden die beiden Knick-Abzüge berücksichtigt. [tp.c](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/tp/tp.c) wurde zur Einordnung des Abbruchs gelesen. Keine eigene Ausführung des Trajektorienplaners.

Quellhashes: `viewer-palette-fest.r122.codex-sources.json`. Archivcommit und Review-Präfix vor dem Anhang: `viewer-palette-fest.r122.codex-context.json`.

Zusätzlich gegengeprüft: [External Axis Offsets, LinuxCNC 2.9](https://www.linuxcnc.org/docs/2.9/html/motion/external-offsets.html#_ini_file_settings). Die dokumentierte Aufteilung mit `(1-r)` wird auf die archivierte XYZAC-INI angewandt. Die Rechnung weist keine real gemessene Bremsstrecke nach. Der Versuch, zusätzlich `iniaxis.cc` über die rohe v2.9.4-URL zu lesen, scheiterte am Abruf; diese Datei ist kein Beleg.
