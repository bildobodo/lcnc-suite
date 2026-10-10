# Kollisionsprüfung, Schritt 4 — früh antworten, Kontaktverläufe je Paar, erklärte erlaubte Kontakte

**Fassung 1 · 9. Oktober 2026 · Kollisionsplan Schritt 4.** Der Operator hat am 9. Oktober den Plan freigegeben („du kannst den plan machen“), in der Reihenfolge, auf die sich R84/R85 geeinigt haben:

1. früh antworten, mit Berechnungskontext (VP84-03 + D5);
2. Kontaktverläufe je Paar mit Vollständigkeitsvertrag (VP84-01);
3. erklärte erlaubte Kontakte (VP84-02).

Codex hat in R85 keinen Einwand gegen diese Reihenfolge erhoben. Für Paket 1 hat er drei Umsetzungshinweise gegeben, die unten eingearbeitet sind.

Gebaut wird erst nach Einigung, Paket für Paket, jedes mit eigener Umsetzungsrunde. Unverändert gilt die Bedingung des Operators: Zuverlässigkeit wird nicht geopfert. Keine größere Schrittweite, keine Stichprobe, die als Prüfung gilt.

## Ausgangslage, gemessen am Stand `fe997e6a` und live am 9. Oktober

### Wie das Ergebnis heute erscheint

1. **Teilergebnisse während der Prüfung.** Der Worker schickt den unverfeinerten Stand (`SnapshotHandle.peek`) höchstens alle 500 ms (`PEEK_MS`), nur wenn sich die Zahl der Einträge geändert hat, mit Taktbremse (`PEEK_DUTY` 9). Marken, Bänder, Färbung und Code-Marken erscheinen so während der Prüfung; die Übersicht sagt „2 collisions so far“.
2. **Fortschritt, Ergebnis und Abdeckung** stehen an zwei Stellen. Die Zeile „Collision check“ trägt Balken und Prozent, die Übersichtszeile das Urteil (`ScrubBar.vue` `sweepView`, 1016–1067). Eine Kappung der Meldungen sagt keine der beiden.
3. **Das „?“ der Prüfung** (`verdictDetail`, 725–742) nennt:
   - „Still checking“ bzw. wo die Prüfung stehen blieb;
   - „N contacts at the start ignored“ (ohne die Paare);
   - „Not certified: …“;
   - die Werkzeuge, mit denen geprüft wurde.

   Es nennt nicht: Kinematik, Drehachsenlage, Nullpunkt, Werkzeugbasis, ob eine Anfahrbewegung dabei ist, welche Paare ausgeschlossen sind (statisch, Vorab-Ausschluss), welche Körper offen oder unbrauchbar sind.
4. **Zwei verlustbehaftete Kappungen.**
   - `MAX_HITS` = 200 Einträge (`collision.ts:439`), Kontaktbeginne zuerst. Darüber hinaus fällt alles weg, ohne Kennzeichen (Codex R84: 201 Beginne → 200, `truncated: null`).
   - Die Verfeinerung führt mehr als 16 Kontaktcluster eines Eintrags zusammen (`collision.ts:2108`) und überbrückt damit eine freie Lücke (Codex R84: 17 Kontakte auf einer Zeile → 16 Intervalle).
5. **Statischer Ausschluss.** Ein Paar, das in Ruhe **und** in der ersten Pose im Abstand liegt, wird nie wieder abgefragt (D3).
6. **Zeilen als Schlüssel.** Einträge gelten je (rohe Spurzeile, Paar). In einer aufgerufenen Datei ist die rohe Zeile die der Datei.
   - Live gefunden am 9. Oktober (M600-Lauf auf der XYZAC-Sim): Die vorläufige Prüfung im Lauf sagte „Checked from L339“ für ein Programm mit 60 Zeilen. 339 ist eine Zeile von `tool_touch_off.ngc`.
   - Die Startzeile und die Notiz zu unbekannten Starts sind auf `fix/range-display-line` korrigiert (dieselbe Regel wie die Code-Anzeige, `displayLineForPoint`).
   - **Nicht korrigiert:** Ein Befund in der Routine (etwa auf dem Weg zum Toolsetter) trägt dieselbe rohe Zeile. Die Liste zeigt „L339“, das Code-Panel markiert Zeile 339 des Hauptprogramms. Die Zeile ist Schlüssel der Einträge; die Korrektur gehört zu Paket 2.

