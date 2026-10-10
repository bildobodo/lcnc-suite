# R121 · Codex · Prüfaufbau

Stand `a5faea3a7d3ff05163dc3149fd6389e6380ad52d`, Basis `28ebc3f5`. Eigene Archivkopie `/tmp/codex-r121-3p2ta8ge`. Im Live-Checkout nur Review-Anhang und neue Belege. Bestehende Belege unverändert; keine Live-Ports, HAL-Ladevorgänge oder Maschinenbefehle.

## Ergebnisse

- `scripts/test_toolsetter_readback_check.py`: 15 Tests und vier Subtests PASS.
- `lcnc-gateway/test_config_sync_check.py`: acht Tests PASS. Dessen Pytest-Konfiguration unterdrückt die Schlusszusammenfassung; acht grüne Punkte und Prozess-Exit 0.
- R120-Sonde als Kopie: alle zwölf Fälle erfüllen ihre Erwartung. Drei unveränderte installierte Profile werden akzeptiert, neun abweichende INI-/HAL-/Skriptfälle abgelehnt. Die konkrete `loadusr`-Zeile liefert jetzt den Interpreter und die ausgeführte Python-Datei.

## Wiederholen

Archivkopie des genannten Commits anlegen; `viewer-palette-fest.r121.codex-target-rerun.py` nach `evidence/target-rerun.py` kopieren. Vom Archivwurzelverzeichnis mit der Gateway-Pythonumgebung:

```bash
python -m pytest -q -p no:cacheprovider scripts/test_toolsetter_readback_check.py
python -m pytest -q -p no:cacheprovider lcnc-gateway/test_config_sync_check.py
PYTHONPATH="$PWD/lcnc-gateway" python evidence/target-rerun.py evidence/target-rerun.json
```

Hier wurde `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python` mit `nice -n 19` und `PYTHONPYCACHEPREFIX` in der Archivkopie verwendet. Produktcode und Repository-Assertions unverändert.

## Anpassungen gegenüber der R120-Sonde

- Die zwei Erwartungen für geänderte/fehlende `sim_toolsetter_feed.py` lauten jetzt „abgelehnt“.
- Erwartete Ausgabe von `_runs`: `[("path", "python3"), ("file", "sim_toolsetter/sim_toolsetter_feed.py")]`.
- Ein kontrollierter `which`-Resolver zeigt `hal_watchdog.py`, `hal_reader.py` und `compensation.py` auf ihre tatsächlichen Quelldateien in **diesem Archiv**. Der produktive Resolver würde die im System installierten Links auf den Live-Checkout finden und sie für die fremde Archivkopie richtigerweise ablehnen. Für andere Namen wird `shutil.which` verwendet.
- Bezeichner, temporäre Dateipräfixe und Abschlussmeldung auf R121 angepasst. Die drei installierten Profile und die Eingriffe der Gegenfälle sind unverändert.

Die Sonde importiert mit `fake_linuxcnc`, erstellt Kopien von INI, HAL und Toolsetter-Helfer in einem temporären Verzeichnis und ruft nur Validator/Scanner auf. Die simulierte Skriptänderung (Werkzeuglänge +100) wird nicht ausgeführt. Tests und Sonde prüfen die Dateizulassung, nicht die reale Maschine oder deren aktuelle Prozessumgebung.

`sources.json` vergleicht gelesene Quellen mit den Git-Objekten des Review-Stands. `context.json` hält ursprünglichen Review-Hash und sauberen Arbeitsbaum fest. `sha256.json` umfasst neue Belege außer sich selbst. Claudes Gesamtgate, Mutationen und Live-Protokoll gelesen, nicht erneut ausgeführt. Keine Änderung an Frontend oder Gateway, daher keine breiteren Wiederholungsläufe.
