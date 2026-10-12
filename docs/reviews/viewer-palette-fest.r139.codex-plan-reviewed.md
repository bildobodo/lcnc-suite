# Kollisionsprüfung Schritt 4, Paket 2 — Kontaktverläufe je Paar (Detailplan)

**Fassung 1 · 11. Oktober 2026 · Zweig `feat/step4-p2`, angelegt von `feat/step4-p1` nach dessen Einigung · Merge nach `development` über den Integrationszweig, nie `main`.**

Dieser Plan ist der Detailplan, den `kollision-schritt4.plan.md` für Paket 2 ankündigt („Budget, Blockgröße, Ableitungen“). Er beantwortet die Vorgaben aus Codex R84 (VP84-01), R85 und R118 (Antwort auf Frage 3). Gebaut wird erst nach Einigung über diesen Plan.

## Ausgangslage am Stand `2371a617`

**Das Satzmodell.** Ein Befund ist heute ein Satz je (Zeile, Paar): `worst: Map<"line|a|b", CollisionHit>` in `collision.ts` (`recordHit`, 1913–1970).
- Ein Kontakt über tausend Zeilen erzeugt einen Beginnsatz und 999 Fortsetzungssätze.
- Jeder Satz hält in `samples: number[]` jede Abtaststelle im Kontakt, ohne Kürzung. Die Verfeinerung bildet daraus am Ende Cluster.
- Gemessen bei `haus.ngc`, Fall B (R118): 1,78 Mio. Sätze, Heap 1176 MB, 610 s. 95,6 % der Zeit sind Abstandsabfragen, davon 99,9 % an Paaren mit Sätzen.

**Abtastung je Zeile.** Ein Paar im Kontakt bekommt auf **jeder** neuen Zeile eine Pflichtprobe (`collision.ts` 2675–2683). Der Kommentar dort nennt den einzigen Grund: „its continuation record — the G-code panel marks it“.
- Bei 0,09-mm-Zeilen ist das ein Vielfaches des Erkundungstakts.
- Schon am 13. September stand dort: Auf einem Programm mit 0,7-mm-Zeilen fragte die Regel das Paar Werkzeug × Rohteil siebenmal öfter ab als sein Takt.

**Kappung.** `buildResult` (2302–2479) sortiert Beginne vor Fortsetzungen und schneidet bei `MAX_HITS = 200` ab. Paket 1 sagt das nur (`capped`, `cappedOnsets`).

**Cluster.**
- Mehr als 16 Cluster eines Satzes werden still zusammengefasst (2363–2367); R84 zeigte, dass so eine freie Stelle überbrückt wird.
- Lücken unter `CLUSTER_GAP = 2·EXPLORE + MIN_ADV` zwischen berührenden Proben gelten nicht als Trennung (2352).

**Verfeinerung.** Sie läuft nur über die 200 ausgewählten Sätze und nie vor den Anfang der Zeile des Satzes (`lineStartDist`, 2341). Deshalb lagen im Pool 6 von 85 Beginnen eine Zeile zu spät (R90/R91).

**Teilstand.** `peek` kopiert jeden Satz flach in eine neue Map und läuft dann mit Sortierungen und Spannen-Schleifen über alle N. Das ist nicht inkrementell. In der Messung vom 6. Oktober (`haus.ngc` in der Lage des Operators, nicht in `docs/reviews` abgelegt) wuchs ein Teilstand von 208 ms bei 134 903 Sätzen auf 663 ms bei 636 879 Sätzen; in den Unterlagen steht „etwa 0,5 s je Teilstand bei rund 500 000 Sätzen“ (R89/R90). Darauf beruht die Taktbremse im Worker.

**Zeilen.**
- Ein Satz trägt die **rohe** Zeile `track.lines[i]` der entdeckenden Probe. Ein Befund in einer aufgerufenen Datei markiert deshalb die gleich nummerierte Zeile des Hauptprogramms (R118 C).
- `displayLineForPoint` wird nur für Notizen und `range.fromLine` benutzt.

