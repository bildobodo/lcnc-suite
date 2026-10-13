# R147 · Codex · Prüfprotokoll

Geprüft: `e24f4b14..8796c6b7b7a3f65e1c6ead572da035a27fc26bc7`, `feat/step4-p2b`, ungemergt. Archivkopie in `/tmp/codex-r147-gmq5gcaf/repo`. Der Live-Baum war `87f7a9ff270ae675e5bb5f1b578561afd2987cfb`; seine Produktdateien, Sim und Ports wurden nicht verwendet oder verändert. Alle Prüfungen mit `nice -n 15`, einem Vitest-Thread und ohne Browser.

## Ergebnis

- **70 Repositorytests bestanden:** `contactView`, `contactsReceiver`, `contactStore`, `contactMerge`, `collisionWorker`.
- **Zehn eigene Tests:** eine positive Kontrolle bestanden, neun Gegenproben rot. Sechs B1-Gegenproben, zwei B2-Abläufe (Sim-Anfahrt/Lauf-Anfang), eine zusätzliche Sweep→View-Probe.
- Die sechs Befunde **VP-I101–VP-I106** stehen im R147-Anhang des Reviews. Die neun roten Tests sind erwartete Reproduktionen dieser Befunde, kein Fehler beim Teststart.
- Das vollständige Gate, die Mutationen und die hausB-Messung von Claude wurden gelesen, nicht als eigener Lauf wiederholt.

## Reproduktion

In einer frischen Archivkopie von `8796c6b7` mit installierten UI-Abhängigkeiten die folgenden Belege kopieren:

| Beleg | Ziel unter `lcnc-webui/` |
|---|---|
| `viewer-palette-fest.r147.codex-view.test.ts` | `src/viewer/r147.codex-view.test.ts` |
| `viewer-palette-fest.r147.codex-transport.test.ts` | `src/viewer/r147.codex-transport.test.ts` |
| `viewer-palette-fest.r147.codex-sweep.test.ts` | `src/viewer/r147.codex-sweep.test.ts` |
| `viewer-palette-fest.r147.codex-vitest.config.ts` | `vitest.codex-r147.config.ts` |

Dann im **Archiv**, nicht im Live-Baum:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/contactView.test.ts src/viewer/contactsReceiver.test.ts \
  src/viewer/contactStore.test.ts src/viewer/contactMerge.test.ts \
  src/viewer/collisionWorker.test.ts --config vitest.codex-r147.config.ts

R147_VIEW_RESULTS=/tmp/r147-view.json \
R147_TRANSPORT_RESULTS=/tmp/r147-transport.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r147.codex-view.test.ts src/viewer/r147.codex-transport.test.ts \
  --config vitest.codex-r147.config.ts

R147_SWEEP_RESULTS=/tmp/r147-sweep.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r147.codex-sweep.test.ts --config vitest.codex-r147.config.ts
```

Die beiden Gegenprobenaufrufe beenden sich an diesem Stand mit Exitcode 1. Die Ergebnisse stehen auch gesammelt in `viewer-palette-fest.r147.codex-results.json`.

## Aussagekraft der Proben

**B1:** Die kleinen Tabellen werden über die echten `ContactStore`-Spalten aufgebaut, nicht über Attrappen von `contactView`. Der auf null abgebildete Anfang verwendet ein positives Quellintervall `[1,2]` und `at(c) = max(0,c−3)`. Die Budgetprobe verwendet genau das erlaubte Anfragebudget: 65 536 Episoden mit je vier getrennten Intervallen. Sie summiert die tatsächlichen `byteLength` aller Ableitungsspalten und `touch`-Puffer, ohne Tabellen, JavaScript-Objekte und temporäre Arrays. Ihre Laufzeit ist nur ein lokaler Messwert, keine allgemeine Leistungszusage.

**Sweep→View:** Das Geometrie-/Inside-Harness stammt aus dem unveränderten R146-Beleg `viewer-palette-fest.r146.codex-r145-finish.test.ts`. Hier wird der tatsächliche Sweep durch den hohlen Körper mit X = `[40,30,19]` an die neue Ableitung weitergereicht. Die bestehende `pointInside`-Naht erzwingt ausschließlich die unentscheidbare Antwort in der Abschlussverfeinerung. Es entsteht tatsächlich die punktförmige Lücke `[20.75,20.75]`; trotz Toleranz null färbt die Ansicht `nub` und `post`. Kein Nachweis einer natürlichen Häufigkeit dieses Innenurteils wird behauptet.

**B2:** Die Sonde liest `ThreeViewer.vue` aus dem geprüften Archiv und extrahiert mit dem TypeScript-AST den tatsächlichen `onmessage`-Router sowie `_colOnSideMessage`. Beide laufen unverändert mit dem echten `ContactsReceiver`; Rendering, Telemetrie und Marks-Aufrufe sind leere Stubs. Sie liefert echte `StoreDelta`-Nachrichten, erst ein fertiges Seitenergebnis, dann ein Hauptdelta. Positive Vorbedingungen: Das Seitenergebnis bleibt gültig, der Hauptlauf empfängt seine Zeilen, beide Nachrichten werden bestätigt. Nur die Seitentabelle geht verloren. Das ist ein gezielter Verdrahtungstest, **kein vollständiger Vue-/Browsertest**.

## Unverändertheit

Vor dem Ablegen wurden alle sechs Eingaben einschließlich des bisherigen Reviewtextes per SHA-256 abgeglichen; 446 archivierte Produkt-/Testdateien unter `src` und `e2e` stimmen mit den Git-Blobs von `8796c6b7` überein. Nur zusätzliche Sonden und die isolierte Vitest-Konfiguration wurden im Archiv angelegt. Die Originalbelege früherer Runden bleiben unverändert. Vollständige Revisionen, Eingabehashes und Beleg-Hashes: `viewer-palette-fest.r147.codex-context.json`.