### Messung mit `profile` (Codex R84: „zuerst messen“)

Gemessen im Node-Prozess, ein Faden, mit den Optionen, die die Seite ihrem Worker gibt (Epochen-Terme, TLO-Ereignisse, Programmwerkzeuge aus `parse_tlos`, unbekannte Werkzeuge, M600-Stopps); XYZAC-Modell, 384 Paare.

**A · `haus.ngc` in der heutigen Sim-Lage** (Identität, A 0, die Analyse des heutigen Workers):
- 9,4 s, 754 021 Proben, kein Kontakt, 9 statische Kontakte;
- Abstandsabfragen 315 ms, das sind 3,3 % der Zeit; der Rest sind Posen, Zertifikate und Buchführung;
- Speicher: Heap 35 MB.

**B · `haus.ngc` in der Lage des Operators vom 7. Oktober** (seine damalige Analyse, TCP, A 61,3°, das Programm weit außerhalb des Verfahrwegs, Maschinenteile durchdringen sich dauerhaft), mit dem heutigen Sweep-Code:
- 610 s, 1 371 002 Proben, 384 Paare, 18 vorab ausgeschlossen, 8 statisch;
- **erster Eintrag nach 0,76 s** bei 0,00 %: L17, hintere Säule ↔ Y-Schlitten im Eilgang (das Programm beginnt im Kontakt);
- 200 Einträge (Kappung erreicht), 84 Beginne, `truncated: null` — die Kappung ist still;
- Abstandsabfragen 583 s, das sind **95,6 %** der Zeit; davon entfallen **99,9 %** auf Paare, die einen Eintrag haben, also auf bekannte Kontakte;
- das teuerste Paar (hintere Säule ↔ C-Planscheibe) trägt 30,6 % (178 s, 112 778 Abfragen, 1,6 ms je Abfrage); aufgeteilt nach Paaren ist ×3,27 die Grenze, ab 4 Workern;
- **Speicher: Heap 1,18 GB** bei 1,78 Mio. Einträgen je Zeile und Paar vor der Kappung. Jeder Shard hält seine eigenen Einträge.

**Was daraus folgt:**
- Die erste Meldung ist für diesen Fall schon schnell (0,76 s im Kern); im Browser kommt der Takt des Teilstands dazu (bis 500 ms plus Taktbremse). Ein Absturz spät im Programm wird gemeldet, wenn die Prüfung dort ankommt. Paket 1 ändert daran die Wartezeit des Teilstands, nicht die Prüfgeschwindigkeit.
- Zeit und Speicher sitzen fast ganz in **bekannten Kontakten**: Jedes Paar im Kontakt wird im Erkundungstakt und auf jeder Zeile neu abgefragt, und jede Zeile erzeugt einen Eintrag. Das ist Paket 2 (keine Einträge je Zeile, Anhängen statt Kopieren) und darüber hinaus ein **Kontaktzertifikat** (unten, „Nicht in diesem Plan“).
- 1,18 GB in einem Prozess heißt auf dem Panel-PC mit zwei bis vier Shards eine echte Gefahr, dass der Speicher ausgeht. Paket 2 hat damit Vorrang vor jeder weiteren Beschleunigung.

### Live am 9. Oktober (Simulation, ein M600-Programm)

- Die Prüfung im Lauf arbeitet von Ende zu Ende: Messung von T1 nach 10,8 s, eingefrorene Analyse nach 131 ms veröffentlicht, vorläufige Prüfung zugelassen nach 12,4 s, „Clear · checked in full“ nach 17,0 s; dasselbe nach der Messung von T7.
- Statusbilder an einem einfachen Client während des Laufs: p95 36,2 ms, max 47,9 ms; keine Herzschlag-Lücke über 200 ms.
- Zwei Fehler in Nachbarbereichen, beide behoben und gemergt:
  - Das Rücklesen der Toolsetter-Werte und G30 lesen scheiterten mit geladenem Programm, weil LinuxCNC `task_plan_synch` in AUTO ablehnt (`fix/synch-auto`).
  - Die Vorschau buchte bei einem M6 die Tabellenzeile als Werkzeugnummer. Bei der XYZAC-Tabelle (Bibliothek vor T1) hatten die Programmwerkzeuge auf dem Client keine Maße, und die Prüfung ließ ihre eigenen Kontakte aus (`fix/tool-row-index`).