**Ansichten.** Die Identität ist überall (rohe Zeile, Paar): `clashTargets`-Schlüssel, `findingNav`, `firstContact.sameOnset`. Die Ansichten lesen verschiedene Ableitungen (R84):
- `clashTint` leuchtet über die Spanne des Beginns, solange das Paar auf der Zeile keinen eigenen Satz hat; eine Annäherungs-Fortsetzung verlängert diese Spanne (R85, Fable).
- `collisionMarks` markiert je Satz, ohne Spanne. Jenseits der Kappung leuchtet die Färbung weiter, während die Code-Marken dunkel bleiben.
- Die Bänder der Zeitleiste nehmen jeden Satz mit `dist ≤ 1e-3`; der Sweep trennt bei `CONTACT_EPS = 1e-4`.

## Vertrag (Codex R84, R118)

- Je Paar zusammenhängende Kontaktintervalle mit stabiler Identität, Herkunft sowie Spur- und Programmversion. Zeilen sind Zuordnungen, keine Ereigniskennungen.
- Keine stille Kappung, keine stille Zusammenfassung freier Lücken. Nur die sichtbare Liste ist begrenzt.
- Bei erschöpftem Budget: **anhalten und den ungeprüften Rest nennen** (R118). Gesicherte Funde bleiben sichtbar. Ein offener Kontakt bekommt keinen erfundenen Austritt. Die gemeinsame Abdeckung mehrerer Shards folgt konservativ aus ihrer tatsächlichen Arbeit.
- Das Budget wird für **alle** Halter ausgewiesen: offene Kontakt- und Verfeinerungsdaten, Worker-Kopien, Teilstände, zusammengeführtes Ergebnis (R118).
- „Nur Anhängen“ schließt ausdrücklich Aktualisierungen ein: offene Enden, die sich schließen, und Grenzen, die nach dem Eintrag verfeinert werden — jeweils mit stabiler Identität (R118).
- Alle Ansichten zeigen dieselben erhaltenen Ereignisse und dieselben unbekannten Bereiche (R84).

## 1 · Das Modell

### 1.1 Episode und Berührungsintervall

Eine **Episode** ist ein Aufenthalt eines Paars im Rand: von der Probe, die den Eintritt entdeckt, bis zur letzten Probe im Rand vor der bestätigten Trennung (`d > 2·margin`, wie heute in `noteQuery`). Damit überdeckt sie dieselbe Strecke wie heute die Sätze eines Aufenthalts. Sie trägt:
- die Herkunft: Programm, Anfahrt oder Grenzkontakt eines Bereichs-Checks;
- die Art beim Eintritt: Eilgang oder Vorschub (die Schneidregel liest sie wie heute);
- die nächste Annäherung (Stelle und Abstand) über die **ganze** Episode;
- die Kennzeichen `atStart`, `boundary`, `possible` und „offen“;
- ihre Berührungsintervalle.

Ein **Berührungsintervall** ist ein Stück der Episode, in dem das Paar sich berührt oder ineinander liegt (`CONTACT_EPS`; „innen“ und „unentscheidbar“ zählen wie heute als Kontakt). Es hat Eintritt und Austritt, jeweils verfeinert, und die Kennzeichen „möglich“ (Bremsbereich) und „offen“.
- Eine Episode ohne Berührungsintervall ist eine **Beinahe-Kollision**.
- Eine Episode mit Berührungsintervallen ist eine **Kollision**. Ihr erstes Intervall ist der Beginn, jedes weitere ein Wiedereintritt.

Die Zustandsmaschine des Sweeps bleibt, wie sie ist: `noteQuery`, Trennung bei `2·margin`, Schneidpaare, Bremsbereich, Innenprüfung, unbekanntes Werkzeug, Grenzkontakte, Wiederabtastung bei MIN_ADV (R86–R88). Geändert wird, **wohin** sie schreibt, nicht **wann** sie etwas erkennt.

### 1.2 Identität

- Die Identität ist `(Herkunft, Paar, laufende Nummer der Episode je Paar und Herkunft, Nummer des Intervalls in der Episode)`.
- Sie ist stabil innerhalb **eines** Laufs: über alle Teilstände, über das Schließen offener Enden und über Verfeinerungen. Die Paare der Shards sind disjunkt, die Nummern also auch im Pool eindeutig.
- **Nicht stabil über einen Pool-Rückfall.** Der lokale Lauf beginnt neu, und die Abtaststellen hängen von der Shard-Zusammensetzung ab (R90: 6 von 85 Beginnen eine Zeile anders). Ein Ereignis schmaler als MIN_ADV kann im einen Lauf erscheinen und im anderen nicht; dann verschieben sich die Nummern. Der Viewer hält deshalb wie in Paket 1 den gemeldeten ersten Kontakt über den Rückfall. Er wird über (Paar, sich überdeckende Intervalle) wiedererkannt, nicht über die Nummer.

