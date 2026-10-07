# R91 · Prüfaufbau und Grenzen

Geprüfter Produktstand `385052e5` (gegen `3da407b1`), Anfrage `e6f2d198`,
7. Oktober 2026. Archiv `/tmp/codex-r91-7ofau2i2/archive` mit Frontend,
Gateway, Beispielen, Testvorlagen und Skripten. 425 Frontend-Dateien sind
bytegleich zum Git-Stand; vier Konfigurationen ändern ausschließlich die
Cachepfade (isolation.patch). Abhängigkeiten sind einzeln verlinkt;
Cacheverzeichnisse des Live-Baums sind ausgeschlossen.

Keine Produktänderung, keine Builds/Tests im Live-Baum, keine Maschinenbefehle,
keine Zugriffe auf die Live-Ports. Alle eigenen CPU-Läufe mit nice 19 und
einem Testworker, nacheinander. Kein neuer Deep-Hunt, keine neue
haus.ngc-Leistungsmessung und kein vollständiges Offline-Gate.

## Koordinator und Kern

Neben `lcnc-webui` einen Ordner `evidence` anlegen. Die beigefügte
vitest.config.ts als `r91.vitest.config.ts` nach `lcnc-webui` kopieren.
Die Sonden coordinator.test.ts und edges.test.ts als
`src/viewer/r91.coordinator.test.ts` bzw. `src/viewer/r91.edges.test.ts` ablegen.

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r91.vitest.config.ts src/viewer/collisionWorker.test.ts src/viewer/r91.coordinator.test.ts src/viewer/sweepPump.test.ts src/viewer/sweepEntry.test.ts src/viewer/sweepMerge.test.ts src/viewer/collision.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r91.vitest.config.ts src/viewer/r91.edges.test.ts
```

Erster Lauf: **127/127 grün**, einschließlich der 18 neuen Repository-Tests
und der sieben alten R90-Gegenproben. Letztere haben nur eine Anpassung:
`hardwareConcurrency: 4` statt 3 wegen K = Kerne − 2. Ihr Ausgabename bleibt
R90 innerhalb der Archivkopie; veröffentlicht wird eine neue R91-Kopie.

Neue Randfallsonde: **2 rot, 2 grün**. Produkt-Koordinator und lokaler Sweep
sind unverändert; untergeordnete Worker werden durch kontrollierte Quellen
ersetzt. Nachrichten und Timer sind deterministisch. Der Sample-Abbruch
wird als legitime Abschlussnachricht eingespeist, kein Lauf mit 16 Mio.
Proben. Der zweite rote Fall wartet 60 Sekunden virtueller Zeit, keine
echte Minute. Bei der versteckten Pause existiert kein Zeitlimit; ein
50-ms-Polltimer bleibt ohne Stop-Antwort aktiv. Die zwei positiven Fälle
prüfen unabhängige Haltegründe sowie Pause/Continue nach Verlust des Pools
und einen verspäteten Fehler eines bereits beendeten Workers.

## Browser und Build

Dateien in `lcnc-webui` ablegen:

- dev.spec.ts → `e2e/r91.codex-dev.spec.ts`
- dev.config.ts → `r91.codex-dev.config.ts`
- dev.vite.config.ts → `r91.codex-dev.vite.config.ts`
- worker.html → `public/r91.codex-worker.html`
- coordinator-wrapper.js → `public/r91-coordinator-wrapper.js`
- failing-child.js → `public/r91-failing-child.js`

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r91.codex-dev.config.ts
```

**4/4 grün**, je zwei Prüfungen in Chromium und Firefox. Beide Browser
melden vier Kerne; normale Hauptläufe melden zwei Shards. Die leere Seite
auf dem eigenen Vite-Port 4189 lädt nur den Worker, keine App und keinen
Gateway. Kein Mock oder Maschinenzugriff nötig. Playwright beendet seinen
Server wieder.

Normallauf: echter verschachtelter Worker, einfacher Boxdurchgang, Kontakt
auf L2, danach Seitenprüfung. Fehlerlauf: eine Testhülle lädt die echte
Koordinatorquelle und ersetzt ausschließlich die Konstruktion der
Teil-Worker durch native Worker, die nach der ersten Anfrage werfen.
Haupt- und Seitenanfrage sind zu diesem Zeitpunkt gleichzeitig ausstehend.
Beide Antworten enthalten den erwarteten Kontakt; kein Workerfehler
erreicht die Seite. Der Ersatzlauf hat keine Shards. Die Hülle puffert
Anfragen während ihres asynchronen Imports und reicht sie danach weiter.

Der erste Browser-Versuch hatte diese Pufferung noch nicht und erzeugte
zwei Timeouts der Testhülle. Außerdem stand die leere Seite beim Serverstart
noch nicht bereit, und Vites Scan griff auf den App-Einstieg zurück.
`dev.setup.txt` bewahrt dieses Aufbauprotokoll. Nach Korrektur nur der
Testhülle, Bereitstellung der Seite vor Start und Begrenzung des Scans auf
die Testseite ist der vollständige Vierer-Lauf grün; keine Produktkorrektur.

Vor `nice -n 19 npm run build` die zusätzlichen Review-Sonden aus src/e2e
nehmen. Der Build einschließlich TypeScript ist grün; die Repository-Tests
bleiben in der Typprüfung. Keine erneuten UI-Screenshot- oder vollständigen
Browser-Gates: geändert wurde in dieser Runde der Worker-Koordinator.

## Vorschau R92

Nur Quellprüfung und Umsetzungshinweise, keine Implementierungsabnahme.
Die bereits vorhandene Rückrechnung steht in `gcode_canon.py:244–252`;
das unterschiedliche Verhalten von Traverse/Feed/Arc in `:297–348`.
Die drei mitgelieferten Sim-INIs enthalten keine TOOL_CHANGE-Einstellung
oder M6-Remap (M600/M601 sind andere Codes).

Der beigefügte native Quellausschnitt stammt aus der lokal vorhandenen
LinuxCNC-Quellkopie; Pfad und SHA256 stehen in r92-source.txt. Er zeigt
`convert_tool_change`, seine Fahrten für `tool_change_quill_up` und
`tool_change_at_g30` sowie das erneute Lesen der Position nach CHANGE_TOOL.
Es wurde weder die Installation geändert noch ein nativer Maschinenlauf
ausgeführt. Daraus folgt kein Nachweis, welche dieser Optionen in einer
beliebigen fremden Maschinenkonfiguration aktiv ist.
