# R120 · Codex · Prüfaufbau

Stand `66c16ab79c8701546767b9a611a9c25d3bc2d6a8`, Basis `da5f8d86`. Eigene Archivkopie `/tmp/codex-r120-75lezwxd`. Im Live-Checkout nur Review-Anhang und neue Belege. Bestehende Belege bleiben unverändert.

## Ausgeführt

- Neun Tests in `scripts/test_toolsetter_readback_check.py`: PASS.
- Acht Tests in `lcnc-gateway/test_config_sync_check.py`: PASS. Dessen Pytest-Konfiguration unterdrückt die Schlusszusammenfassung; Protokoll zeigt acht grüne Punkte, Prozess-Exit 0.
- Zwölf eigene Validatorfälle: drei originale installierte Profile akzeptiert, sieben abweichende INI-/HAL-Fälle abgelehnt, zwei Restfehler bei einem geänderten bzw. fehlenden Python-Helfer reproduziert.

Alle Prüfungen mit `nice -n 19` und `PYTHONPYCACHEPREFIX` im Archiv. Keine Gateway-Verbindungen, HAL-Ladevorgänge oder Maschinenbefehle. Die eigene Sonde importiert den Prüfhelfer mit `fake_linuxcnc`, ruft ausschließlich den Validator und `_runs` auf und führt keinen untersuchten Dateiinhalt aus.

## Wiederholen

Neue Archivkopie des Commits anlegen. `viewer-palette-fest.r120.codex-target-probe.py` nach `evidence/target-probe.py` kopieren. Vom Archivwurzelverzeichnis mit der vorhandenen Gateway-Pythonumgebung:

```bash
python -m pytest -q -p no:cacheprovider scripts/test_toolsetter_readback_check.py
python -m pytest -q -p no:cacheprovider lcnc-gateway/test_config_sync_check.py
PYTHONPATH="$PWD/lcnc-gateway" python evidence/target-probe.py evidence/target-probe.json
```

Hier wurde `/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python` verwendet, ausschließlich mit dem Code der Archivkopie. Die bestehenden Repositorytests und ihre Assertions sind unverändert.

## Anpassung der R119-Sonde

Die drei INIs werden jetzt mit `render_ini(template, template, archive_root)` erzeugt. `hallib` und `sim_toolsetter` werden in das private temporäre Installationsverzeichnis kopiert. Das berücksichtigt die neue Prüfung der installierten Pfade; rohe Vorlagen-INIs wären kein gültiger Positivfall mehr. Die sieben negativen Kontrollen betreffen fremde aktive INI, fremden Profilnamen, anderen HALFILE-Namen, anderen Inhalt unter gleichem HAL-Namen, zusätzlichen HALCMD, veränderte eingebundene HAL und fehlende eingebundene HAL.

Für den offenen Rest wird ausschließlich die ausgelieferte Rückgabe `return length, True, "armed"` in der temporären `sim_toolsetter_feed.py` zu `return length + 100.0, True, "armed"` geändert; danach wird die temporäre Datei entfernt. Der Validator akzeptiert beide Varianten. Aus der unveränderten HAL wird die tatsächliche `loadusr`-Zeile gelesen; `_runs` liefert dafür `[]`. Keine dieser Dateien wird ausgeführt. Dies ist ein Nachweis der Zulassungslücke, kein Live-Start mit fehlender oder geänderter Komponente.

Die Behandlung von `-Wn name` wurde zusätzlich am [LinuxCNC-Handbuch zu halcmd](https://linuxcnc.org/docs/2.9/html/man/man1/halcmd.1.html) geprüft: der Name gehört zur Warteoption, danach folgt das auszuführende Kommando.

`sources.json` vergleicht die gelesenen Produkt-/Testdateien mit den Git-Objekten. `context.json` enthält den vorigen Review-Hash und sauberen Arbeitsbaum. `sha256.json` umfasst die neuen Belege außer sich selbst. Claudes Gesamtgate, Mutationen und Live-Prüfung nur gelesen; mangels Frontend-Änderung keine Build-/Browserwiederholung.