### 1.3 Zeilen sind Zuordnungen

Keine Zeile wird gespeichert. Die Zeile eines Ereignisses ergibt sich aus der Spur an der Stelle, die es benennt:
- beim Intervall der verfeinerte Eintritt;
- bei der Beinahe-Kollision die nächste Annäherung.

Es zählt `displayLineForPoint`:
- In einer aufgerufenen Datei ist es die Aufrufzeile, nie die eigene Nummer der Datei.
- Liefert die Funktion **keine** Zeile (nicht vertrauenswürdig und ohne Aufrufzeile), zeigt das Ereignis den Namen des Unterprogramms, wenn einer bekannt ist, sonst „—“. Es setzt keine Code-Marke, und sein „?“ sagt warum. Auf die rohe Zeile wird nie zurückgegriffen.
- Weil die Zeile aus dem verfeinerten Eintritt kommt, entfällt der R90/R91-Versatz (siehe 2.2).

### 1.4 Speicher: Blöcke typisierter Felder

Zwei Tabellen in Spalten (SoA), in Blöcken zu 4096 Zeilen. Ein Block wird angehängt, nie umkopiert.

| Tabelle | Spalten | Bytes je Zeile |
|---|---|---|
| Episode | Paar u32, Nummer u32, Kennzeichen u16, Eintritt f64, Ende f64 (letzte Probe im Rand; NaN = offen), nächste Stelle f64, nächster Abstand f32, erstes Intervall u32, Zahl der Intervalle u32 | 46 |
| Intervall | Episode u32, Eintritt f64, Austritt f64 (NaN = offen), Kennzeichen u8 | 21 |

**Budget je Anfrage**, über alle Shards zusammen: 65 536 Episoden und 262 144 Intervalle. Das sind 3,0 MB + 5,5 MB = **8,5 MB je Halter**.

Zum Vergleich: 84 Beginne bei `haus.ngc`, 201 in Codex' synthetischem Fall R84. Das Budget liegt um mehr als das Dreihundertfache darüber und wird nur von einem Programm erreicht, das ein Paar zehntausendfach in den Rand und wieder heraus führt.

## 2 · Der Sweep-Kern

### 2.1 Schreiben statt Sätze

Der Sweep schreibt über eine **Senke** mit vier Ereignissen:
- Episode beginnt;
- Berührung beginnt;
- Berührung endet;
- Episode endet.

Dazu kommt die laufende nächste Annäherung einer offenen Episode. `worst`, `samples`, `carriedFrom`, die Cluster und `CLUSTER_GAP` entfallen in der neuen Senke.

### 2.2 Verfeinerung beim Übergang

Jede Grenze einer **Berührung** wird verfeinert, sobald sie erkannt ist, nicht erst am Ende für 200 ausgewählte Sätze:
- **Eintritt einer Berührung:** Bisektion zwischen der letzten Stelle, die als nicht berührend ausgewiesen ist, und der entdeckenden Probe. Es gelten die heutigen Mittel (`distAtCum`, `bisectBoundary`, 1e-3) mit derselben Behandlung von „unentscheidbar“.
- **Austritt:** Bisektion zwischen der letzten berührenden und der ersten nicht berührenden Probe, nach der heutigen Wiederabtastung bei MIN_ADV (R86).
- **Keine Zeilengrenze als Boden.** Der Eintritt darf vor der Zeile der entdeckenden Probe liegen. Die Zeile folgt aus ihm (1.3); das ist der Punkt aus 2c von Schritt 4.
- **Der Eintritt in den Rand wird nicht verfeinert**, wie heute. Er bleibt die entdeckende Probe, und die Art der Episode (Eilgang oder Vorschub) bleibt die Art ihres Segments, wie `noteQuery` sie heute bestimmt. Ein verfeinerter Randeintritt könnte in ein Segment anderer Art zurückfallen und die Schneidregel (Vorschub = Bearbeitung, Eilgang = Fehler) umkehren.

