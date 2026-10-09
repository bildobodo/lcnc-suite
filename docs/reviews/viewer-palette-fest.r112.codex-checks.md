# R112 · Codex · Prüfaufbau

Stand: `680eb4264f58ae0569dc42635c289cd345329a78`, Planänderung `a30b4138..680eb426`.

Planprüfung, keine Implementierungsabnahme. Gelesen wurden der Plan, Anfrage R112, die Verträge VP102-04/-05 sowie die vorhandenen Projektions-, Track-, WCS-, TLO-, Sweep- und Publikationsschnittstellen. Die relevanten Ausschnitte samt Quelldatei-Hashes stehen in `viewer-palette-fest.r112.codex-sources.json`.

Die drei eigenen Vitest-Proben liefen ausschließlich in der Archivkopie `/tmp/codex-r112-0xmbr4l4`, mit `nice -n 19`, einem Worker und eigenem Vite-Cache. Abhängigkeiten stammen als lesende Einzelsymlinks aus dem vorhandenen `node_modules`; `.tmp`, `.cache`, `.vite`, `.vite-temp` wurden nicht verlinkt. Keine Installation, kein Browser, keine Ports, kein LinuxCNC-/HAL-Zugriff. Im Live-Baum nur Review-Anhang und neue R112-Belege; kein Produktcode verändert.

## Wiederholung

1. `git archive 680eb426` in ein neues temporäres Verzeichnis entpacken.
2. Vorhandene Node-Abhängigkeiten bereitstellen, Cache-Verzeichnisse lokal halten.
3. Die veröffentlichte `viewer-palette-fest.r112.codex-client.test.ts` nach `lcnc-webui/src/viewer/r112.codex.test.ts` kopieren.
4. Diese Konfiguration als `lcnc-webui/r112.vitest.config.ts` ablegen:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  cacheDir: '../r112-vitest-cache',
  test: {
    environment: 'node', maxWorkers: 1, fileParallelism: false,
    testTimeout: 240000, include: ['src/**/*.test.ts'],
  },
});
```

5. Ein Ausgabeverzeichnis anlegen und aus `lcnc-webui` ausführen (Pfad passend einsetzen):

```sh
R112_EVIDENCE=/tmp/r112-evidence nice -n 19 node node_modules/vitest/vitest.mjs run --config r112.vitest.config.ts src/viewer/r112.codex.test.ts
```

Ergebnis: **3/3 PASS**. Die Tests behaupten ausdrücklich die beobachteten Gegenfälle gegen Planannahmen; sie sind keine Soll-Abnahme des vorgeschlagenen Verhaltens. Keine Produktmutationen und keine nachträgliche Anpassung der Proben oder Erwartungen. Kein Gesamtgate, Repository-Testlauf, Build, nativer Parse oder Live-Lauf wiederholt.

## Beobachtungen

- `projection.json`: Die echte Positionssuche und der echte Run-Watcher wählen Segment 5 (Reststart 4), obwohl Segment 1 ebenfalls plausibel ist (Abstand 0,1). Das Hindernis auf Segment 2, das noch vor einer Maschine auf Segment 1 liegt, wird im Vollsweep gefunden und im vorgeschlagenen Teilstück ausgelassen. Der gesetzte tatsächliche Durchgang ist eine Eingabe der Gegenprobe, keine aus der Pose abgeleitete Wahrheit.
- `baseline.json`: Vollsweep findet beide Kontaktbesuche. Schnitt am ersten Kontakt macht das Paar zur statischen Ausnahme; auch der spätere Wiederkontakt fehlt. Es werden echte Kollisionsmodelle mit zwei Würfeln und XYZ-Kinematik geprüft.
- `basis.json`: Derselbe Payload mit einer alten und einer umgeschriebenen WCS-Epoche liefert nach Änderung der Live-Tabelle statt X-Offsets `[0,100]` die Offsets `[100,100]`; das geerbte Werkzeug wechselt mit `liveTool` von 1 auf 2. Geprüft sind die tatsächlichen Resolver, nicht Vue oder ein bereits implementierter Freeze.

Laufzeiten sind Beobachtungen kleiner synthetischer Proben und kein Leistungsbeleg für eine Restprüfung während eines Maschinenlaufs. Den Latch-/Publikations- und Ressourcenbefunden liegt die Quellprüfung zugrunde; hierfür wird kein ausgeführter Browser- oder Gateway-Gegenbeweis behauptet.
