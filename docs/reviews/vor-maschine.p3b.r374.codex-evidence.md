# R374 · Codex · Prüfnachweis

Geprüfter Produktkopf: `d7431f199a510c662e5363035ea8e15d3656d787`, Änderungen seit `1fe5e274`. Gelesene Anfrage: `149f9963` auf `feat/backlog-integration`. Eigene Archivkopie: `/tmp/codex-r374`.

Nur offline geprüft. Keine Browser- oder Serverstarts, keine Verbindung zur Live-Sim und keine Änderung an Produktcode. Der Live-Baum erhält ausschließlich Review-Anhang und neue Belege. Der vollständige Browserlauf und die CI wurden nicht neu ausgeführt.

## Tests

Die R373-Sonde wurde unverändert neben `test_replay.py` kopiert:

```sh
cd /tmp/codex-r374
cp /home/cnc/lcnc-suite/docs/reviews/vor-maschine.p3b.r373.codex-probe.py \
  scripts/test_select/test_r373_codex.py
/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q \
  scripts/test_select/test_replay.py scripts/test_select/test_r373_codex.py
```

**138/138 grün:** 121 Wächter des Kopfes und 17 eigene Fälle aus R373. [Ausgabe](vor-maschine.p3b.r374.codex-tests.txt). Die damaligen 13 falschen PASS werden jetzt als ungültig erkannt; die vier gültigen Kontrollfälle bleiben gültig.

Quellenprüfung: Reader-Regeln einschließlich Pflicht/optional, `save_settings`-Querregel und Geräteauswahl gegen `gateway.py`/`settings_store.py`; vollständige Herkunftszuschreibung für WS und HTTP; Verbindungsanfänge und doppelte Anfänge; genaue No-Cookie-Ausnahme; zusätzliche Formprüfungen für Ereignis- und Replay-Zeilen; vollständige Versuchsliste; angepasste Dokumentation. Die unveränderte Transportaufzeichnung und Inventarerzeugung bleiben Gegenstand des bereits erfolgten R373-Reviews.

## Vollständige Artefakte und Gegenproben

[Artefakt-Sonde](vor-maschine.p3b.r374.codex-artifact-probe.py), [Ergebnis mit SHA-256 der Eingaben](vor-maschine.p3b.r374.codex-artifact-probes.json). Die Sonde ist die aus R373; ausschließlich das ausgegebene Metadatum `reviewed_head` wurde auf `d7431f19` gesetzt. Ihre fünf Manipulationen sind unverändert. Sie schreibt nur in temporäre Kopien der Replay-Dateien; Ereignislog und Playwright-Bericht bleiben unverändert.

```sh
/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 \
  /path/to/vor-maschine.p3b.r374.codex-artifact-probe.py \
  /tmp/codex-r374 /home/cnc/rgrp6/gate-round.logs /tmp/r374-artifact-probes.json
```

| Eingabe | Urteil | Entscheidender Befund |
|---|---|---|
| Unveränderter vollständiger Lauf `rgrp6` | PASS | 10 981 Rahmen, 922 Versuche |
| `timing_log` ohne `enable` | FAIL | `missing ['enable']` |
| Falsches Projekt am Verbindungsanfang | FAIL | Cookie-Projekt passt nicht zum Versuch |
| Rahmen am Mock des anderen Workers | FAIL | Mock-Instanz passt nicht zum Versuch |
| Nicht-JSON-Rahmen ohne Verbindungsanfang | FAIL | Formfehler und Verbindung ohne `open`; Rahmen wird mitgezählt |
| Falsche Hello-Nutzlast der No-Cookie-Ausnahme | FAIL | Fremdfeld, falscher Feldwert und Abweichung vom genau benannten Rahmen |

`proof.check_workers` bleibt ohne Befund. Die zusätzlichen Fehler werden jetzt durch den Replay erkannt, wie vorgesehen.

Außerdem beide unveränderten Aufzeichnungen mit dem neuen Prüfer neu beurteilt: [Zusammenfassung und zwölf Versuche ohne Mock-Seite je Lauf](vor-maschine.p3b.r374.codex-rejudge.json).

- `rgrp4`: PASS, 9 608 Rahmen = 9 607 Testrahmen + ein genau benanntes No-Cookie-Hello.
- `rgrp6`: PASS, 10 981 Rahmen = 10 980 Testrahmen + ein genau benanntes No-Cookie-Hello.
- In beiden Läufen: 922 eindeutige Versuchsschlüssel `(test, project, retry)`, 922 Einträge in beiden Versuchsausgaben; zwölf ohne Mock-Seite mit jeweils null Rahmen und leerem Befehlszähler. Die Summe der Versuchsrahmen stimmt mit der Klasse `test` überein. Genau eine No-Cookie-Verbindung mit genau dem erwarteten Rahmen.

## Grenzen

Das Agreement betrifft Schritt 5a: die aufgezeichneten WS-Nutzlasten im benannten Replay-Vertrag. Maschinenzustand, Zulassung und Wirkung, Profilgrenzen, HTTP-Nutzlasten/Antwortwege sowie Funktionsabdeckung werden dadurch nicht bewiesen. Fehlende Verkehrsbeobachtung ist ausdrücklich keine Abdeckungszusage. Die genannten synthetischen Gegenfälle sind belegt; daraus folgt keine allgemeine Garantie eines Berichts bei beliebigen Betriebssystem-, Speicher- oder Dateilesefehlern.