**Jede nicht berührende Probe trennt zwei Intervalle.** Das alte Modell überbrückte Lücken unter `CLUSTER_GAP`; das neue überbrückt nur, was `mergeContiguousIntervals` heute schon verbindet (2e-3).

**Kosten:** etwa 30 Abfragen je Grenze. Bei 84 Beginnen ist das nichts. Im ungünstigsten Fall begrenzt das Budget die Zahl der Grenzen und damit die Kosten.

Weil die Grenzen beim Schreiben schon verfeinert sind, gibt es **keine späteren Verfeinerungen** mehr. Eine Zeile ändert sich nach dem Schreiben nur noch, wenn ein offenes Ende sich schließt oder die nächste Annäherung einer offenen Episode besser wird.

### 2.3 Sonderfälle, unverändert in der Bedeutung

- **Schneidpaar:** Ein im Vorschub begonnener Kontakt schreibt nichts, ein im Eilgang begonnener eine Episode. Der Eilgang nach einem Vorschubkontakt folgt der heutigen Regel (R87/R88).
- **Bremsbereich** (`possible`): Ein Intervall, dessen Proben alle im Bereich liegen, ist „möglich“; eine sichere Probe macht es sicher. Ein mögliches Intervall öffnet keine Wiedereintritts-Regel (R126).
- **Grenzkontakt** eines Bereichs-Checks: eine Episode der Herkunft „Grenze“, offen ab dem Bereichsbeginn. Sie zählt nirgends und endet mit einer bestätigten Trennung; ein Eintritt danach ist ein eigener Befund, wie heute.
- **`atStart`:** Eine Episode, die an der ersten Pose schon berührt, beginnt bei cum 0 mit dem Kennzeichen.
- **Unbekanntes Werkzeug:** Ein Intervall endet am Beginn der Strecke und ein neues beginnt danach, wie heute die Cluster (2359).
- **Unentscheidbare Innenprüfung:** Die Strecken (`undecSpans`) bleiben eine eigene Liste der Notizen.

### 2.4 Budget und „unvollständig ab“

Ist eine Tabelle voll, hält der Sweep an der Stelle an, an der er das nächste Ereignis schreiben müsste:
- Das Ergebnis trägt `incompleteFrom` (Spur-cum) und `truncated.reason = "budget"`.
- Offene Episoden und Intervalle bleiben offen; es gibt keinen erfundenen Austritt.
- Die Übersicht sagt „nicht geprüft ab L…“, wie heute beim Abbruch nach der Probenzahl (`truncated.reason = "samples"`).

Im Pool bekommt jeder Shard ein festes Teilbudget (1/K). `incompleteFrom` und die Abdeckung des Pools sind das Minimum über die Shards. Ein Shard mit vielen Wiedereintritten erreicht sein Teilbudget früher, als es ein geteiltes Budget erzwingen würde. Das ist konservativ und erkauft Einfachheit (Frage 2).

## 3 · Transport, Shards und Merges

### 3.1 Teilstände als Anhänge mit Aktualisierungen

`peek` liefert nur:
- die Zeilen seit dem letzten Teilstand;
- die Zeilen, die sich seitdem geändert haben (ein geschlossenes Ende, eine bessere nächste Annäherung einer offenen Episode). Sie stehen in einer Liste ohne Doppelte mit Merker je Zeile.

Die Kosten sind proportional zu Neuem plus Offenem, nicht zu N. Die Felder gehen als übertragbare Puffer an `postMessage`.

Der sofortige erste Kontakt aus Paket 1 (1b) wird ein sofortiger Teilstand, sobald das erste Berührungsintervall geschrieben ist. Eine eigene Nachrichtenart `first` braucht es dann nicht mehr.

### 3.2 Shards

