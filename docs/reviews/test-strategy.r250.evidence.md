# R250 · Lesebefunde zum Teststrategie-Plan v2

Stand: `9a7ec104a7ae1dddb5b7cf4ed7016dbd1643e4ff`. Keine Ausführung von Produkt-/Browser-/Live-Tests. Keine Netzwerkverbindung zu einem Gateway. Die folgenden Quellen wurden nur gelesen.

| Quelle | Konkreter Befund |
| --- | --- |
| `docs/reviews/test-strategy.review.md:352` | TS248-04 will verschachtelte Formen aus `WsCommand` lesen und Indexsignaturen ablehnen. |
| `lcnc-webui/src/lcnc.ts:44` / `:55` / `:93` | `probe_vars` bzw. `vars` sind absichtlich `Record<string, number>`. |
| `lcnc-webui/src/lcnc.ts:98` / `:115` | G30-Werte/Basis und Touch-off-Achsen sind ebenfalls Datenmaps. |
| `lcnc-webui/src/lcnc.ts:125` / `:131` | Settings-Daten sind `any`, Diagnosedaten `Record<string, any>`. |
| `lcnc-webui/src/wsWorker.ts:284` | Der Worker erzeugt `hello` mit `session` und `resume_armed`, außerhalb der `WsCommand`-Union. |
| `lcnc-webui/src/wsWorker.ts:135` / `:415` | Der Worker sendet nummerierte Heartbeats mit `seq`; die Union benennt nur `cmd: heartbeat`. |
| `lcnc-webui/playwright.config.ts:24` / `:45` | Volle Konfiguration ist `fullyParallel: true`; erstes Chromium-Projekt hat keine eigene `workers: 1`-Grenze. Die späteren seriellen Projekte ändern daran nichts. |
| `docs/reviews/test-strategy.review.md:334` | Genau ein Projekt/ein Worker wird für die neue selektive Konfiguration zugesagt. |
| `docs/reviews/test-strategy.review.md:370` | Replay-Herkunft soll allein über Teststart/-ende-Zeitfenster kommen. Zusammen mit dem unverändert vollen Merge-Lauf ist Eindeutigkeit nicht garantiert. |
| `docs/reviews/test-strategy.review.md:397` | Live-Zielvertrag benennt INI-Pfad-Erlaubnisliste und Gateway-Code-Stand. |
| `scripts/toolsetter_readback_check.py:115` | Vorhandener stärkerer Vertrag `validate_sim_target`: laufende INI, ausgeliefertes Profil, Inhalte und rekursiv relevante HAL-/loadusr-Dateien. |
| `scripts/toolsetter_readback_check.py:49` | Modul erzeugt beim Import ein `linuxcnc.stat()`; reinen Helfer zur Wiederverwendung gegebenenfalls separat halten. |

## Grenzfälle für den Bau, keine behaupteten Testläufe

1. Die Formprüfung muss `mdi.vars = {"3015": 10}` akzeptieren können, ohne beliebige zusätzliche Felder des Befehls zu erlauben.
2. Zwei Tests haben gleichzeitig aktive Zeitfenster. Ein im gemeinsamen Mock empfangener Befehl hat ohne Verbindungs-/Testbindung keine eindeutig beweisbare Herkunft. Das betrifft auch die Zulassung einer erwarteten negativen Nutzlast.
3. Eine INI bleibt am erlaubten Pfad und das Gateway läuft auf demselben Commit, aber der HAL-Inhalt ändert sich. Pfad und Gateway-Commit unterscheiden diese Konfigurationen nicht; die bereits vorhandene Zielprüfung tut dies.

Diese Beispiele begründen Planpräzisierungen. Sie sind keine Behauptung, dass die noch nicht gebauten Wächter bereits fehlerhaft implementiert wären.
