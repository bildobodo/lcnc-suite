# R172 · eigene Prüfung reproduzieren

Prüfstand: `git archive 4cd751b5`, isoliert unter `/tmp/codex-r172-p00xom99/repo`. Produktbranch `feat/step4-p2b`, nicht gemergt. Der Live-Baum wurde nicht gebaut oder getestet. Node-Abhängigkeiten: vorhandene `lcnc-webui/node_modules` der isolierten R171-Kopie wiederverwendet.

## Unit-Prüfungen

Im Archiv unter `lcnc-webui`:

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/contactView.test.ts src/viewer/shownContacts.test.ts src/viewer/scrubTrack.test.ts src/viewer/simRows.test.ts src/viewer/checkContext.test.ts src/viewer/checkWiring.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r172-p00xom99/unit.json
```

177 Prüfungen grün. Die zusätzliche Datei `viewer-palette-fest.r172.codex-side-notes.test.ts` nach `src/viewer/r172-codex-side-notes.test.ts` kopieren:

```sh
R172_OUT=/tmp/codex-r172-p00xom99 nice -n 10 node node_modules/vitest/vitest.mjs run src/viewer/r172-codex-side-notes.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/codex-r172-p00xom99/side-notes.json
```

Zwei rote Assertions erwartet: L40 statt L7 bzw. Name `touch`. Die Sonde läuft durch den vollständigen `buildShownSteps`; Kontakt und Lücke liegen getrennt in derselben Bewegung.

## Browser

Nur im Archiv:

1. In `e2e/ctl.ts` **beide** Adressen (HTTP und WebSocket) von `localhost:4174` auf `127.0.0.1:4188` ändern.
2. `viewer-palette-fest.r172.codex-browser-config.ts` nach `playwright.codex.config.ts` kopieren; bei neuem Arbeitsordner die Ausgabeziele anpassen.
3. `viewer-palette-fest.r172.codex-browser-additions.spec.ts` an `e2e/collisions.viewer.spec.ts` anhängen. Die Datei verwendet dessen vorhandene Helfer. Die festen JSON-Ausgabeziele in den zwei eigenen Fällen bei anderem Arbeitsordner anpassen.
4. `nice -n 10 node node_modules/vite/bin/vite.js build`.
5. Mock-Port muss frei sein; der Konfigurationsserver startet nur `127.0.0.1:4188`.

```sh
nice -n 10 node node_modules/@playwright/test/cli.js test --config=playwright.codex.config.ts --grep "a contact in a called file|a run's bound beginning:|R172 own:"
```

Vier Repository-Fälle sollen grün sein, beide eigenen Fälle rot an der jeweils letzten Assertion. Der Seitenlauf-Kontakt steht in L3, die Hilfe nennt L4–L3. Beim Bereichsauftrag steht vor der ersten Tabelle die rohe Kontaktzeile L7, danach der Name `touch`.

Die beiden eigenen Browserfälle beantworten gezielt den Worker-Transport; Seite, Dekodierung, Tabellenempfänger und Veröffentlichungs-/Anzeigeaufbau sind das Produkt. Die anfängliche Prüfung auf dem XYZAC-Modell bzw. die Hauptprüfung des Seitenlauf-Falls laufen wirklich. Keine Prüfung an einer laufenden Maschine.

## Berichte

- `codex-browser-initial.json`: vier grüne Repository-Fälle, roter Seitenlauf-Fall und erste Metadaten-Vorprobe. Deren damaliger Anhang ist als `codex-browser-initial-additions.spec.ts` erhalten.
- `codex-browser-metadata.json`: ersetzt den letzten Fall durch den echten vorläufigen Laufauftrag `{from: 1}`, ohne bestätigte Aufrufzeile, anfängliche Schneidenberührung. Maßgeblicher Beleg für VP-I126.
- `codex-browser-wait-error.json`: dazwischen eine falsche eigene Wartebedingung (Prozentanzeige statt vorläufiger Bereichsanzeige); kein Produktbefund.
- `codex-browser-folded-state.json` und `codex-browser-boundary-state.json`: abgelesene Texte, Herkunft und Diagnostik der maßgeblichen roten Assertions. Fehler-Screenshots nach dem Mock-Reset wurden nicht als Bildbelege übernommen.
- `codex-manifest.json`: Quellvergleich und unveränderte Eingaben vor dem Review-Anhang. Keine Mutation am Produktcode für die Gegenproben.