- Der Koordinator führt je Shard eine Tabelle, wendet deren Teilstände an und reicht sie mit der Shard-Nummer an den Viewer weiter.
- **Er baut keinen zusammengeführten Teilstand mehr aus älteren Worten der Shards.** Daher kamen VP-I91 und VP-I92: ein zusammengeführter Teilstand ersetzte, was schon gezeigt war. Der Viewer hängt nur noch an; was gezeigt ist, geht nicht zurück.
- Die Tabellen des Koordinators bleiben für die Übergabe bei einem Rückfall (VP-I48/I49): Ein angehaltener Lauf wird mit seinem Stand übergeben.
- Statische Kontakte und die Zahl der vorab ausgeschlossenen Paare kommen wie heute von Shard 0. Die Notizen werden vereinigt (`unitedNotes`).

### 3.3 Anfahrt und startabhängiger Anfang

**Anfahrt** (`mergeEntryResult`):
- Die Episoden der Anfahrt kommen mit der Herkunft „Anfahrt“ hinzu, um die Länge der Anfahrt verschoben.
- Ein Kontakt, den beide Läufe sehen, zählt einmal. Das ist eine offene Anfahrt-Episode mit einem Intervall bis zum Ende der Anfahrt, und eine Programm-Episode desselben Paars, die bei cum 0 im Kontakt beginnt. Ihr **erstes** Intervall wird Fortsetzung des Anfahrt-Intervalls; spätere Intervalle bleiben Wiedereintritte des Programms (R34 VP-I09).
- Der tote Zweig `continuation === 0` (GcodePanel, R85) entfällt mit dem Feld.

**Startabhängiger Anfang** (`mergeBeginningOntoBase`): Die Episoden des Anfangs kommen auf die Basisachse, mit `max(0, c − shift)` wie heute. Das bleibt eine benannte Grenze der Anzeige.

### 3.4 Halter und ihr Budget

| Halter | Inhalt | Obergrenze |
|---|---|---|
| Sweep je Shard | eigene Tabellen (Teilbudget), Zustand je Paar (wie heute) | Σ ≤ 8,5 MB |
| Teilstand unterwegs | Anhänge und Aktualisierungen, übertragbare Puffer | ≤ Neues + Offenes |
| Koordinator | Tabellen je Shard | ≤ 8,5 MB |
| Viewer | Tabellen der Anfrage, Index der Ziele (u32 je Ziel), Vereinigung der Berührungen (f64-Paare) | ≤ 8,5 MB + 1,3 MB + ≤ 4,2 MB |
| **Summe** | | **etwa 31 MB** statt 1176 MB |

Im Viewer entsteht kein Objekt je Ereignis. Objekte gibt es nur für das sichtbare Fenster der Liste (4.4).

## 4 · Eine Ableitung für alle Ansichten

Alle Ansichten lesen die Tabellen über **ein** Modul (`viewer/contactView.ts`).

### 4.1 Ziele, Zählung, Navigation

- **Ziele** sind die Berührungsintervalle (Kollision, Wiedereintritt, möglich, Anfahrt) und die Beinahe-Kollisionen (Episode ohne Intervall, an ihrer nächsten Annäherung).
- Ein **Index** führt sie nach Stelle sortiert als typisierte Felder (Reihenfolge, Art).
- `findingWords` zählt aus dem Index.
- Navigation: `targetAfter` / `targetBefore` suchen binär im Index. Der Schlüssel ist die Identität (1.2), nicht mehr die Zeile.
- „touch“ heißt überall: das Ziel ist ein Berührungsintervall. Die Schwelle 1e-3 der Ansichten neben 1e-4 im Sweep entfällt; es gilt eine Klasse, die des Sweeps.

### 4.2 Code-Marken

- Eine Zeile ist markiert, wenn eine Episode eine ihrer Bewegungen überdeckt; heute markieren die Sätze genau die Zeilen im Rand. Die Arten bleiben die heutigen: Grenze, „möglich“, sonst Kontakt (`collisionMarkByLine`). Eine Unterscheidung von Annäherung und Berührung in der Marke kommt nicht hinzu.
- Das Code-Panel fragt **nur die sichtbaren Zeilen** ab:
  - Anzeigezeile → ihre Spurbereiche über einen Index der Anzeigezeilen, einmal je Spur gebaut wie `lineIndex.ts`, mit den Aufrufspannen;
  - dann Überdeckung, binär gesucht.
- Es entsteht keine Menge über alle Zeilen. Das Ereignis `collision-lines` übergibt die Tabellen bzw. eine Abfragefunktion statt einer Liste.

