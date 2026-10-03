# R72 · Codex · Prüfprotokoll

Geprüfter Bereich: `b3ec5ee..6cd7310` auf `feat/macros`.
Ausführung aus `git archive 6cd7310` in `/tmp/codex-r72-cjyw0myu/archive`;
Live-Checkout nur gelesen sowie um Review und neue Belege ergänzt.

## Umfang und Ergebnisse

- Alle fünf geänderten Dateien gelesen: Gateway, Makrotests, Plan, Entscheidungen und CLAUDE-Vertrag.
- `test_macro_files.py` und `test_macros_gateway.py`: **79 bestanden**. Darin auch der neue
  FIFO-/Verzeichnisfall mit Liste, GET, PUT und DELETE sowie bestehende normale Dateien,
  interne/externe/defekte Links, Startansprüche und Schreibzulassung.
- Eigene R71-Gegenproben: **2 bestanden**. Assertions unverändert; ausschließlich der
  JSONL-Ausgabename wurde auf R72 umgelenkt. Verzeichnis: HTTP 403. FIFO:
  `_MacroOutside`, ohne einen Schreiber zum Entsperren öffnen zu müssen.
- Gesamter eigener Lauf: **81 passed in 1.84s**, Exit 0; vollständige Ausgabe in
  `viewer-palette-fest.r72.backend.txt`, Gegenproben-Ergebnisse in
  `viewer-palette-fest.r72.r71-rerun.jsonl`.
- Quellprüfung: `O_NONBLOCK` am Öffnen; `fstat`/`S_ISREG` vor `fdopen`; der neue
  Ablehnungs-/fstat-Fehlerpfad schließt den Deskriptor. Die normale Leseoperation bleibt
  durch den Kontextmanager geschlossen. Kein Produktcode geändert.
- Seriennummern-Erklärung entspricht dem nativen Nachweis aus R71: gemeinsamer CMS-Puffer,
  Bindung an diese Instanz. Keine funktionale Änderung der Startfreigabe in dieser Runde.
- `git diff b3ec5ee..6cd7310 --check` meldet lediglich eine zusätzliche Leerzeile am Ende
  von `docs/decisions.md:7801`; kein funktionaler Befund. Eigener Review-Diff separat geprüft.

## Wiederholung

Die beiliegende `viewer-palette-fest.r72.r71-probe.py` als
`lcnc-gateway/test_r72_r71.py` in eine Archivkopie legen, daneben auf Archivwurzelebene
`evidence/` anlegen. Dann aus `lcnc-gateway/`:

```sh
PYTHONDONTWRITEBYTECODE=1 timeout 60 nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest -o addopts= -q -p no:cacheprovider test_macro_files.py test_macros_gateway.py test_r72_r71.py
```

Die Tests installieren Fake-LinuxCNC und verwenden temporäre Dateien bzw. ASGI-Aufrufe
im Prozess. Keine Verbindung zur Steuerung oder zu den Live-Ports, kein Maschinenbefehl.
Die Ausführung erfolgte außerhalb der Sandbox, weil deren Thread-/Async-Abläufe in den
vorherigen Review-Läufen blockierten.

## Grenzen

Kein eigener vollständiger Offline-Gate-Lauf und keine erneute Browserprüfung: Frontend
unverändert in diesem Bereich. Claudes 1245 Backend-PASS bleiben dessen Ergebnis. Die
nicht geklärten Browser-Schwankungen aus R71 werden durch diesen Lauf nicht widerlegt.
Die laufende Operator-Sim wurde weder getestet noch neu gestartet. Laut Anfrage erhält
sie den Fix mit dem nächsten Gateway-Neustart.
