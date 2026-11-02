# R248 · Codex · Lesebefunde und isolierte Gegenprobe

Stand: `93e8ae29f01927c9cdd22fda756334da210ddc6f`, 2026-11-02. Planreview, kein Implementierungs-Gate. Keine Browser-, Build-, LinuxCNC- oder Gateway-Läufe; kein Zugriff auf 5173/8000. Ausgeführt wurde ausschließlich die reine Nutzlastprüfung an einer kopierten Python-Datei unter `/tmp/codex-r248-ekj1jovg`.

## Konkrete Ausgangspunkte

| Datei am geprüften Stand | Lesebefund |
| --- | --- |
| `lcnc-webui/playwright.config.ts:28` | Bildpfad enthält weder Browser- noch Projektnamen. |
| `lcnc-webui/playwright.config.ts:63` und folgende `dependencies` | Serielle Projekte sind als Abhängigkeitskette modelliert; Dateifilter allein entfernen die Vorgänger nicht. |
| `lcnc-webui/vitest.config.ts` | `src/**/*.test.ts`, keine vorhandene schwere/leichte Projektaufteilung. |
| `lcnc-webui/src/viewer/collisionContacts.test.ts`, `collisionRangeOracle.test.ts`, `sweepShards.test.ts`, `contactViewCross.test.ts`, `collisionLineSample.test.ts`, `collisionOracle.test.ts`, `collisionBounds.test.ts` | Alle sieben lesen direkt mit `fs.readFileSync`. Die Planliste umfasst zusätzlich `contactViewIndexed.test.ts`; für diese achte Datei wird hier keine Dateilesung behauptet. |
| `lcnc-webui/src/viewer/collisionFixtures.ts` | Repositoriumsrelative Dateizugriffe; `iniSetp` liest INI-Text, Modelle kommen u. a. aus `examples/sim_config/machine-*` und `lcnc-gateway/machine`. |
| `scripts/test_suite.py:124` | Bisheriges Backend-Gate ist mehr als allein Pytest im Gateway: 5axis-model und gesonderte Skript-Tests. |
| `scripts/test_suite.py:22` | Bestehendes Live-Gate enthält Preview-Goldens, Live-Parität und mehrere TWP-Skripte. |
| `lcnc-webui/src/lcnc.ts:80` | Werkzeug-Nutzlasten haben offene Indexsignaturen. |
| `lcnc-webui/src/ToolTablePanel.vue:316` | Renumber sendet `old_tool_number` plus `buildToolMsg`; Add/Save verwenden ebenfalls den Builder. |
| `lcnc-gateway/command_policy.py:1151` | Renumber-Schema begrenzt `tool_number/new_number`. |
| `lcnc-gateway/command_policy.py:1190` | `validate_payload` prüft Grenzen bekannter vorhandener Felder, liefert Korrekturen und ist keine vollständige Form-/Handlerprüfung. |
| `subroutines/probe_basic/probe_z_minus_wco.ngc` | Prüft Werkzeug gegen #3014; löscht G92, schaltet Feed-Override aus/ein, verändert Distanzmodus/Feed und aktive WCS-Z über G10. |
| `examples/sim_config/sim_toolsetter/sim_toolsetter.comp` | Automatische physische Probe benötigt aktivierte positive Tabellenlänge und passenden Plattenbereich. |

Zusätzlich lesend betrachtet: `fix/probe-vars:lcnc-webui/src/probeVarFiles.test.ts`. Dieser neue Test prüft die gemeinsame Probe-/Toolsetter-Variablenmenge gegen ausgelieferte Var-Dateien und deren Sortierung. Er wurde hier nicht ausgeführt, sein anderer Branch nicht als Stand des Review-Gates ausgegeben.

## Isolierte Gegenprobe

`test-strategy.r248.policy-probe.py` neben eine Kopie von `lcnc-gateway/command_policy.py` des genannten Stands legen. **Außerhalb des Live-Baums** mit `python3 -B policy-probe.py` ausführen. Nur Standardbibliothek, kein LinuxCNC-Import, keine Netzwerkverbindung. Die Ergebnisdatei enthält den SHA256 der geprüften Kopie.

Sechs beobachtete Fälle; alle sechs Erwartungen der Gegenprobe erfüllt:

1. Erfundenes `cmd`: keine Exception, leere Korrektur.
2. `mdi` ohne `text`: keine Exception, leere Korrektur.
3. `mdi` mit gültigem Text und verschriebenem `vras`: keine Exception, leere Korrektur.
4. `renumber_tool` mit `old_tool_number=-99`: keine Exception, leere Korrektur.
5. `mdi.vars` mit nicht deklarierter #3015: Ablehnung.
6. Feed-Override 50 bei Obergrenze 2: keine Exception, Korrektur `scale: 2`.

Das belegt die Reichweite des vorgeschlagenen Replays. Insbesondere behauptet es **nicht**, dass ein wirklicher Handler die Fälle 1–4 ausführen würde.

## Externe Primärquellen, am Reviewtag geprüft

- [Vitest 4: related](https://v4.vitest.dev/guide/cli#vitest-related): statisch bestimmbare Imports, `--run` für einmaligen Lauf.
- [Playwright: Test filtering](https://playwright.dev/docs/test-projects#test-filtering): Filter wählen primäre Tests; Abhängigkeitsprojekte laufen zusätzlich, `--no-deps` unterbindet dies.
- [Playwright 1.60.0: Registry](https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/registry/index.ts): `moz-firefox` als BiDi-Kanal vorhanden. Kein Beleg hier für die Tauglichkeit konkreter ESR-/Release-Binaries oder sämtlicher benötigter APIs.

Laufzeiten und Browserstände aus Claudes Plan sind dessen Angaben. Insbesondere wurde die Annahme zum Browser des Maschinen-PCs nicht bestätigt. Keine bisherigen Belege geändert.
