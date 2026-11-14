# R366 · Codex · eigene Prüfungen

Produkt `integ/p3` **6cc51e64**, Dokumentanfrage **227acb64**. Stand und Prüfsummen: [Manifest](vor-maschine.p3a.r366.codex-manifest.json).

Nur Archivkopie `/tmp/codex-r366`. Keine Builds/Tests im Live-Baum, keine Verbindung zur Live-Sim, kein nativer Maschinenbefehl. Die Tests installieren `fake_linuxcnc`; die pytest-Konfiguration verweigert Host-Instanz und Host-NML. Dateien in der Live-Arbeitskopie wurden ausschließlich als neue Belege angelegt bzw. das Review angehängt.

## Bestehende Wächter

`test_payload_contract.py test_payload_scan.py test_home_axis.py test_button_gates_d.py test_button_gates_e.py`: **156 grün**, [Protokoll](vor-maschine.p3a.r366.codex-targeted.txt).

Aus `scripts/test_native_stage.py` die neuen Auswerter und Ablaufwächter (`sim_trip_is_one_pulse`, `coolant_switches`, `tool_table_reload_is_read`, `io_step_judges`, `positioning_move_too_short`): **19 grün**, [Protokoll](vor-maschine.p3a.r366.codex-native-unit.txt). Das ist eine Offline-Prüfung der Messwerkzeuge, kein neuer nativer Lauf.

## Eigene Gegenfälle an der MDI-Grenze

[Probe](vor-maschine.p3a.r366.codex-probe.py), [Daten](vor-maschine.p3a.r366.codex-probe.json), [pytest-Protokoll](vor-maschine.p3a.r366.codex-probe.txt), [JUnit](vor-maschine.p3a.r366.codex-probe.xml): **3 rot, 2 grün**.

Die Probe durchläuft den echten `handle_command` samt Schema und Moduswechsel. Nur das CMD-Ziel ist ein Spy. Dessen `mdi` bildet die String-Grenze von [LinuxCNC v2.9.4, emcmodule.cc, Zeilen 922–934](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.4/src/emc/usr_intf/axis/extensions/emcmodule.cc#L922) nach: UTF-8-Bytezahl aus `s#`, höchstens 255 Bytes, danach Kopie bis zum ersten Nullbyte. Es wird keine Interpreterausführung behauptet. Der Skip-Flag ist im Test bereits bekannt klar; die beobachtete Modusänderung braucht also keine zusätzliche Flag-Bereinigung. Kompensation ist ausdrücklich bekannt aus.

| Fall | Beobachtung | Erwarteter Schutz |
|---|---|---|
| `mdi.text = "G0 X1\u0000 Y2"` | `ok:true`, MODE_MDI geschrieben; am modellierten nativen Ziel kommt nur `G0 X1` an | Ablehnung ohne Schreiben |
| `G4 P0 (` + 130 × `ä` + `)` | 138 Zeichen / 268 Bytes passieren das Schema; erst CMD.mdi verweigert, nach MODE_MDI | Bytegrenze vor dem ersten Schreiben |
| `set_wcs {target:"G54", x:1e300}` | Endliche Zahl passiert; das fertige G10 hat 319 Bytes und wird erst nach MODE_MDI verweigert | Fertigen Befehl vor der Umschaltung begrenzen |
| Vergleich mit 100 × `ä` | 108 Zeichen / 208 Bytes; unverändert angenommen | Gültiges Unicode weiterhin möglich |
| `set_wcs.x = 10**400` | Schema lässt durch, Handler verweigert mit OverflowError **vor** jeder Schreibung | Kein zusätzlicher Befund einer erfolgten Schreibung |

Reproduktion: Probe als `lcnc-gateway/test_r366_codex.py` in eine Archivkopie legen und mit der Gateway-Testvenv per pytest ausführen. `LCNC_LOG_DIR` auf ein eigenes `/tmp`-Verzeichnis setzen. Die mitgelieferte `conftest.py` muss aktiv bleiben.

Die ersten Entwürfe der WCS-Sonde trafen den Schutz für unbekannte Kompensation statt die zu prüfende String-Grenze. Die gespeicherte Fassung nennt den echten Pin `z_eoffset_enable` und erreicht die MDI-Stelle; nur diese Ergebnisse zählen.

## Werkzeugwechselbestätigung ohne Antwort

[JS-Sonde](vor-maschine.p3a.r366.codex-client.cjs), [Ergebnis](vor-maschine.p3a.r366.codex-client.json). Die Sonde extrahiert `confirmToolChange()` per TypeScript-AST aus dem tatsächlichen `App.vue` und führt sie mit kontrollierter Antwortzustellung aus; kein nachgeschriebener Handler und kein Browser-/DOM-Beleg.

- `awaitReply → null`: eine Sendung, `confirmSent="req-1"`, `confirmRefusal=null`. Der neue Timeout erzeugt keinen Hinweis.
- `ok:false`: Sendesperre aufgehoben, konkrete Ablehnung angezeigt.
- `ok:true`: Sendesperre bleibt bis zur Statusbestätigung bestehen.

Die beiden positiven Vergleiche sind grün; die erwartete Meldung beim Timeout fehlt. Reproduktion: `node <Sonde> <Archivwurzel>`; der Kopf der Sonde nennt den hier benutzten TypeScript-Pfad. `App.vue:2674` zeigt bei weiter gesetztem `confirmSent` weiterhin „Confirming…“ und „waiting for the controller“.

## Grenzen

Kein vollständiges Gate wiederholt, keine neue Browser-Sichtprüfung und kein eigener Live-Lauf. Die gelieferten Live-/Gate-Artefakte ergänzen diese gezielten Prüfungen; den angekündigten CI-Lauf habe ich nicht unabhängig abgefragt. Die während des Reviews neu erschienenen `homestep-*`- und `perf-matrix`-Belege sind fremde Paralleländerungen und wurden nicht bearbeitet.
