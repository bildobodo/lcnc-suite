# Codex R149 · Prüfprotokoll · 13. Oktober 2026

Geprüft: `509360a9..ea962ee75e89496dd62769d1b827f88e88dc2461`, Zweig `feat/step4-p2b`, ungemergt. Anfrage und Antworten aus dem unveränderten Live-Review-Dokument, Produktquellen aus `git archive ea962ee7`. Arbeitskopie: `/tmp/codex-r149-6y7rrmjw/repo`, eigener Mock ausschließlich `127.0.0.1:4188`. Keine Live-Ports oder Maschinenbefehle.

## Ergebnisse

| Prüfung | Eigenes Ergebnis |
|---|---|
| 11 gezielte Repositorydateien | 169/169 PASS |
| R148-Nachprüfung einschließlich unveränderter Sweep-Probe | 16/16 PASS |
| Abdeckungsprobe mit originalen Viewer-Funktionen | 3 positive Kontrollen PASS, 4 Gegenproben FAIL |
| Gespeicherter nativer Payload → Decode → Spur → echter Sweep → Code-Marken | Kontakt und Ziel L5 bestätigt, falsche zusätzliche Marke auf ungeprüfter L3: FAIL |
| Vite-Build der Archivkopie | PASS; kein erneuter Typecheck/Lint durch Codex |
| Drei gezielte Repository-Browsertests | 3/3 PASS |
| Eigene Browser-Gegenprobe, Seitenprüfung bei 20 % beendet | FAIL: Kontaktband wächst von Ende 18,27 % auf 90,99 % der Gesamtstrecke; null `pageerror` |

Gesamt: **185 bestandene Bestands-/Nachprüfungen plus drei positive neue Modulkontrollen**, fünf rote neue Modul-/Ablaufgegenproben, drei grüne Browserprüfungen und eine rote Browsergegenprobe. Alle Ausgaben: [tests.txt](viewer-palette-fest.r149.codex-tests.txt).

Repositorydateien: `contactView.test.ts`, `contactViewCross.test.ts`, `shownContacts.test.ts`, `checkWiring.test.ts`, `contactsReceiver.test.ts`, `contactStore.test.ts`, `contactMerge.test.ts`, `collisionWorker.test.ts`, `collisionInside.test.ts`, `scrubBarWords.test.ts`, `startDepPayloads.test.ts`.

Browserkontrollen aus `e2e/collisions.viewer.spec.ts`: „the tint and the band…“, „a shown side result keeps…“, „a run's bound beginning: its contact reaches…“. Reale Browser-App, echtes mitgeliefertes XYZAC-Modell, Mock-Gateway; die Seitenantwort des dritten Tests ist wie im Repository eingespeist.

## Reproduktion der zusätzlichen Proben

Die vier `codex-rerun-*.test.ts`-Belege sowie `codex-coverage.test.ts` und `codex-startmarks.test.ts` nach `lcnc-webui/src/viewer/` einer frischen Archivkopie legen; die relative Importstruktur erhalten. Die Ausgabepfade der neuen Proben verweisen auf das obige temporäre Verzeichnis; bei anderer Kopie nur diese Belegpfade anpassen. Mit der beigefügten Vitest-Konfiguration und einem Worker ausführen, zum Beispiel:

```sh
R148_SWEEP_RESULTS=/tmp/codex-r149-6y7rrmjw/rerun-sweep.json \
R148_REST_RESULTS=/tmp/codex-r149-6y7rrmjw/rerun-rest.json \
R148_OWNERS_RESULTS=/tmp/codex-r149-6y7rrmjw/rerun-owners.json \
nice -n 15 node node_modules/vitest/vitest.mjs run \
  src/viewer/r149.codex-rerun-rest.test.ts \
  src/viewer/r149.codex-rerun-owners.test.ts \
  src/viewer/r149.codex-rerun-r147-view.test.ts \
  src/viewer/r149.codex-rerun-sweep.test.ts \
  --config vitest.codex-r149.config.ts
```