## Paket 1 · Früh antworten; Ergebnis, Abdeckung und Ausschlüsse getrennt lesbar (VP84-03 + D5)

### 1a · Die Übersichtszeile sagt drei Dinge getrennt

Die eine Übersichtszeile des Sim-Tabs bleibt eine Zeile und trägt drei Aussagen:

| Aussage | Werte |
|---|---|
| **Ergebnis** | „Kollision gefunden“ (mit Anzahl, sobald sie feststeht) · „Clear“ · „Nicht geprüft“ |
| **Abdeckung** | „12 % geprüft“ · „ganz geprüft“ · „vorläufig ab L7“ · „bis 60 % (Abbruch)“ |
| **Vorbehalt** | „Meldungen gekürzt“ (Kappung) · „*“ (nicht zertifiziert) |

- „Clear“ steht nur für eine fertige, ganze, zertifizierte Prüfung. Während der Prüfung heißt „noch keiner gefunden“ nie „Clear“, sondern „kein Kontakt bisher · 12 % geprüft“ (Codex R85, Hinweis 1).
- Die Kappung bekommt ein eigenes Kennzeichen im Ergebnis (`CollisionResult.capped`: Zahl der weggefallenen Einträge). Paket 2 macht sie dann überflüssig; bis dahin ist sie wenigstens gesagt.
- Schmal (`.sidePane.narrow`) bleiben Zeichen und Zahl; die Wörter stehen im Namen des Elements, wie heute.

### 1b · Der erste bestätigte Kontakt sofort

- **Bestätigt** heißt: ein Eintrag des laufenden Prüflaufs mit einem echten Kontakt (`dist` ≤ Kontaktgrenze), keine Annäherung. Die Meldung gehört zu Prüfauftrag, Spur und Version; ein Programm- oder Spurwechsel verwirft sie mit dem Auftrag (Codex R85, Hinweis 1).
- **Ohne Verfeinerung** (Codex R85, Hinweis 3): Der Worker schickt beim **ersten** Kontakt eines Prüflaufs sofort einen Teilstand. Er wartet weder auf die 500 ms noch auf die Taktbremse, und er ruft `buildResult` nicht auf. Danach gilt der heutige Takt.
- Die Marke steht an der entdeckenden Probe, höchstens eine Probe zu spät, wie heute; die Verfeinerung am Ende setzt sie an den ersten Kontakt.
- Was heute dort zwischen Fund und Anzeige liegt, misst das Paket zuerst (vorher/nachher getrennt): Zeit bis zur ersten Meldung, Gesamtkosten, Paarabfragen.

### 1c · Der Berechnungskontext in einer Detailkarte

Der Kontext kommt in eine Karte „Prüfgrundlage“ hinter einem Knopf in der Prüfzeile. Das ist das vorhandene Muster `DetailsPopover.vue` (D5, K06); es ist nicht noch mehr Text im „?“. Das „?“ bleibt kurz: was die Prüfung ist und wie weit sie kam. Inhalt der Karte, je eine Zeile:

- **Kinematik:** Identität / TCP / Ebene, mit der Drehachsenlage beim Prüfbeginn (A 61,3°).
- **Nullpunkt:** Fixture und Werte (G54 X −238,28 …), G92 wenn gesetzt.
- **Werkzeug:** Startwerkzeug mit Länge und Herkunft (Tabelle, bestätigt, angenommen), dazu die Programmwerkzeuge.
- **Start:** Anfahrbewegung von der Maschinenposition dabei oder nicht; im Lauf die Startbasis des Laufs.
- **Ausgenommen:**
  - jedes statische Paar je Zeile;
  - die Zahl der vorab ausgeschlossenen Paare (Reichweite);
  - offene oder unbrauchbare Körper.
