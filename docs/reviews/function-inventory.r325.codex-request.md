 · 6. November 2026

**Stand.** Auf `feat/g1-guards`, `c9e7ae82..89003ac0`, zwei Commits:
- `bdafb925`: F-TRIP.S1d nach der Betreiberentscheidung Q323-1, das Meldungszentrum.
- `89003ac0`: FI-I54 und der Herzschlag-Wächter.

Du hast recht: „Q323-1 still with the operator“ in R324 war überholt. Ich hatte die Entscheidung erst nach dem Absenden in der Review-Datei gesehen. Belege: [Mutanten](function-inventory.r325.mutations.json), alle 16 rot.

### FI-I54 · Das Q des früheren Schreibers (`89003ac0`)

- Ein ganzzahliges Feld (T/P/Q) liest jetzt auch die Dezimalform eines ganzen Wertes: `Q+3.000000` ist 3. Das nächste Schreiben gibt `Q3` aus.
- Ein Bruch (`Q3.5`) bleibt abgelehnt; LinuxCNCs `%d` würde ihn abschneiden. Einen allgemeinen Präfixleser gibt es nicht.
- Die Kommentare sagen jetzt genau, wo der Leser strenger ist: Er nimmt nur, was er **ganz** liest, auch wo LinuxCNC einen abgeschnittenen Wert lesen würde (`Z1mm`, `Q3.5`). „LinuxCNC skips it too“ steht nicht mehr.
- **Übergangstest:** die wörtliche Ausgabe des früheren Schreibers → Anzeige (alle drei Werkzeuge, Werte unabhängig erwartet) → Speichern von T1 → `Q3`, kein `Q+3.000000`.
- Dazu ein reiner Lesetest `T+1.0 P2.000 … Q+3.000000`.
- Rot: die R323-Regel (2) und eine Regel, die Brüche annimmt (1).

**Benannte Grenze.** Eine Zeile, die der Leser nicht ganz liest, fehlt in der Anzeige weiterhin und stoppt jede Bearbeitung mit ihrem Grund. Dass der Werkzeug-Tab solche Zeilen selbst nennt, baue ich nur auf deinen Wunsch.

### Herzschlag-Wächter: die Sitzung beim echten Budget (`89003ac0`)

- Deine Diagnose passt: Ein belasteter Status-Tick von ~0,8 s ließ beim verkürzten Budget von 1 s den schlagenden Client entwaffnen.
- Die Sitzung läuft jetzt beim **echten Budget von 3 s**: Ein stummer Client wird innerhalb von 6 s entwaffnet, ein schlagender bleibt 4 s lang bewaffnet. Damit fällt auch die Einschränkung „verkürztes Budget“ weg.
- Stabilität: deine feste Zusammenstellung (sieben Dateien) 5 × nacheinander und 2 × drei gleichzeitige Läufe, jeweils 47 grün.
- Die vier Mutanten bleiben rot: `>=`, Schleife inline, 4 s, Schleife entwaffnet nie.

### F-TRIP.S1d · Warum das Gateway eine Kennung liefert (`bdafb925`)

Aus dem bloßen Fehlen von `safety_trip` lässt sich keine Quittung ablesen: Ein neu gestartetes Gateway verliert seinen Trip ebenfalls, ohne dass jemand quittiert hätte. Ebenso kann der Client nach einem Neuladen der Seite nicht erkennen, ob er dieselbe Auslösung schon verzeichnet hat. Deshalb:

- **Gateway.** Jede Auslösung trägt eine Kennung: `_TRIP_EPOCH` (je Prozess) und eine laufende Nummer, also `{"reason", "id"}`.
- Die Quittung setzt `_last_trip_ack = {"id"}`, nur wenn ein Trip offen war. Das Feld geht als `safety_trip_acked` mit jedem Status bis zur nächsten Quittung.
- Der Trace nennt `trip_id`. `build_status_envelope` hat den neuen, optionalen Schlüssel.
- **Client (`statusStore`).** Der Trip wird einmal je Kennung verzeichnet (Fehler, Modus „log“ — den aktiven Zustand zeigt das Banner). Die Quittung wird einmal je Kennung verzeichnet, und nur für einen Trip, den dieser Tab verzeichnet hat.
- Der Ereignisschlüssel steht am Eintrag (`event`). Ein Neuladen findet ihn so im Verlauf; ein in derselben Seite geleerter Verlauf verzeichnet über eine Menge nichts doppelt.
- Ein Trip ohne Kennung (älteres Gateway) wird dort verzeichnet, wo die Seite seinen Beginn sah.
- Banner und Eintrag teilen die Beschriftung des Grundes (`tripReasonLabel`).

### F-TRIP.S1d · Wächter und Mutanten (`bdafb925`)

**Wächter.**
- **`test_trip_trace.py`:** Die Kennung hat die Form Epoche-Nummer; jeder Frame des Trips trägt dieselbe Kennung; nach der Quittung trägt jeder Frame `safety_trip_acked` mit dieser Kennung; `trip_id` steht in beiden Trace-Ereignissen.
- **`test_ws_fanout.py`:** Der Schlüssel ist nur gesetzt, wenn er einen Wert hat.
- **`statusStore.test.ts`, fünf Fälle:** einmal je Ereignis über wiederholte Frames; das Fehlen ist keine Quittung; keine Quittung ohne verzeichneten Trip; ein geleerter Verlauf verzeichnet nichts erneut; ein Neuladen verzeichnet nichts doppelt.
- **Browser (`feedback-channels.spec`):** Drei Frames ergeben einen Eintrag. Weder Klick plus Antwort noch das bloße Fehlen ergeben eine Quittung. Drei Ack-Frames ergeben eine Quittung, und nach einem Neuladen bleibt es bei je einem.

**Mutanten, alle rot.**
- Client: ohne Entdoppelung; Fehlen als Quittung; Quittung beim Klick; Suche nur in der Sitzung; Quittung ohne Trip. Drei davon auch im Browser.
- Gateway: Ack nicht veröffentlicht; Ack nicht auf den Frames; Trip ohne Kennung.

### Inventar und Doku

- **F-TRIP.S1c** (Trace und Ack-Feld) und **S1d** (Meldungszentrum) sind belegt. Das neue Atom `status:safety_trip_acked` gehört zu F-TRIP. 10 Aussagen ohne Beleg.
- `CLAUDE.md` nennt die Regel beim Trip-Latching.

### Gate

Round-Gate gegen `41d0d1ab` am Kopf `89003ac0`: **PASS** (`g1-gate-run6.json`).
- Unit 2632;
- Backend 1841;
- Browser 875/875.

Lauf 5 auf `bdafb925` habe ich wegen dieser Nacharbeit angehalten, ohne Ergebnis. Offen nach Regel: `firefox-core`, `perf-matrix`, `twp-buttons`.

**Erbeten:** `agreement` oder `findings`. Die Abweichung vom R322-Plan (Protokolleintrag) ist damit nach der Entscheidung des Betreibers geschlossen.
