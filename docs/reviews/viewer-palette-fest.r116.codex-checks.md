# R116 · Codex · Prüfaufbau

Stand `87f59037e83a9a2205ee2a42054cb50c9c6743c9`, Diff `f8834c3c..87f59037`, angenommenes Vertragsdokument `docs/reviews/restpruefung-lauf.plan.md` Fassung 4. Arbeitskopie: `/tmp/codex-r116-zwu6k4_4` aus `git archive`. Im Live-Baum nur Review-Anhang und neue R116-Codex-Belege.

## Ausgeführte Prüfungen

- Quellprüfung der vier Pakete, der ergänzten Tests, der Anfrage und des berichteten Gates.
- Vitest: `checkBasis.test.ts`, `collisionRange.test.ts`, `collisionWorker.test.ts`, `sweepShards.test.ts`: **53/53 PASS**, ein Worker, privater Cache, `nice -n 19`.
- Backend: `test_bulk_pipeline.TestRunBinding`: **9/9 PASS** mit dem unten beschriebenen Launcher.
- Eigene Client-Sonden: **4/4 bestätigen die im Review beschriebenen Gegenfälle**. Das sind Reproduktionsproben des vorhandenen Verhaltens, keine grünen Regressionswächter für eine Korrektur.
  - Echter Bereichssweep → echter Emit-Ausdruck → echter GcodePanel-Titel: `boundary` geht verloren. Zusätzliche Auswertung des echten Tint-Helfers; der physische Kontakt selbst wird damit nicht bestritten.
  - Echter am Zeitbudget beendeter Suffix → echte `sweptFrom`/`sweptFrac`/`sweepCaveat`-Computeds: angezeigtes Band [0.5, 1], tatsächlich nur bis 0.5, kein Caveat während des laufenden Vollsweeps.
  - Echtes `boundaryDetail` mit fünf kontrollierten Eingangspaaren: nur drei sind benannt.
  - Echter `_colWorker.onmessage`-Handler und `runCollisionCheck`, Worker und Request-Bau durch Spies ersetzt: `needBodies` verliert Bereich/Generation. Eine anschließende Ergebnisantwort führt keinen Phasenwechsel aus. Kein natürlicher Browser-Worker-Ausfall behauptet.
- Eigene Backend-Sonde: echte `_cmd_blocking`, `_begin_run_basis`, `_run_for_pin` im bestehenden `fake_linuxcnc`-Aufbau. Erster verifizierter Start als Fixture, einmaliger Poll-Fehler beim zweiten Start eingespeist. Beide Befehle erreichen nur den Fake-Spy; der alte verifizierte Lauf bleibt erhalten. Keine echte Steuerung.

## Einschränkungen des Prüfaufbaus

SFC-Ausdrücke/-Funktionen werden mit dem TypeScript-Parser unverändert aus den Originaldateien extrahiert und transpiliert. Abhängige Refs und äußere Dienste sind kontrollierte Eingaben. Das prüft die konkrete Berechnungs-/Weitergabelogik, keine Pixel, Browserereignisse oder native Maschine.

Die erste Coverage-Sondenfassung löste noch keinen Zeitabbruch aus: Der kurze Sweep erreichte keinen Budget-Checkpoint. `client-probe-setup.txt` hält diesen Fehlversuch fest. Die endgültige Sonde setzt zusätzlich `yieldMs:0`, sodass der vorhandene Zeitbudget-Checkpoint deterministisch erreicht wird; Erwartung und Produktcode unverändert.

Die ersten Backend-Läufe blieben im asyncio-Selector hängen. Ein auf zwölf Sekunden begrenzter Diagnoseversuch zeigt den wartenden Selector und einen bereits wartenden Executor-Thread (`backend-diagnostic.txt`); die unbegrenzten Versuche wurden abgebrochen. Der Testlauncher `backend-runner.py` lässt den Selector alle 20 ms aufwachen. Er ersetzt weder `to_thread` noch eine Produktfunktion oder Testassertion; damit liefen die Tests durch. Dieser Aufbau ist ausdrücklich kein Laufzeit-/Lastnachweis. Die ursprünglichen Logs bleiben zur Einordnung erhalten.

Keine Builds, Browser, Server/Ports, nativen Parses, HAL-Zugriffe oder Maschinenbefehle. Kein Gesamtgate wiederholt. Die separate Lastmessung, Startlatenz und Live-Abnahme bleiben offen.

## Wiederholung

`git archive 87f59037` in eine temporäre Kopie entpacken. Node-Abhängigkeiten lesend bereitstellen; `.tmp`, `.cache`, `.vite` und `.vite-temp` nicht teilen. Die veröffentlichte `viewer-palette-fest.r116.codex-client.test.ts` nach `lcnc-webui/src/viewer/r116.codex.test.ts` kopieren. Konfiguration `lcnc-webui/r116.vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'../r116-vitest-cache',test:{environment:'node',maxWorkers:1,fileParallelism:false,testTimeout:120000,include:['src/**/*.test.ts']}});
```

Aus `lcnc-webui`, Ausgabeverzeichnis vorher anlegen:

```sh
R116_EVIDENCE=/tmp/r116-evidence nice -n 19 node node_modules/vitest/vitest.mjs run --config r116.vitest.config.ts src/viewer/r116.codex.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r116.vitest.config.ts src/viewer/checkBasis.test.ts src/viewer/collisionRange.test.ts src/viewer/collisionWorker.test.ts src/viewer/sweepShards.test.ts
```

Backend: `backend-runner.py` und `backend-probe.py` aus den veröffentlichten Dateien mit diesen kurzen Namen nebeneinander ablegen. Aus der Archivkopie `lcnc-gateway`, mit dem Interpreter des Gateway-Venv und privatem `PYTHONPYCACHEPREFIX`:

```sh
PYTHONPATH=$PWD nice -n 19 /path/to/gateway-venv/bin/python3 /tmp/r116-evidence/backend-runner.py unit
PYTHONPATH=$PWD nice -n 19 /path/to/gateway-venv/bin/python3 /tmp/r116-evidence/backend-runner.py probe /tmp/r116-evidence/backend-probe.json
```

Die Zeitmessungen dieser Probe sind Diagnosewerte; die Backend-Starts sind ausschließlich Aufrufe von `fake_linuxcnc`.
