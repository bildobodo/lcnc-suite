# R373 · Codex · Prüfnachweis

- Produktstand: `533c71fc..1fe5e274f423f32ae15ec7b7469cd109cdbef549`.
- Gelesene Anfrage: Live-Dokument an `ea1fd007ce2efaf2fb82817a37e2329c540a0f71`.
- Ausführung ausschließlich in der Archivkopie `/tmp/codex-r373`. Keine Verbindung zur Sim, keine Maschinenbefehle, keine Browser- oder Serverstarts, kein Produktcode geändert.
- Python: `/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3`. Node-Abhängigkeiten für den Unit-Test als eigene Kopie aus `~/lcnc-suite-rp/lcnc-webui/node_modules`.

## Unveränderte Wächter

```sh
cd /tmp/codex-r373
/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3 -m pytest -q scripts/test_select/test_replay.py
cd lcnc-webui
node node_modules/vitest/vitest.mjs run src/inventory/webAtoms.test.ts --allowOnly=false --retry=0 --reporter=default
```

Ergebnis: **62/62 Python-Fälle**, **25/25 Inventar-Fälle** bestanden. [Python-Ausgabe](vor-maschine.p3b.r373.codex-replay.txt), [Inventar-Ausgabe](vor-maschine.p3b.r373.codex-webatoms.txt).

## Eigene Vertragsproben

[Sonde](vor-maschine.p3b.r373.codex-probe.py) neben `test_replay.py` als `scripts/test_select/test_r373_codex.py` ablegen und mit pytest ausführen. Sie verwendet dessen Protokollbaukasten und den unveränderten Prüfer des geprüften Kopfes.

**13 rot / 4 grün.** Die roten Assertions erwarten `FAIL`; tatsächlich liefert der Prüfer jeweils `PASS`, ohne Ausnahme oder Harness-Fehler. [Ausgabe](vor-maschine.p3b.r373.codex-probe.txt).

| Gruppe | Gegenfälle | Ergebnis am Kopf |
|---|---|---|
| VM-I16 | Pflichtfeld fehlt bei `timing_log`, `halshow_live`, `device_rename`, `save_settings.section`, `save_settings.base_rev`, `tab_visibility` | 6 falsche PASS |
| VM-I17 | falsches/fehlendes Projekt; Rahmen am Mock des anderen Workers; Rahmen ohne `open`, als Objekt bzw. `raw` | 5 falsche PASS |
| VM-I18 | benannter No-Cookie-Socket mit falscher Hello-Nutzlast/Fremdfeld; zwei Hellos statt eines | 2 falsche PASS |
| Kontrollen | gültige Reader-Felder und zwei Worker; erlaubtes fehlendes `device`; exakt benannter No-Cookie-Fall; später Rahmen der alten Verbindung | 4 richtige PASS |

Die Reader-Regeln sind zusätzlich gegen die tatsächlichen Zweige gelesen: `gateway.py` `_ws_save_settings`, `_ws_device_command`, `timing_log`, `halshow_live`, `tab_visibility`; für die Revision `settings_store.py:save_section`. Die opaken Dateninhalte sind kein Gegenstand dieser Proben.

## Vollständige Laufartefakte unabhängig neu beurteilt

Quelle: `/home/cnc/rgrp4/gate-round.logs`, Lauf `gate-2d68bc03-2789-4ec4-9504-619ae8a1dce9`. **Nur Kopien der Replay-Dateien** werden verändert; Ereignislog und Playwright-Bericht bleiben unverändert. [Skript](vor-maschine.p3b.r373.codex-artifact-probe.py), [Ergebnis einschließlich SHA-256 der Eingaben](vor-maschine.p3b.r373.codex-artifact-probes.json).

```sh
python3 /path/to/vor-maschine.p3b.r373.codex-artifact-probe.py \
  /tmp/codex-r373 /home/cnc/rgrp4/gate-round.logs /tmp/r373-artifact-probes.json
```

- **Unverändert:** PASS, 9 607 Rahmen, 922 Versuche, 910 Einträge in `per_attempt`. Auch `proof.check_workers` ergibt keine Befunde.
- **Je eine getrennte Manipulation:** fehlendes `timing_log.enable`; falsches Projekt am Upgrade; ein Test sendet am Mock eines anderen Workers; ein `raw`-Rahmen ohne vorheriges `open`; falsches `resume_armed` plus Fremdfeld im benannten No-Cookie-Hello. Alle fünf ergeben weiter PASS. Die Worker-Prüfung kann diese Änderungen nicht auffangen: Ihre beiden Eingaben sind unverändert.
- Der verwaiste Rahmen und das veränderte No-Cookie-Hello gehen nicht einmal in den Zähler `frames` ein. Er bleibt bei 9 607.

Das sind Offline-Gegenproben des Prüfers, kein Nachweis, dass der gelieferte Browserlauf solche fehlerhaften Rahmen enthielt. Der vollständige Browserlauf und die CI wurden nicht erneut ausgeführt; die vorhandenen Rohartefakte wurden neu ausgewertet. Die unabhängigen Vertragsproben erfordern keine Live-Messung.