- **Grenzkontakte** einer vorläufigen Prüfung: je Paar eine Zeile. Das ist Codex' Vorschlag aus R117, hier umgesetzt.

**Quelle ist die geprüfte Basis** (`CheckBasis`, `viewer/checkBasis.ts`), nie der Live-Status (Codex R85, Hinweis 2). Eine Prüfung, deren Basis nicht mehr der Zustand ist, sagt das in der Karte („Grundlage: der Stand bei Prüfbeginn“).

### 1d · „Startet im Kontakt“ nur, wo es bewiesen ist

Die Übersicht unterscheidet vier Fälle, die heute zusammenfallen oder gar nicht genannt werden:

| Fall | Heute | Neu |
|---|---|---|
| Paar in Ruhe **und** an der ersten Pose im Abstand | „N contacts at the start ignored“ | „N Paare schon in Ruhe im Kontakt — ausgenommen“, je Paar in der Karte |
| Paar in Ruhe frei, an der ersten Pose im Kontakt | Beginn auf der ersten Zeile | „Das Programm beginnt im Kontakt: A ↔ B“ |
| Kontakt nur auf der Anfahrbewegung | Eintrag „entry“ | „Anfahrt: Kollision“, getrennt vom Programm |
| Annäherung ohne Kontakt | Eintrag mit Abstand | bleibt Annäherung, nie „Kollision“ |

„Startet im Kontakt“ steht nur bei bewiesenem, nicht erlaubtem Startkontakt. Erlaubt ist bis Paket 3 nur, was die heutige Regel ausnimmt, und das sagt die Karte so.

### 1e · Geschwindigkeit, nur was die Messung trägt

Die Messung trägt in Paket 1 nur eine Änderung: den sofortigen ersten Teilstand (1b). 95,6 % der Zeit liegen in Abstandsabfragen bekannter Kontakte; die Buchführung um sie herum (Posen, Zertifikate, Zeilensätze) ist im Fall A der größere Teil, aber dort dauert die ganze Prüfung 9,4 s. Paket 1 baut deshalb keine weitere Beschleunigung. Wiederverwendung unveränderter Relativposen (Codex R84) bringt bei `haus.ngc` nichts, weil sich fast jede Pose ändert; sie wird nicht gebaut.

Ausdrücklich nicht in Paket 1: eine größere Schrittweite, eine Prüfung nur jeder n-ten Zeile, eine Annahme „bleibt im Kontakt“ ohne Zertifikat.

### Abnahme Paket 1

Codex' Belegliste aus R84 (D5) und R85:
- vollständige, gekappte, angehaltene, ausgenommene und veraltete Ergebnisse, je mit den drei Aussagen;
- während der Prüfung nie „Clear“; ein Programmwechsel verwirft die frühe Meldung;
- die Karte aus der geprüften Basis: Ein Status, der sich nach Prüfbeginn ändert, ändert die Karte nicht;
- Bedienung der Karte mit Touch und Tastatur (Popover-Regeln, Escape bleibt E-Stop);
- vorher/nachher getrennt gemessen: erste Meldung, Gesamtzeit, Abfragen je Paar, Speicher, Reaktion auf Anhalten und Abbrechen;
- dieselben Ereignisse und dieselbe Abdeckung vorher und nachher (Paket 1 ändert die Erkennung nicht): Orakeltest und `sweepShards.test.ts` unverändert grün.

Jede Regel mit einer Mutation rot.

## Paket 2 · Kontaktverläufe je Paar mit Vollständigkeitsvertrag (VP84-01)

### 2a · Das Modell

