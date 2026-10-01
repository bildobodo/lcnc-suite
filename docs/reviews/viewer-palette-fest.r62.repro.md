# R62 — Reproduktion und Grenzen (Codex, 2026-10-02)

## Stände

- Hauptprüfung: unverändertes `git archive fec40e5` nach `/tmp/codex-r62-g32c1gtj`.
- Paket 2: eigenes Archiv `83a1d73`, `/tmp/codex-r62-settings-3v45snw6`.
- Paket 3: eigenes Archiv `bc16433`, `/tmp/codex-r62-strip-75_t_400`.
- Live-Checkout während der Prüfung: `0b4019c` auf `feat/keypad-keys`.
  Keine Builds/Tests dort, keine Live-Ports, keine Maschinenbefehle.

Die Pakete wurden einzeln geprüft, nicht als zusätzlicher eigener Merge.
Die gemeinsame Anwendung der Patch-Hunks wurde nicht weiterverfolgt, nachdem
Kontext aus dem R62-Aufräumen und der Settings-Umordnung kollidierte; daraus
wird kein Produktbefund abgeleitet. Alle Artefakte beziehen sich auf die oben
benannten unveränderten Produktstände.

## Isolierte Vorbereitung

In jedem Archiv `lcnc-webui/node_modules` mit den installierten Dependencies
verknüpfen; in den kopierten `tsconfig*.json` die `tsBuildInfoFile`-Pfade von
`./node_modules/.tmp/` nach `../r62-ts-cache/` umleiten, damit nichts durch den
Symlink geschrieben wird. `evidence/` neben `lcnc-webui/` anlegen.
In der kopierten `e2e/ctl.ts` `localhost:4174` durch `127.0.0.1:4188` ersetzen.
Die jeweilige beiliegende Playwright-Config heißt dort `r62.playwright.config.ts`.
Hauptsonde nach `e2e/r62.spec.ts`, Strip-Sonde nach `e2e/r62-packages.spec.ts`.

Build jeweils im kopierten `lcnc-webui`:

```sh
VITE_GATEWAY_PORT=4188 nice -n 19 npm run build
```

Hauptarchiv, `r62.vitest.config.ts` aus dem Beleg übernehmen:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r62.vitest.config.ts
```

Alle Browserläufe mit einem Worker und eigenem Mock, nacheinander:

```sh
MOCK_HOST=127.0.0.1 MOCK_PORT=4188 nice -n 19 node e2e/mock-gateway.mjs
# in einem zweiten Terminal, gleiches Archiv:
nice -n 19 node node_modules/@playwright/test/cli.js test --config r62.playwright.config.ts --grep 'R62:|G49 with a tool'
# Paket 2:
nice -n 19 node node_modules/@playwright/test/cli.js test --config r62.playwright.config.ts --grep 'Settings: as wide'
# Paket 3:
nice -n 19 node node_modules/@playwright/test/cli.js test --config r62.playwright.config.ts --grep 'R62:|rotary jog buttons share'
```

Die Hauptsonde ist die R61-Sonde mit unveränderten Soll-Assertions;
nur Rundennamen, Commit-Metadatum und Ausgabepfade sind auf R62 gesetzt.
Hauptprüfung 2/2, Settings 1/1, vier vorhandene Strip-Prüfungen 4/4.
Die zusätzliche Strip-Sonde prüft 3/5/6/9 Achsen in drei Viewports, misst
Trefferflächen und deren Überlappungen; final 1/1 PASS. Der erste eigene
Strip-Lauf hatte eine fehlerhafte Auswertung von CSS `min-height:auto`
als NaN. Das ist in der Sonde korrigiert. Ein weiterer Lauf wurde beim
Verlust des eigenen Mocks mit `ERR_CONNECTION_REFUSED` unterbrochen
(`strip-infrastructure.txt`); derselbe finale Quelltext bestand anschließend
vollständig. Die Logs des ersten Sammellaufs und des finalen Einzellaufs
bleiben getrennt. Die JSON-Messung und Strip-Bilder stammen vom finalen Lauf.

Backend im Hauptarchiv, `lcnc-gateway`:

```sh
GIT_DIR=/home/cnc/lcnc-suite/.git OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 nice -n 19 python3 -m unittest -v test_example_install test_sim_toolsetter test_suite_runner
```

Die 62 Tests schreiben ausschließlich in ihre Temp-Verzeichnisse. Einige
ältere Installerfälle lesen eine historische Vorlage per `git show`; das
Archiv hat keine Git-Historie, daher dient `GIT_DIR` allein diesem Lesezugriff.
Ohne diesen Hinweis scheiterte der erste Lauf an fünf historischen
Vorlagenzugriffen, nicht an einer Produktassertion.

## Plan und Live-Protokoll

`plan-probe.py /path/to/archive` berechnet Endfarben, ein perspektivisches
Gegenbeispiel, die Schwellenfolge ohne Hysterese und Cyan-Abstände/-Kontraste.
`chains.mjs` liegt im Archiv unter `evidence/` und liest die dort verknüpfte
Three-Version: `node evidence/viewer-palette-fest.r62.chains.mjs`. Er zeigt,
dass `computeLineDistances` Speicherreihenfolge kumuliert, keine getrennten
Konturketten entdeckt. Das ist ein Implementierungshinweis für den Plan,
kein bereits vorhandener Produktfehler des neuen Musters.

`pattern.html` ist eine eigenständige interaktive mathematische Skizze mit
Zoom-/Tiefenregler und einer Schwellen-Gegenprobe, kein Three.js-Screenshot.
Die Sollverträge sind im Review-Anhang erklärt. Primärquellen für den
Kontrasthinweis und Shader-Antialiasing stehen dort verlinkt.

`live-gate.json` ist ein geprüfter Auszug aus Claudes vollständigem
`live-twp5/report.json` am Commit `1812467`; Herkunft, Hashes aller neun
Gate-Logs, letzte Ergebniszeilen und Skip-Gründe sind enthalten. Keine
eigene Ausführung dieses Live-Gates. Die Quellen liegen außerhalb des
Repos, der Beleg hält das Prüfergebnis dauerhaft fest. Kein erneutes
vollständiges Offline-Gate. Alle eigenen Mocks wurden beendet.
