# R63 – Reproduktion und Prüfgrenzen (Codex, 2026-10-02)

Prüfstand: unverändertes `git archive 21a1b68` (wip/part-b) nach
`/tmp/codex-r63-jwqq79x4`. Vergleich `951f034..21a1b68`.
Live-Checkout: `c265c0e`, `feat/keypad-keys`; dort nur Review-Anhang und
neue Belege, keine Produktänderungen, Builds, Tests oder Checkouts.

## Backend

Alle Befehle im Archiv; `fake_linuxcnc.install()` läuft vor dem Import
des Gateways. Kein echter LinuxCNC-Binding-Aufruf, kein Server, keine
Verbindung zu Live-Ports, keine Maschinenbefehle. `LCNC_LOG_DIR` zeigt
in das Archiv; `PYTHONDONTWRITEBYTECODE=1` verhindert Schreibzugriffe
auf die nur gelesene installierte venv. Der Gateway-Import kann über
`pgrep` eine laufende Instanz sehen und eine Bindemeldung ausgeben;
STAT und CMD sind trotzdem ausschließlich Attrappen.

```sh
env -u LCNC_INI_FILE -u LCNC_LAUNCHER_PID \
  PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/codex-r63-jwqq79x4/runlogs \
  OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  timeout 30s nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python3 \
  evidence/viewer-palette-fest.r63.backend-runner.py .

env -u LCNC_INI_FILE -u LCNC_LAUNCHER_PID \
  PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/codex-r63-jwqq79x4/runlogs \
  OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  timeout 30s nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python3 \
  evidence/viewer-palette-fest.r63.mode-probe.py .
```

- Abschließend **33/33** Tests: vier Meldungstests und 29 vorhandene
  Tests der Klasse `TestGoToZeroAndJogStopDispatch`.
- Eigene Sonde: **8/8** Fälle; sieben echte Dispatch-Antworten mit
  verweigertem MDI und ein direkter Moduswechsel nach MANUAL.
- Die unveränderte Fake-Klasse hat standardmäßig `axis_mask=7` (XYZ),
  fünf Jog-Tests dieser Testklasse verwenden aber Achse 3. Der direkte
  Klassenlauf ergibt deshalb fünf Fehler (`axis 3 above maximum 2`).
  Der beiliegende Runner setzt **vor** dem Import allein die Fake-Maske
  auf XYZAC (`0b00101111`), ohne Testassertionen oder Produktcode zu ändern.
  Der abschließende Log gehört exakt zu diesem Runner.
- Die zusätzliche Sonde verwendet Achse 0, hat eigene STAT-Fälle mit
  `joints`/`homed` und bestätigt vollständige Fehlermeldungen. In ihrer
  ersten Version fehlte der vorhandene `ValueError: `-Präfix in der
  Erwartung; `mode-probe-initial.txt` hält diesen Sondenfehler fest.
  Danach nur diese Erwartung korrigiert; Sollverhalten unverändert.

Die Sandbox ließ bereits einen nackten `asyncio.run(asyncio.to_thread(...))`
nicht fertig werden (Timeout, `asyncio-sandbox.txt`). Ein erster breiter
Lauf wurde unterbrochen; der zweite mit 20 s begrenzt und nach 8 s mit
Stackdump dokumentiert (`backend-initial-interrupted.txt`,
`backend-targeted.txt`). Die erfolgreichen Läufe liefen nach automatischer
Freigabe außerhalb dieser Sandbox, weiterhin ausschließlich mit dem Fake.
Keine Produktbefunde aus diesen Infrastrukturfehlern abgeleitet.

## Plan

```sh
python3 evidence/viewer-palette-fest.r63.plan-probe.py . \
  > evidence/viewer-palette-fest.r63.plan-probe.json
python3 evidence/viewer-palette-fest.r63.plan-sketch.py \
  evidence/viewer-palette-fest.r63.plan-probe.json \
  > evidence/viewer-palette-fest.r63.plan-sketch.svg
```

Die Rechnung liest die tatsächlichen vier Theme-Blöcke aus `style.css`
und prüft Near-Clipping mit fester Weltphase sowie die neue Hysterese.
Die SVG ist eine maßhaltige Rechenskizze der beschriebenen Regeln,
**kein Screenshot, kein Three.js-Prototyp und keine Produktabnahme**.
Die gezeigte 3-px-Unterlage an den Endmarken ist ein Vorschlag, kein
bereits vereinbarter Darstellungsvertrag.

Kein erneutes vollständiges Offline-Gate, keine Frontend-Builds oder
Browserläufe, da der Implementierungsdiff nur die Backend-Meldung
betrifft und Paket 4 noch ein Plan ist. Frühere R62-Abnahmen werden nicht
erneut bewertet. Keine Produktänderung, kein Commit; alte Belege bleiben
unverändert. Keine eigenen Server oder anderen Dauerprozesse gestartet.