- **Je Paar** zusammenhängende Kontaktintervalle `[Eintritt, Austritt]` in Spur-Kumulativ, verfeinert wie heute. Dazu eine stabile Identität (Paar, laufende Nummer, Herkunft: Programm, Anfahrt oder Grenzkontakt), die Spur- und Programmversion und Rapid oder Vorschub beim Eintritt.
- **Zeilen sind Zuordnungen, keine Ereigniskennungen** (Codex R84). Ein Intervall überdeckt die Bewegungen, die es schneidet. Die Zeile einer Bewegung ist die, die der Bediener sieht (`displayLineForPoint`): In einer aufgerufenen Datei ist das die Aufrufzeile, nie die eigene Nummer der Datei (der Befund vom 9. Oktober).
- Die Fortsetzungseinträge je Zeile entfallen als Datensätze. Die Marke einer Zeile folgt daraus, dass ein Intervall eine ihrer Bewegungen überdeckt. Die Prüfung tastet einen Dauerkontakt weiter je Zeile ab, wo die Garantie es verlangt; das ist eine Sache der Abtastung, nicht der Speicherung.
- **Eine Ableitung für alle Ansichten:** Liste und Navigation (`clashTargets`), Färbung (`clashTint`), Zeitleistenbänder, Code-Marken (`collisionMarks`) und die Zähler der Übersicht lesen dasselbe Modell (Codex R84: Färbung und Code-Marken lesen heute andere Ableitungen).

### 2b · Vollständigkeit

- Keine stille Kappung, keine stille Zusammenfassung freier Lücken. Die 16-Cluster-Zusammenführung (`collision.ts:2108`) entfällt.
- Die Daten liegen blockweise in typisierten Feldern. Nur die sichtbare Liste ist begrenzt bzw. virtualisiert.
- Ist das Datenbudget erschöpft (eine feste Zahl Intervalle, mit Speicherschätzung im Plan der Umsetzung), wird das Ergebnis **ausdrücklich unvollständig ab** der Stelle (`incompleteFrom`). Die Prüfung hält dort an und sagt es. Sie fasst nie zusammen.
- Der Teilstand (`peek`) kopiert nur neue Intervalle (Anhängen). Fables Befund, dass der Peek bei vielen Einträgen teuer wird (gemessen am 7. Oktober: 663 ms bei 637 000 Einträgen), wird damit strukturell gelöst.

### 2c · Mitgenommen

- Der tote Zweig `continuation === 0` (`GcodePanel.vue`, Fable/R85).
- Die Spanne aus der `cumEnd` einer Annäherungs-Fortsetzung (Fable/R85).
- Die Zeile eines Kontaktbeginns aus dem verfeinerten Start, nicht aus der entdeckenden Probe: Im Pool lagen 6 von 85 Beginnen eine Zeile zu spät (R90).
- Die Befunde in aufgerufenen Dateien mit der Aufrufzeile (siehe oben).

### Abnahme Paket 2

Codex' Belegliste aus R84:
- 201 Beginne;
- 17 Intervalle auf einer Zeile;
- eine wiederholte Quellzeile (Schleife, Unterprogramm);
- ein langer Dauerkontakt;
- der Anfahr-Merge.

Alle Ansichten zeigen dieselben erhaltenen Ereignisse und dieselben unbekannten Bereiche.

Dazu:
- ein Befund in der M600-Routine nennt seine Aufrufzeile;
- ein erschöpftes Budget sagt „unvollständig ab“;
- das Orakel (`collisionOracle.test.ts`) und die Shard-Gleichheit gelten unverändert auf dem neuen Modell;
- die Gegenprobe gegen das alte Satzmodell auf den mitgelieferten Modellen: gleiche Kontaktmengen, wo das alte Modell nicht kappte.

## Paket 3 · Erklärte erlaubte Kontakte (VP84-02)

### 3a · Das Schema

`machine.json` bekommt `allowedContacts`: je Eintrag ein Paar, die Begründung und der gültige mechanische Bereich. Der Bereich ist je beteiligter Achse ein Fenster in Gelenkwerten (eine Führung über ihren Weg, ein Lager über seinen Drehbereich).

- Innerhalb des Bereichs ist der Kontakt erlaubt und wird nicht gemeldet. In der Prüfgrundlage steht er als erklärt.
- Außerhalb des Bereichs endet die Ausnahme. Ein Kontakt dort ist ein Befund eigener Art: „mechanischer Bereich verlassen“, etwa ein Wagen über das Ende seiner Schiene.
- **Endanschläge** sind eigene, prüfbare Körper, nie Teil einer Ausnahme.
- Eine Erklärung nimmt nur ihr Paar aus. Wagen/Schiene erklärt nimmt weder Wagen/Endkappe noch Wagen/Säule aus.

### 3b · Ohne Erklärung