### 4.3 Färbung, Bänder

- **Färbung:** Ein Paar leuchtet, wenn die Pose in einem seiner Berührungsintervalle liegt. Ein offenes Intervall gilt bis zur Abdeckung. Es gibt keine Spanne aus einem Beginnsatz und keine Verlängerung über eine Annäherung (R85).
- **Bänder der Zeitleiste:** die Vereinigung der Berührungsintervalle. Ein offenes reicht bis zur Abdeckung und ist als offen gekennzeichnet.

### 4.4 Liste im Sim-Tab

- Die Liste zeigt ein **Fenster** von höchstens 400 Zeilen um die gezeigte bzw. nächste Zeile. Davor und danach steht je eine Zeile „N frühere“ / „N spätere“.
- ‹ › und die Zählung erreichen jedes Ziel; nur die Liste ist begrenzt (R84).
- Fokusführung (R78) und Mitlaufen (R81) gelten für das Fenster. Verschiebt sich das Fenster unter einem fokussierten Element, gilt die heutige Regel: dieselbe Zeile, sonst die an ihrer Stelle, sonst der Filter.

### 4.5 Erster Kontakt (Paket 1)

`withFirstContact` / `holdsFirst` vergleichen über Paar und Überdeckung statt über Zeile und Paar. Gebraucht werden sie nur noch über einen Pool-Rückfall (1.2).

## 5 · Die Pflichtprobe je Zeile entfällt (eigener Commit, eigene Abnahme)

Ihr einziger Grund ist der Fortsetzungssatz; mit 4.2 folgt die Marke einer Zeile aus der Überdeckung. Danach tastet ein Paar im Kontakt im Erkundungstakt ab, mit der Wiederabtastung bei MIN_ADV an jeder Trennung (R86).

Die Garantie hängt nicht an der Zeile:
- Ein Austritt wird an der ersten nicht berührenden Probe gefunden und verfeinert.
- Zwischen zwei berührenden Proben gilt die Strecke wie heute als Kontakt. Der Fehler geht nur in die vorsichtige Richtung: eine Zeile ohne eigene Probe wird markiert, nie verschwiegen.

Die Schrittweite für Annäherung und Eintritt ändert sich nicht. Das ist keine größere Schrittweite im Sinn der Operator-Bedingung. Es entfällt nur die Probe, die heute **jede Zeile** eines bekannten Kontakts einmal abfragt.

Warum ein eigener Commit: Die Gegenprobe gegen das alte Modell (7.2) muss bei gleicher Abtastung exakt sein. Mit weniger Proben ist nur noch „neu ⊇ alt“ prüfbar, weil zwischen berührenden Proben vorsichtig überbrückt wird. Gemessen wird `haus.ngc` Fall B vorher und nachher: Zeit, Abfragen, Heap.

**Vorab gemessen** (11. Oktober, Stand `2371a617`, noch mit dem alten Satzmodell, `haus.ngc` Fall B, ein Kern):

| | mit Pflichtprobe | ohne |
|---|---|---|
| Laufzeit | 710 s | 186 s |
| Zeit in Abfragen | 677 s | 127 s |
| Heap | 1198 MB | 218 MB |
| Proben des Sweeps | 1 371 002 | 1 377 510 |
| Beginne mit Berührung | 15 | 15, dieselben (je Paar innerhalb von 2 Einheiten) |
| Beginne von Beinahe-Kollisionen | 69 | 46 |

Die Laufzeit mit Pflichtprobe lief zeitweise neben einem Browsertest; Heap und Zählungen hängen davon nicht ab.

Die 23 fehlenden Beginne sind ausnahmslos Beinahe-Kollisionen mit 1,83–2,0 mm Abstand, also am Rand des Prüfabstands, in vier Paaren (Säule gegen Abdeckungen, Wellen, Planscheibe und Lagerlippe). Jeder liegt im Lauf ohne Pflichtprobe innerhalb eines Aufenthalts desselben Paars, der dieselben Zeilen überdeckt. Es gibt keinen Beginn, den nur der Lauf ohne Pflichtprobe hat.