Die drei Anpassungen aus Claudes R149-Nachproben sind übernommen: vor einem Tabellenschreiben lesen; Budget über `heldBytes`; `_colReleaseContacts` in den Eigentümerkontext. Zusätzlich ausdrücklich angenommener neuer Modulvertrag: Nach einem Tabellenschreiben wirft die alte Ansicht, der Neubau liefert konsistente Antworten. Das wird nicht als unveränderter R148-Test ausgegeben. Die Sweep-Probe ist unverändert. Beim ersten eigenen Lauf fehlte allein ihr Ausgabe-Environment; mit gesetztem Pfad 16/16 PASS.

`coverage.test.ts` extrahiert `_sliceEnd`, `_colBaseSpec`, `_colRunSideSpec` und `_colViewSpec` per TypeScript-AST **unverändert**. Die umgebenden Ref-Werte werden vorgegeben; `shownContactView`, Tabellen und Abfragen sind produktiv. Die vier roten Fälle sind laufender gefalteter Anfang, vorzeitig beendeter gefalteter Anfang, vorzeitig beendete Simulationsanfahrt und unzulässiger Join über deren ungeprüften Rest. Grüne Kontrollen: vollständig geprüfter Anfang samt Join, laufende ungefaltete Anfahrt, explizite `ownCoverage: 2` im vorhandenen Ableitungsmodul.

`startmarks.test.ts` benutzt den unveränderten Repository-Payload `e_g53_rdp.msgpack`; es läuft **kein nativer Interpreter neu**. Decode, Spurbau und Kollisionsprüfung sind echt. Das isolierte Modell besteht aus zwei 2-mm-Würfeln, einer davon ausdrücklich Werkzeug (`tool: true`, keine statische Mount-Ausnahme). Das ist ein gezielter Modellgegenfall, keine Behauptung einer solchen Kollision in der Live-XYZAC-Sim.

Für den Browser den Vite-Build erstellen; [browser.append.ts](viewer-palette-fest.r149.codex-browser.append.ts) an die originale `e2e/collisions.viewer.spec.ts` anhängen. Die Datei benutzt deren bestehende Helfer. [Port-Diff](viewer-palette-fest.r149.codex-browser-port.diff) nur in der Archivkopie anwenden, beigefügte Browserkonfiguration als `playwright.codex-r149.config.ts` ablegen und mit `-g 'Codex R149:'` ausführen. Die Sandbox verbot zunächst den Listener; der lokale Lauf wurde anschließend über die Tool-Freigabe ausgeführt. Die erste Fassung der Sonde las CSS-`calc()` fälschlich als Prozentzahl; die abgelegte Fassung misst die echten Rechtecke relativ zum Slider-Track. Sie scheitert ausschließlich an der erwarteten Bandgrenze.

## Grenzen und Integrität

Claudes vollständiges Gate (2316 Unit / 520 Browser) und Mutationsbericht gelesen, nicht als eigener Gesamtlauf wiederholt. Keine Mutation an Produktquellen. Keine Nachher-Kostenmessung von `haus.ngc`, kein Backend-/Live-Gate. B4 sowie Listenfenster, vertrauenswürdige Anzeigezeilen und B6–B8 nicht vorweg abgenommen.

[Kontext und Hashes](viewer-palette-fest.r149.codex-context.json): Live-HEAD unverändert `32dba36a`; alle neun Eingaben vor dem Anhang unverändert; alle **364 archivierten, getrackten Dateien unter `lcnc-webui/src`** identisch mit `ea962ee7`. Änderungen in der Archivkopie ausschließlich neue Proben/Konfigurationen sowie Mock-Port und angehängte Browserprobe. Im Live-Baum ausschließlich Review-Anhang, neue `r149.codex-*`-Belege und anschließend das angeforderte Handshake-`done`.
