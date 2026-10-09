# R113 · Codex · Prüfaufbau

Planfassung 2 am Stand `5001371310a9a1aea87cf30167480e2fc4236898`, Änderung `86563fff..50013713`. Geprüft gegen VP112-01–07 und die vorhandenen Schnittstellen. Nur der Plan und die Anfrage wurden seit R112 geändert.

## Isolation

Archivkopie `/tmp/codex-r113-e__wq7df`; Node-Abhängigkeiten als lesende Einzelsymlinks, ohne `.tmp`, `.cache`, `.vite`, `.vite-temp`. Eigener Vite-Cache, ein Vitest-Worker, `nice -n 19`. Keine Installation, kein Browser, keine Live-Ports, kein HAL/Controller-Zugriff. Keine Builds oder Tests im Live-Baum. Keine Produktänderung.

## Was tatsächlich ausgeführt wurde

**Drei Vitest-Proben PASS.** `proposedFloor` ist eine ausführbare Lesart von Plan 3b, keine bereits vorhandene Produktfunktion. Es filtert unbekannte Segmente wie im Plan und verwendet den tatsächlichen Projektor zum Abstandstest je bekanntem Segment. Der gewählte Bereich wird mit dem tatsächlichen Sweep eines synthetischen XYZ-Modells geprüft.

- `unknown-floor.json`: unbekanntes erstes Vorkommen, danach bekannte Fahrt am Hindernis `(100,10,0)`, später bekannte Fahrt nahe der beobachteten Pose `(1,0,0)`. Die Planregel nimmt nur Segment 4 als Kandidaten und beginnt bei Punkt 3. Der volle Sweep findet den noch bevorstehenden Befund an L3; der gewählte spätere Bereich findet ihn nicht. Die tatsächliche noch laufende unbekannte Fahrt ist explizite Eingabe des Gegenmodells, kein aus der Pose bewiesener Zustand.
- `known-control.json`: Die neue früheste Kandidatenregel behebt die allseits bekannte R112-Parallelweg-Probe; ihr Start bleibt bei Punkt 0 und der Befund wird gefunden.
- `offpath-control.json`: Ohne bekannten Kandidaten greift der im Plan bezeichnete volle Rückfall.

Der Startparameter `from` existiert noch nicht. Nur zur Ausführung des gewählten bekannten Bereichs nutzt die Sonde `sliceTrack`; in dieser Geometrie ist seine erste Pose frei, sodass die statische Basis-Ausnahme aus R112 den Gegenfall nicht verursacht. Die neue Grenzkontakt-Semantik wird damit weder geprüft noch widerlegt.

**`plan-checks.py` PASS:** Zwei reine Originalfunktionen per AST geladen (keine Import-/Startwirkung des Gateway-Moduls):
- `path_deviation` aus `scripts/sim_parity.py`: Eine geschlossene Polylinie und ihre umgekehrte Traversierung haben bidirektional Abstand 0. Gleiche Stützpunktindizes sind teilweise über 100 Einheiten auseinander. Das belegt die fehlende Vorkommens-/Reihenfolgeaussage des geometrischen Gates; kein Fehlerbefund gegen dessen deklarierten Auftrag.
- `evaluate_tlo_drift`: Unveränderte Werkzeugwerte mit geändertem Tabellen-mtime liefern dennoch `table_mtime`.

Daneben enthält das Skript zwei **explizite Plan-Gegenmodelle**, keine behaupteten Gateway-Reproduktionen: Startzustand bereits vor dem ersten empfangenen Laufstatus verändert; eine in Lauf 1 begonnene Veröffentlichung erfüllt in Lauf 2 die genannten Zulassungsbedingungen. Die Ereignisfolgen und alle Eingaben stehen in `plan-checks.json`. Die Quellprüfung bestätigt die relevante Trennung von Command-Dispatch, periodischem Status, Parse-Kontext und Publikation.

Keine Produktmutationen, keine Anpassung von Erwartungen nach einem Fehlversuch, keine nativen Maschinen-/Interpreterversuche. Kein Gesamtgate oder Build wiederholt; es liegt nur eine Planänderung vor.

## Wiederholung

`git archive 50013713` in ein temporäres Verzeichnis entpacken. Vorhandene Node-Abhängigkeiten und einen eigenen Cache bereitstellen. Die veröffentlichte `viewer-palette-fest.r113.codex-client.test.ts` nach `lcnc-webui/src/viewer/r113.codex.test.ts` kopieren. Als `lcnc-webui/r113.vitest.config.ts` ablegen:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'../r113-vitest-cache',test:{environment:'node',maxWorkers:1,fileParallelism:false,testTimeout:240000,include:['src/**/*.test.ts']}});
```

Aus `lcnc-webui`, mit einem zuvor angelegten Ausgabeverzeichnis:

```sh
R113_EVIDENCE=/tmp/r113-evidence nice -n 19 node node_modules/vitest/vitest.mjs run --config r113.vitest.config.ts src/viewer/r113.codex.test.ts
```

Die veröffentlichte Python-Sonde benötigt NumPy und nimmt Archiv- und Ausgabepfad entgegen; sie verwendet keine Netzwerkverbindung:

```sh
nice -n 19 python3 viewer-palette-fest.r113.codex-plan-checks.py /tmp/r113-archive /tmp/r113-evidence/plan-checks.json
```

Die Quellstellen mit Hashes sind in `sources.json` dokumentiert. Tests sind gezielte Planproben, keine Leistungs- oder Live-Abnahme.