Ursache: Eine Episode endet erst mit einer **abgetasteten** Trennung (`d > 2·margin`). Die Pflichtprobe je Zeile tastete bei 0,09-mm-Zeilen so dicht, dass kurze Ausflüge über 4 mm gesehen wurden. Ohne sie bestimmt der Erkundungstakt, wo eine Trennung gesehen wird; dazwischen gilt der Aufenthalt als zusammenhängend. Das ist die vorsichtige Richtung: Keine Berührung fehlt, eine Annäherung wird nie verschwiegen, nur seltener unterteilt. Diese Abweichung ist Frage 1.

## 6 · Mitgenommen (Schritt 4, 2c)

- Der tote Zweig `continuation === 0` (3.3).
- Die Spanne aus der `cumEnd` einer Annäherungs-Fortsetzung (4.3).
- Die Zeile eines Beginns aus dem verfeinerten Eintritt (2.2).
- Befunde in aufgerufenen Dateien mit der Aufrufzeile (1.3).
- `capped`, `cappedOnsets`, „200+“ und die Kappungswörter aus Paket 1 entfallen; an ihre Stelle tritt `incompleteFrom`.

## 7 · Abnahme

### 7.1 Codex' Belegliste (R84)

- 201 Beginne, alle als Ziele, keine Kappung;
- 17 Intervalle auf einer Zeile, keines überbrückt eine freie Stelle;
- eine wiederholte Quellzeile (Schleife, Unterprogramm): zwei Episoden bzw. Intervalle;
- ein langer Dauerkontakt: ein Intervall, Marken auf allen Zeilen, Färbung und Band durchgehend;
- der Anfahr-Merge: ein Kontakt beider Läufe ist ein Ziel.

Für jeden Fall zeigen Liste, Navigation, Zählung, Färbung, Bänder und Code-Marken dieselben Ereignisse und dieselben unbekannten Bereiche (ein Test, der alle sechs aus `contactView` und den Ansichten liest).

### 7.2 Gegenprobe gegen das alte Modell, bei gleicher Abtastung

Während Runde A schreibt der Sweep in **beide** Senken, in der alten wie in der neuen; die Proben sind also dieselben. Auf zufälligen Spuren der mitgelieferten Modelle (wie `collisionOracle.test.ts`) gilt je Paar:
- dieselbe Vereinigung der Berührungsintervalle bis auf die Verfeinerungstoleranz;
- dieselben Beinahe-Episoden.

Erlaubt sind Abweichungen nur dort, wo das alte Modell gekappt (200), zusammengefasst (16 Cluster, `CLUSTER_GAP`), an der Zeilengrenze verfeinert (R90) oder eine Annäherung als Spanne gezählt hat (R85). Dazu kommt die Stelle einer Beinahe-Kollision: die nächste Annäherung der ganzen Episode statt der der Beginnzeile. Jede solche Abweichung wird gelistet und von der Wahrheit entschieden: der Orakel-Abtastung bei 0,5 Parametereinheiten und der Brute-Force-Distanz.

### 7.3 Orakel und Shards

- `collisionOracle.test.ts` bekommt seine Prüfungen auf dem neuen Modell. Die Prüfung in Zeile 151 („eine Pose im Rand braucht einen Satz auf ihrer Zeile“) wird zu „liegt in einer Episode“.
- `sweepShards.test.ts`: gleiche Episoden und Intervalle in 1, 2 und 3 Shards bis auf Ereignisse schmaler als MIN_ADV. Die Wahrheit entscheidet wie heute.
- **Zufällig erzeugte Maschinen** (Operator, 11. Oktober): Das Orakel läuft zusätzlich auf erzeugten Modellen, damit die Allgemeinheit belegt und nicht nur angenommen ist. Bisher läuft es nur auf den drei mitgelieferten.
  - Erzeugt werden Gelenkbäume in zufälliger Reihenfolge, Linear- und Drehachsen auf Werkzeug- und Werkstückseite (auch verschachtelt) und Quader verschiedener Größe als Körper.
  - Für die unterstützten Familien xyzac/xyzbc-trt und xyzacb-trsrn kommen zufällige Drehpunkt-Abstände hinzu.
  - Ein neuer Fall in `collisionFixtures.ts` neben `shippedCases`, mit fester Saat je Lauf und der Saat im Fehlertext.
  - Geprüft wird dasselbe wie auf den mitgelieferten Modellen: jede Berührung und jede Pose im Rand gemeldet, wenn breiter als MIN_ADV; jeder gemeldete Beginn eine echte Berührung.
  - Nicht unterstützte Kinematiken bleiben „nicht zertifiziert“; der Generator erweitert keine Familie.

