# R148 · Codex · Prüfprotokoll

Stand `8796c6b7..509360a9a9f4945541996bed8bd38a598b3a37d7` (vollständiger geprüfter Hash maßgeblich in `codex-context.json`), `feat/step4-p2b`, ungemergt. Archivkopie `/tmp/codex-r148-tvk4cc8j/repo`; die laufende Suite wurde nicht benutzt. Live-HEAD `a4c2ba76118a0c158a09eeace6ba1760155b2e1d` unverändert.

## Ergebnis und Umfang

- **92 Repositorytests bestanden:** `contactView`, `contactsReceiver`, `contactStore`, `contactMerge`, `collisionWorker`, `collisionInside`.
- **Zehn R147-Prüfungen bestanden:** die bisherigen Erwartungen mit Anpassung an die neue Schnittstelle, einschließlich echtem Sweep→View und beiden Seitenabschlussfolgen.
- **Acht zusätzliche Prüfungen:** drei positive Kontrollen bestanden, fünf Gegenproben rot. Insgesamt **105 bestanden, fünf rot**.
- Keine Produktänderungen, kein Browser, keine Live-Ports oder Maschinenbefehle. Alle Tests mit `nice -n 15` und einem Vitest-Thread. Claudes Gesamtgate und Mutationen sind gelesene Fremdbelege, kein eigener Gesamtgatelauf.

## Reproduktion

In einer frischen Archivkopie von `509360a9` die Abhängigkeiten von `lcnc-webui` bereitstellen. Die Belege `viewer-palette-fest.r148.codex-*.test.ts` folgendermaßen unter `lcnc-webui/src/viewer/` ablegen:

| Beleg-Suffix | Zielname |
|---|---|
| `codex-r147-view.test.ts` | `r148.codex-r147-view.test.ts` |
| `codex-r147-sweep.test.ts` | `r148.codex-r147-sweep.test.ts` |
| `codex-r147-transport.test.ts` | `r148.codex-r147-transport.test.ts` |
| `codex-rest.test.ts` | `r148.codex-rest.test.ts` |
| `codex-owners.test.ts` | `r148.codex-owners.test.ts` |

`viewer-palette-fest.r148.codex-vitest.config.ts` als `lcnc-webui/vitest.codex-r148.config.ts` ablegen. Dann im **Archiv**, nicht im Live-Baum:

```sh
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/contactView.test.ts src/viewer/contactsReceiver.test.ts \
  src/viewer/contactStore.test.ts src/viewer/contactMerge.test.ts \
  src/viewer/collisionWorker.test.ts src/viewer/collisionInside.test.ts \
  --config vitest.codex-r148.config.ts

R148_REGRESSION_RESULTS=/tmp/r148-regressions.json \
R148_SWEEP_RESULTS=/tmp/r148-sweep.json \
R147_TRANSPORT_RESULTS=/tmp/r148-transport.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r148.codex-r147-view.test.ts \
  src/viewer/r148.codex-r147-sweep.test.ts \
  src/viewer/r148.codex-r147-transport.test.ts \
  --config vitest.codex-r148.config.ts

R148_REST_RESULTS=/tmp/r148-rests.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r148.codex-rest.test.ts --config vitest.codex-r148.config.ts

R148_OWNERS_RESULTS=/tmp/r148-owners.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r148.codex-owners.test.ts --config vitest.codex-r148.config.ts
```

Die letzten beiden Aufrufe enden auf diesem Stand mit Exitcode 1 (vier bzw. eine Gegenprobe rot). Die JSON-Ausgaben liegen gesammelt in `viewer-palette-fest.r148.codex-results.json`.

## Anpassungen und Aussagekraft

**R147-Schnittstellen:** `v.pos`/`v.end` wurden durch `targetPos`/`targetEnd` ersetzt, der entfernte dritte Parameter von `tintAt` weggelassen. Die alte materialisierte `v.touch`-Darstellung entfällt lediglich aus den Diagnoseausgaben; Verhaltenserwartungen bleiben bestehen. Die alte Budgetprobe verwendet nun `heldBytes` statt der nicht mehr vorhandenen Spalten. Die Sweep-Probe protokolliert Ziele statt `v.touch`. Die Transportprobe ist eine unveränderte Kopie von Claudes `viewer-palette-fest.r148.transport-probe.test.ts`; geprüft wurde, dass gegenüber R147 nur der neue Eigentümerhelfer und seine Umgebung hinzugekommen sind. Originalbelege bleiben unverändert.

**Neue Ableitungsfälle:** Echte `ContactStore`-Tabellen, `toBaseAxis`, `entryJoins` und `contactView`; keine Attrappen ihrer Berechnung. Die Join-Probe vergleicht dieselben Quellen mit und ohne den durch `entryJoins` gelieferten Join. Die Wissenslücke liegt vollständig im Basisteil. Die Nullabbildung verwendet disjunkte Quellspannen, die beide auf 0 fallen. Die veränderliche Ansicht wird mit derselben Folge von Spaltenänderungen wie einem Empfangsdelta konfrontiert; eine neu gebaute Ansicht dient als Kontrolle.

**Budget:** Der zusätzliche Fall erfüllt alle Zeilenbudgets, mit zwei Hauptgenerationen und zwei Seitengenerationen zu je T/8. Anders als der Repositoryfall mit 384 Paaren verwendet er ein Paar je Episode: 65 536 verschiedene Paare je Hauptgeneration und 8192 je Seitengeneration. Das ist ein synthetischer Grenzfall der allgemeinen Zusage, keine Behauptung über das aktuelle XYZAC-Modell. Die typisierten Puffer werden exakt summiert. Die weitere Map-Schätzung stammt ausdrücklich aus dem implementierten `heldBytes`-Ansatz (32 B je Eintrag), nicht aus einer eigenen exakten Heap-Messung. Keine Lücken, Joins oder künftigen Anzeige-ID-Bindungen erhöhen diesen Fall zusätzlich.

**Eigentümer/Abbruch:** Die neue Sonde extrahiert mit TypeScript-AST `_colContactOwners`, `cancelCollisionCheck` und den tatsächlichen Freigabe-Watch aus `ThreeViewer.vue`. Sie führt sie mit echtem `ContactsReceiver` sowie echtem Vue `ref`, `shallowRef`, `watch`, `effectScope` und `nextTick` aus. Telemetrie/Worker-Versand sind Stubs; kein vollständiger Komponententest. Kontrollen: Ein gezeigtes Endergebnis bleibt beim Abbruch gehalten; eine gelöschte Seitenanzeige gibt ihre Tabelle ohne neue Nachricht frei. Rot ist nur der Abbruch bei ausschließlich vorhandenem Teilstand.

## Unverändertheit

446 archivierte Dateien unter `lcnc-webui/src` und `e2e` wurden gegen ihre Git-Blobs von `509360a9` verglichen. Alle sechs Eingaben (Review, Plan und Claudes vier R148-Belege) wurden vor dem eigenen Anhang per SHA-256 abgeglichen. Vollständige Revisionen, Umgebung, Eingabe- und Beleg-Hashes: `viewer-palette-fest.r148.codex-context.json`.
