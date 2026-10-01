# R64 – Reproduktion und Grenzen (Codex, 2026-10-02)

Stand: unverändertes `git archive f1b7e27` aus `wip/part-b` nach
`/tmp/codex-r64-o1ss9r7u`. Vergleich `d3e6e26..f1b7e27`.
Live-Checkout während des Reviews: `517b807` auf `feat/keypad-keys`.
Der geprüfte Diff enthält zwei Dokumente und Testpflege, keinen Produktcode.

## Tests

Im Archiv, `lcnc-gateway`:

```sh
env -u LCNC_INI_FILE -u LCNC_LAUNCHER_PID \
  PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/codex-r64-o1ss9r7u/runlogs \
  OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  timeout 30s nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python3 \
  -m unittest -v test_command_dispatch.TestHandlerExecution \
  test_command_dispatch.TestGoToZeroAndJogStopDispatch \
  test_gateway_util.TestModeSwitchIgnoredMessage
```

**68/68 PASS**, ohne den R63-Runner oder Änderungen an der Fake-Klasse:
35 Handler-, 29 Go-to-zero/Jog-Dispatch- und vier Meldungstests.

Im Archiv-Hauptverzeichnis, dieselben Umgebungsvariablen:

```sh
timeout 30s nice -n 19 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python3 \
  evidence/viewer-palette-fest.r64.fixture-probe.py .
```

**3/3 PASS**: Drei relevante vorhandene Tests starten mit absichtlich
vorgefülltem XYZ-Grenzencache. C-Jog, A-Jog/Meldung und fehlendes Homing
werden korrekt geprüft. Nach jedem Test ist exakt der vorherige Cache
wiederhergestellt, und die Default-Fake-Klasse bleibt XYZ. Die Sonde
ändert keine Produktfunktionen und keine bestehenden Testassertionen.

Beide Läufe erfolgten nach automatischer Freigabe außerhalb der Sandbox:
deren Hänger bei reinem `asyncio.to_thread` ist bereits in R63 belegt.
`fake_linuxcnc.install()` läuft vor jedem Gateway-Import; STAT und CMD
sind ausschließlich Attrappen. Keine echten Binding-Befehle, keine
Verbindung zu Live-Ports und kein gestarteter Gateway-Server. Die
vorhandene Importdiagnose kann einen laufenden Prozess per `pgrep`
erkennen, verwendet trotzdem die Fake-Bindings. Logs liegen im Archiv;
die installierte venv wird nur gelesen, Bytecode-Schreiben ist deaktiviert.

## Plan

```sh
python3 evidence/viewer-palette-fest.r64.plan-probe.py . \
  > evidence/viewer-palette-fest.r64.plan-probe.json
```

Reine Standardbibliothek, liest die Theme-Tokens im Archiv:

- Die neue Δt-Regel löst den R63-Fall mit 100 px und sichtbarem 1/51:
  N=512, nominal 9,96 px, beide Töne geometrisch vorhanden.
- Exakter 15-px-Grenzfall unter der beschriebenen Hysterese: N=8,
  sichtbares Intervall [7/8,1], nur eine Zelle mit positiver Länge.
- Perspektivische Gegenprobe: 100 px, N=16, nominal 6,25 px. Erste
  dunkle Zelle 99,85 px, alle hellen Anteile zusammen nur 0,106 px.
  Ideale Abtastung an Pixelzentren bei DPR 1/2 trifft ausschließlich
  Dunkel. Das ist ein mathematisches Rasterbeispiel, **kein Screenshot**
  und keine Aussage über ein schon vorhandenes Antialiasing des geplanten
  Musters. Es widerlegt die Ableitung garantierter Raster-Sichtbarkeit
  allein aus `N · Δt`.
- Endmarken: mit dem nun vollständigen hellen Träger kontrastiert auf
  allen vier Theme-Hintergründen mindestens einer der beiden Bestandteile
  stark (17,13:1 bis 21:1). Die räumliche Darstellung vor Modellen bleibt
  Teil der späteren Implementierungs-/Sichtprüfung.

Keine Frontend-Builds, Browserläufe, vollständigen Gates oder Live-Abnahmen
erneut ausgeführt. Paket 4 ist noch ein Plan. Im Live-Checkout nur den
Review ergänzt und neue `viewer-palette-fest.r64.*`-Belege abgelegt.
Keine Produktänderung, kein Commit; frühere Belege unverändert.