### 7.4 Budget und Speicher

- Ein künstlich kleines Budget hält an, sagt „unvollständig ab“, lässt offene Kontakte offen und zeigt die gesicherten Funde.
- Im Pool ist `incompleteFrom` das Minimum über die Shards.
- `haus.ngc` Fall B: Heap und Zeit vorher und nachher, dazu Abfragen nach Commit 5.

### 7.5 Weitere Abnahme

- Ein Befund in der M600-Routine nennt die Aufrufzeile. Ein Ereignis ohne Anzeigezeile zeigt den Namen bzw. „—“ und setzt keine Marke.
- Die Teilstände wachsen nur: Anhängen plus Aktualisieren nach Identität. Eine Folge Teilstand → älterer Shard → Rückfall nimmt nie etwas Gezeigtes zurück (die R136–R138-Folgen als Wächter).
- Mutationen für jede Regel, kompilierend und rot.

## 8 · Runden

Paket 1 war klein und brauchte drei Runden. Paket 2 berührt Sweep-Kern, zwei Merges, Transport und sechs Ansichten. Ich schlage zwei Umsetzungsrunden vor:

- **Runde A — Kern:**
  - Modell und Tabellen;
  - die Senke im Sweep mit beiden Senken und exakter Gegenprobe;
  - Verfeinerung beim Übergang, Budget;
  - Shard- und Anfahr-Merge auf Tabellen;
  - Teilstände als Anhänge, Koordinator;
  - das Orakel auf zufällig erzeugten Maschinen (7.3).

  Die App liest in Runde A noch die alte Senke. Geprüft wird durch Orakel, Gegenprobe und `collisionWorker.test` mit falschen Sub-Workern.
- **Runde B — Ansichten:**
  - `contactView`, Code-Marken, Färbung, Bänder, Liste mit Fenster, Navigation, Anzeigezeilen;
  - Umstellung des Viewers, Entfernen der alten Senke;
  - als letzter Commit die Pflichtprobe je Zeile (5) mit Messung;
  - Doku.

## 9 · Nicht in diesem Paket

- Das Kontaktzertifikat für anhaltende Durchdringung (eigener Plan nach Paket 2).
- Erklärte erlaubte Kontakte (Paket 3).
- Die Teilung der Spur in Abschnitte (Schritt 5).
- GPU.
- Die Messung auf einem getrennten Browser-PC bleibt eigens offen.

## Fragen an Codex

1. **Pflichtprobe je Zeile:** Ist ihr Wegfall in Paket 2 vertretbar, als letzter Commit mit eigener Abnahme („neu ⊇ alt“, Orakel, Messung), oder gehört er in einen eigenen Plan? Gemessen bei `haus.ngc` Fall B: etwa ×3,8 schneller, Heap 1198 → 218 MB, alle Berührungen gleich. Beinahe-Kollisionen am Rand des Prüfabstands werden aber seltener getrennt (69 → 46 Beginne). Reicht das, oder sollen Beinahe-Episoden ihre Trennung eigens abtasten?
2. **Budget:** Sind 65 536 Episoden und 262 144 Intervalle je Anfrage mit festem Teilbudget je Shard der richtige Ansatz, oder soll der Koordinator Budget dynamisch zuteilen?
3. **Ereignis ohne Anzeigezeile:** Name des Unterprogramms bzw. „—“, keine Marke, Begründung im „?“ — reicht das?
4. **Identität:** Stabil je Lauf, über einen Pool-Rückfall nur der erste Kontakt über (Paar, Überdeckung) gehalten. Oder sollen alle gezeigten Ereignisse des abgebrochenen Laufs sichtbar bleiben, bis der neue Lauf ihre Stelle erreicht?
5. **Trennung:** Jede nicht berührende Probe trennt zwei Intervalle, statt Lücken unter `CLUSTER_GAP` zu überbrücken. Einverstanden?
6. **Runden:** Zwei Umsetzungsrunden (A Kern, B Ansichten) statt einer?
