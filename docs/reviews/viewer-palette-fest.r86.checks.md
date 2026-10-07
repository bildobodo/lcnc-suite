# R86 · Prüfaufbau und Grenzen

Code `9d5c6c37..104f44a3`, Anfrage `5c4b795c`, 7. Oktober 2026.

## Isolation

Archiv `/tmp/codex-r86-jp5m9k02/archive` aus `git archive 104f44a3`
mit `lcnc-webui`, `examples`, `lcnc-gateway/machine`, `test-fixtures`,
`scripts`. Abhängigkeiten einzeln verlinkt, Cache-Verzeichnisse ausgeschlossen.
419 archivierte Frontend-Dateien entsprechen ihren Git-Blobs; fünf tragen
nur die beigefügten Isolationsänderungen (eigene TypeScript-/Vite-Caches,
Mockadresse `127.0.0.1:4188`). Zusätzliche Review-Sonden sind separate Dateien.

Keine Maschinenbefehle, keine Zugriffe auf :5173 oder :8000 und keine
Verwendung der privaten R84-Eingaben. Alle CPU-intensiven Prüfungen mit
`nice -n 19` und einem Worker, nacheinander. Browserprüfungen begannen erst
nach Abschluss von Schätzer, Orakel und Geometriesonden. Für das lokale
Mock-Binding liefen sie nach automatischer Freigabe außerhalb der Sandbox.
Der Mock übernahm keinen vorhandenen Server; kein Playwright auf :4174.
43 vorhandene R85-Belege gegen ihr Hashmanifest verifiziert.

## Reproduktion

Archivierte Quellen verwenden, einen Ordner `evidence` neben `lcnc-webui`
anlegen. `r86.vitest.config.ts` nach `lcnc-webui` kopieren; die beiden
beigefügten eigenen `*.test.ts` als `src/viewer/r86.recontact.test.ts` und
`src/viewer/r86.geometry.test.ts` ablegen. Befehle in `lcnc-webui`:

```sh
nice -n 19 node node_modules/vitest/vitest.mjs run --config r86.vitest.config.ts src/viewer/collision.test.ts src/viewer/clashTint.test.ts src/viewer/bvhBoxDistance.test.ts src/viewer/collisionHorizon.test.ts src/viewer/sweepMerge.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r86.vitest.config.ts src/viewer/collisionBounds.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r86.vitest.config.ts src/viewer/collisionOracle.test.ts
nice -n 19 node node_modules/vitest/vitest.mjs run --config r86.vitest.config.ts src/viewer/r86.recontact.test.ts src/viewer/r86.geometry.test.ts
```

Die letzte Zeile ist am Prüfstand absichtlich rot: je ein erwarteter Fehler
und eine erfolgreiche Kontrolle pro Datei. Die JSON-Dateien enthalten alle
fünf Startphasen, die feinere Abtastung und separat geprüfte Restbahn sowie
die 20.000 regulären Dreiecksvergleiche. Der degenerierte analytische Fall
verwendet den echten Produktpfad mit Float32-Koordinaten. Frühere Suchproben
sind nicht die Abnahme; maßgeblich ist `final-counterexamples.txt` mit den
beigefügten endgültigen Sonden.

Für den Build wurden nur die zusätzlichen Review-Unit-Dateien vorübergehend
aus `src` genommen; der Produktstand einschließlich Repository-Tests wurde
unverändert mit `npm run build` geprüft. Die eigenen Browserdateien wurden
erst anschließend angelegt. Die übliche Bundle-Größenwarnung bleibt.

Browser-Konfigurationen unter ihrem kurzen Namen nach `lcnc-webui`,
`edge.spec.ts` als `e2e/r86.edge.spec.ts` kopieren. Die Klick-Gegenprobe ist
bytegleich zu R85 bis auf `R85 → R86` / `r85 → r86`; sie entfernt das Polster
nur im Browser-DOM und verändert weder CSS-Quelle noch Bundle.

```sh
nice -n 19 node node_modules/@playwright/test/cli.js test --config r86.chromium.config.ts --grep 'whole hit area'
R86_BROWSER=firefox nice -n 19 node node_modules/@playwright/test/cli.js test --config r86.firefox.config.ts --grep 'whole hit area|guard fixture geometry'
R86_BROWSER=chromium nice -n 19 node node_modules/@playwright/test/cli.js test --config r86.edge-chromium.config.ts
```

Die STL-Prüfung unter `evidence` ablegen und mit `python3` ausführen. Sie
liest die tatsächlich verwendeten Kollisions-Proxys oder STLs der drei
Modelle, ohne dekorative Körper. 1.477.314 Facetten: keine nicht endlichen
Koordinaten, keine exakt flächenlosen Dreiecke. Dies ist keine Zusage über
beliebige benutzerdefinierte Modelle oder alle nahezu degenerierten Fälle.

Kein Deep-Hunt, kein komplettes Offline-Gate und keine Live-Abnahme. Die
Zufallsorakel nutzen ihre Repository-Standardsaaten, der eigene zusätzliche
Dreiecksvergleich die Saat 20261007. Die Aussage zum zweiten Kontakt beruht
auf einer analytischen Boxgeometrie, nicht auf einem gemeinsamen BVH-Orakel.