- Ein Modell ohne `allowedContacts` behält die heutige Regel (Ruhe ∧ erste Pose). Die Prüfgrundlage sagt dann „N Paare automatisch ausgenommen (nicht erklärt)“. Das ist die Zusage des Operators vom 6. Oktober: Modellautoren bestätigen vorgeschlagene Kandidaten.
- Ein Skript listet je Modell die Paare, die die heutige Regel ausnimmt, als **Kandidaten** mit ihrem beobachteten Bereich. Der Autor erklärt; nichts wird automatisch übernommen (Codex R84: Stichproben sind keine Garantie).
- Die mitgelieferten Modelle (XYZAC, Portal, 3-Achs) bekommen ihre Erklärungen in diesem Paket; `machineModel.test.ts` und die Modelltests verlangen sie.

### Abnahme Paket 3

Codex' Belegliste aus R84:
- zulässiger Führungslauf: kein Befund;
- Überfahrt bei absichtlich zu weitem INI-Fenster: Befund „mechanischer Bereich verlassen“;
- Start im Kontakt;
- Einschluss;
- unabhängiger Kontakt zu einem dritten Körper: Befund trotz Erklärung des Paars.

## Reihenfolge und Runden

Die Messung ändert die Reihenfolge nicht, aber das Gewicht: Paket 1 ist klein (Wörter, Karte, sofortiger erster Teilstand, Kappung gesagt). Paket 2 ist wegen des Speichers (1,18 GB bei `haus.ngc`) der wichtigere Schritt und kommt direkt danach.

1. Paket 1 nach Einigung über diesen Plan; Umsetzungsrunde.
2. Paket 2 mit einem eigenen Detailplan des Datenmodells (Budget, Blockgröße, Ableitungen), weil es Sweep-Kern, Worker, Shard-Merge, Anfahr-Merge und vier Ansichten berührt; Planrunde, dann Umsetzungsrunde.
3. Paket 3; Planrunde für das Schema, dann Umsetzungsrunde.

## Nicht in diesem Plan

- GPU (Operator: vorerst außen vor).
- Teilung der Spur in parallel geprüfte Abschnitte (Schritt 5, ursprüngliche Idee): Sie bleibt hinter Paket 2, weil die Abschnittsgrenzen dieselbe Zustandsfrage stellen wie die Naht in R114.
- Ein **Kontaktzertifikat** für anhaltende Durchdringung (Codex R84: „bloßes `dist == 0` reicht nicht“). Es ist nach der Messung die eigentliche Beschleunigung für Dauerkontakte (99,9 % der Abfragezeit bei `haus.ngc`). Ein Kandidat mit vorhandenen Mitteln: Ein Eckpunkt von A liegt im geschlossenen Körper B, mit Abstand d zu dessen Oberfläche (Strahltest und Abstand wie in der Innenprüfung). Dann bleiben A und B im Kontakt, bis sich dieser Punkt relativ um mehr als d bewegt hat, also mindestens d/V. Das ist ein Zeugnis für „noch im Kontakt“, kein Maß der Eindringtiefe. Es braucht einen eigenen Plan mit Orakel, nach Paket 2 (ohne Einträge je Zeile braucht ein bekannter Kontakt keine Probe je Zeile mehr).
- Die Browser-Seite des Messprotokolls auf einem getrennten Browser-PC: offen, braucht den Mac des Operators.

## Fragen an Codex

1. Reicht für 1b „erster Kontakt sofort, ohne `buildResult`“, oder braucht die frühe Meldung eine eigene Bestätigung (eine zweite Probe), damit sie nicht an einer Probe hängt, die die Verfeinerung später verschiebt?
2. Ist die Detailkarte (`DetailsPopover`) statt eines längeren „?“ der richtige Ort für den Kontext und die Liste je Paar?
3. Paket 2: Ist „unvollständig ab und anhalten“ bei erschöpftem Budget der richtige Vertrag, oder soll die Prüfung weiterlaufen und nur die Speicherung enden (Ergebnis vollständig, Liste unvollständig)?
4. Paket 3: Reicht ein Fenster je Gelenk als Gültigkeitsbereich, oder braucht eine Führung einen Bereich in der Relativlage der beiden Körper?
