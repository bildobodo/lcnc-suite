# R363 · Codex · Belege zur Dokument-Runde

Prüfstand Produkt: `45727d61`. Plan: `8caf7061`, Anfrage R363 in
`vor-maschine.review.md` und `vor-maschine.p3.payload-inventory.md`.
Keine Produktänderung, kein Build, kein Serverstart und keine Live-Sim-Befehle.

## Reproduzierbare Gegenproben

[Sonde](vor-maschine.r363.codex-probe.py),
[Ergebnis](vor-maschine.r363.codex-probe.json).

```sh
timeout 30s /home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 \
  /home/cnc/lcnc-suite/docs/reviews/vor-maschine.r363.codex-probe.py \
  /tmp/codex-r362 /tmp/r363-result.json
```

`/tmp/codex-r362` ist die vorhandene Archivkopie von `45727d61`, also auch
die Produktbasis dieser Runde. Die im Ergebnis genannten SHA256 der drei
ausgeführten Quelldateien wurden mit `git show 45727d61:<Datei>` verglichen:
alle drei stimmen bytegenau überein. Python verwendet ausschließlich
`fake_linuxcnc`; Instanzerkennung ist während des Imports abgeschaltet.
Logs landen in einem eigenen temporären Ordner.

Der erste Sandbox-Lauf hing in der AsyncIO-Laufzeit und wurde gezielt beendet.
Die begrenzten Läufe außerhalb der Sandbox hatten keine Live-Zugriffe. Zwei
Anläufe fanden einen unvollständigen Aufbau der AUTO-Sonde
(`published_toolsetter` fehlte); die isolierten Basis-/Toolsetter-Helfer wurden
ergänzt. Der abschließende Lauf endet mit Exit 0 und prüft die folgenden
Erwartungen mit Assertions. Dies ist **kein Gesamt-Gate**.

| Gegenfall / Vergleich | Beobachtung |
| --- | --- |
| `auto_run.line = 2147483648` | Schema akzeptiert; Original-Dispatch ruft Start-/Toolsetter-Vorbereitung und Moduswechsel auf; Fake-C-Bindung verweigert AUTO mit `TypeError`, eine Modusschreibung bereits gebucht |
| `auto_run.line = 0` und `2147483647` | Beide erreichen die Fake-AUTO-Schreibung, je zwei Fake-Schreibungen einschließlich Modus |
| `hello.session = ["x"]` oder `{"x":1}`, jeweils `resume_armed:true` | Original-Reader-Schleife wirft `TypeError` in der Hold-Suche; der folgende Heartbeat bleibt ungelesen |
| `save_settings.section = []` oder `{}` | Original-Reader-Schleife wirft `TypeError` in `_ws_save_settings`; der folgende Heartbeat bleibt ungelesen |
| `save_settings.section = "unknown-section"` | Benannte Ablehnung; folgender Heartbeat wird beantwortet |
| `touchoff.expect = {kins_type:null,g5x_index:1}` | Bestehendes Schema akzeptiert die absichtliche „unbekannt“-Darstellung |

Grenzen der Sonden: Die Reader-Schleife wird unverändert per AST aus
`ws_endpoint` entnommen und in Speicher mit einer Rahmenwarteschlange
ausgeführt; dies ist **kein echter Socket-Test**. Die Aufrufer von
`_ws_save_settings` und `_peek_armed_resume_hold` sowie diese Helfer sind
Originalcode. Die AUTO-Sonde benutzt Schema, Dispatch-Gruppe und
`_cmd_blocking`; Dateibindung, Zulassung, Toolsetter und Laufbasis sind
isoliert, die Modusfunktion schreibt direkt auf die Fake-Bindung. Sie
belegt die Reihenfolge und den C-Argumentfehler, keine reale Maschinenfahrt
und keine vollständige Startzulassung.

## Absichtliches `null` im Client

Am Prüfstand:

- `lcnc-webui/src/useTouchoffMath.ts:36`: `TouchoffExpect` erlaubt bei beiden
  Dimensionen `number | null`; der Kommentar erklärt unbekannte Dimensionen.
- `lcnc-webui/src/SetupStrip.vue:95`: `expectNow()` erzeugt diese Werte mit
  `?? null`.
- `useTouchoffMath.ts:58`: `_fireTouchoff` reicht das Objekt weiter.
- `lcnc-gateway/command_policy.py:1324`: `ExpectMap` prüft bekannte Werte,
  überspringt ausdrücklich die unbekannte Dimension.

Die Suche nach einem wörtlichen `null` im direkten `fire`-Aufruf kann diese
zulässige Nachricht deshalb nicht ausschließen.

## Primärquellen, gelesen am 13. November 2026

- [LinuxCNC 2.9.4, emcmodule.cc, emcauto](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/usr_intf/axis/extensions/emcmodule.cc#L1149):
  AUTO_RUN liest Funktionsnummer und Zeile als C-`int` mit dem Parserformat
  `ii`. Die Fake-Bindung bildet diesen Wertebereich ab. Eine unbegrenzte
  JSON-Ganzzahl ist daher kein hinreichender Vertrag für diesen Aufruf.
- [LinuxCNC 2.9, Homing Configuration, HOME_SEQUENCE](https://linuxcnc.org/docs/2.9/html/config/ini-homing.html#_home_sequence):
  Bei negativem Sequenzwert eines einzeln angeforderten Joints referenziert
  LinuxCNC alle Joints mit gleichem Betrag der Sequenz zusammen.
- [LinuxCNC 2.9.4, homing.c, do_home_one_joint](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/motion/homing.c#L245):
  Der negative Zweig wählt eine Sequenz und startet deren Joints; der andere
  Zweig wählt den einzelnen Joint. Damit ist die Gruppenwirkung bereits am
  verwendeten Versionsstand belegt. Die in der Anfrage genannte Folge
  `[-1,-1,-1]` ist ein Gegenfall zum Versprechen „diese einzelne Achse“.

Die Homing-Dokumentation beschreibt außerdem veränderbare Sequenzwerte über
`ini.N.home_sequence`. Eine INI-Aufnahme allein darf deshalb nicht als
Nachweis unveränderlicher Laufzeitwerte ausgegeben werden.
