# Kollisionsprüfung Schritt 4, Paket 2 — Kontaktverläufe je Paar (Detailplan)

**Fassung 5 · 12. Oktober 2026 · Zweig `feat/step4-p2`, angelegt von `feat/step4-p1` (Paket 1 abgenommen in R139, gemergt) · Merge nach `development` über den Integrationszweig, nie `main`.**

Dieser Plan ist der Detailplan, den `kollision-schritt4.plan.md` für Paket 2 ankündigt („Budget, Blockgröße, Ableitungen“). Er beantwortet die Vorgaben aus Codex R84 (VP84-01), R85 und R118 (Antwort auf Frage 3). Gebaut wird erst nach Einigung über diesen Plan.

Fassung 1 hat Codex in R139 in der Architektur angenommen: Kontaktverläufe statt Sätzen je Zeile, typisierte Blöcke, ein Ableitungsmodul, ein Listenfenster, Anhalten mit benannter Restabdeckung, zwei Umsetzungsrunden. Fassung 2 klärt die fünf Befunde VP139-01 bis VP139-05 und nimmt die drei Umsetzungshinweise auf. Neu gefasst sind 1.1, 1.2, 1.4, 2.1–2.4, 3.1, 3.2, 3.4, 3.5 (neu), 4.2, 4.4, 4.5, 5, 7 und 8. Die Antworten stehen am Ende.

Fassung 2 hat Codex in R140 für VP139-01, -02 und -05 angenommen. Fassung 3 schließt die Reste von VP139-03 (Ableitungen beider Generationen) und VP139-04 (Belege über den Rückfall) und übernimmt die Antworten auf die zwei Fragen. Geändert sind 1.1, 1.4, 2.2, 3.4, 3.5, 4.3, 7.3, 7.4 und 7.5. Die Antworten auf R140 stehen am Ende.

Fassung 3 hat Codex in R141 für VP139-03 angenommen, mit einer Zahlenkorrektur. Fassung 4 schließt die beiden Reste von VP139-04: Eine freie Probe beweist nur ihre eigene Umgebung (A), und ein geteiltes Ereignis vergibt seine Anzeige-ID nur einmal (B). Geändert sind 1.4, 2.2, 3.4, 3.5, 4.3 und 7.5. Die Antworten auf R141 stehen am Ende.

Fassung 4 hat Codex in R142 für VP139-04 A angenommen und bei B die einmalige ID-Vergabe. Offen blieb der Anker: Eine verfeinerte Grenze kann auf einer unentscheidbaren Antwort liegen und ist dann kein bestätigter Kontakt. Fassung 5 trennt verfeinerte Grenze und **Zeugen** und nimmt die beiden Umsetzungsbedingungen auf. Geändert sind 1.4, 2.2, 3.4, 3.5 und 7.5. Die Antworten auf R142 stehen am Ende.

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

### 1.1 Episode, Berührungsintervall, Wissenslücke

Eine **Episode** ist ein Aufenthalt eines Paars im Rand: von der Probe, die den Eintritt entdeckt, bis zur letzten Probe im Rand vor der bestätigten Trennung (`d > 2·margin`, wie heute in `noteQuery`). Damit überdeckt sie dieselbe Strecke wie heute die Sätze eines Aufenthalts. Sie trägt:
- die Herkunft: Programm, Anfahrt, startabhängiger Anfang oder Grenzkontakt eines Bereichs-Checks;
- die Art beim Eintritt: Eilgang oder Vorschub (die Schneidregel liest sie wie heute);
- die nächste Annäherung (Stelle und Abstand) über die **ganze** Episode;
- die Kennzeichen `atStart`, `boundary`, `possible` und „offen“;
- ihre Berührungsintervalle.

Ein **Berührungsintervall** ist ein Stück der Episode, in dem das Paar **nachweislich** berührt (`d ≤ CONTACT_EPS`) oder ineinander liegt (Innenprüfung „innen“). Es hat Eintritt und Austritt, jeweils verfeinert, und das Kennzeichen „möglich“ (Bremsbereich).
- Eine Episode ohne Berührungsintervall ist eine **Beinahe-Kollision**.
- Eine Episode mit Berührungsintervallen ist eine **Kollision**. Ihr erstes Intervall ist der Beginn, jedes weitere ein Wiedereintritt.

Eine **Wissenslücke** ist eine Strecke, über die der Sweep für ein Paar nichts weiß, mit ihrem Grund (VP139-01):
- `undecidable`: Die Innenprüfung kann nicht entscheiden (heute `undecSpans`).
- `toolUnknown`: Ein Programmwerkzeug ohne Länge ist in der Spindel; die Werkzeugpaare werden dort nicht geprüft.

**Drei Regeln, getrennt:**
1. **Entdeckung.** Nur eine bestätigte Berührung oder Innenlage öffnet ein Intervall. Eine unentscheidbare Antwort öffnet nichts, trennt nichts und gibt kein Freiraumzertifikat (wie heute, `collision.ts` 1756–1763). Sie öffnet oder verlängert eine Wissenslücke des Paars.
2. **Verfeinerung.** Beim Bisektieren einer schon entdeckten Grenze zählt „unentscheidbar“ wie heute zur Kontaktseite (`contactAtDist`), und die Stelle wird als Lücke benannt.
3. **Lücke an einem bekannten Intervall.** Trifft ein offenes Intervall auf eine Lücke, wird es **ausgesetzt**. Sein Austritt bleibt unbekannt; es wird kein Austritt erfunden. Die Lücke steht mit ihrem Grund daneben.
   - Folgt nach der Lücke wieder eine bestätigte Berührung ohne nachgewiesene Trennung dazwischen, **läuft dasselbe Intervall weiter**: ein Ziel, kein Wiedereintritt, mit der Lücke darin.
   - Liegt eine nachgewiesene Trennung dazwischen (eine Probe mit `d > CONTACT_EPS` und entschiedener Innenprüfung „außen“), beginnt ein neues Intervall.
   - **`toolUnknown`** (Codex R140, Antwort 1): Nach der Strecke steht wieder eine bekannte Werkzeuggeometrie, also eine neue Prüfgrundlage für die Werkzeugpaare. Der Kontakt davor setzt sich nicht über diese Grenze fort; sein Intervall endet „an der Lücke“, ohne Austritt. Ein Kontakt danach ist ein eigenes Ziel, **„Beginn nach unbekanntem Werkzeug“, kein geometrischer Wiedereintritt**.

**Anzeige.** Eine Lücke zählt nirgends, färbt nicht und hat kein Band. Sie steht im „?“ und in den Notizen, etwa „inside check undecidable for A ↔ B (L5–L9)“ oder „tool without a length (L12–L40)“, und hält das Ergebnis unzertifiziert wie heute. Ein ausgesetztes Intervall wird bis zum Lückenbeginn gefärbt und markiert, nicht durch die Lücke hindurch.

Die Zustandsmaschine des Sweeps bleibt, wie sie ist: `noteQuery`, Trennung bei `2·margin`, Schneidpaare, Bremsbereich, Innenprüfung, unbekanntes Werkzeug, Grenzkontakte, Wiederabtastung bei MIN_ADV (R86–R88). Geändert wird, **wohin** sie schreibt, nicht **wann** sie etwas erkennt.

### 1.2 Identität

- Die Identität einer Tabellenzeile ist `(Auftrag, Generation, Herkunft, Paar, laufende Nummer der Episode je Paar und Herkunft, Nummer des Intervalls in der Episode)`.
- Der **Auftragskopf** führt Herkunft, Spur- und Programmversion und die Prüfgrundlage. Er gilt für jede Aktualisierung des Auftrags; eine Aktualisierung ohne passenden Kopf wird verworfen.
- Die **Generation** zählt die Läufe desselben Auftrags. Ein Pool-Rückfall beginnt eine neue.
- Innerhalb einer Generation ist die Identität stabil: über alle Teilstände, über das Schließen offener Enden und über das Aussetzen an Lücken. Die Paare der Shards sind disjunkt, die Nummern also auch im Pool eindeutig.
- **Über einen Rückfall ist die Tabellenidentität nicht stabil.** Die Abtaststellen hängen von der Shard-Zusammensetzung ab (R90). Ein Ereignis schmaler als MIN_ADV kann im einen Lauf erscheinen und im anderen nicht; dann verschieben sich die Nummern. Die stabile Identität für die Anzeige führt deshalb der Viewer selbst, getrennt vom Tabellenindex (3.5).

### 1.3 Zeilen sind Zuordnungen

Keine Zeile wird gespeichert. Die Zeile eines Ereignisses ergibt sich aus der Spur an der Stelle, die es benennt:
- beim Intervall der verfeinerte Eintritt;
- bei der Beinahe-Kollision die nächste Annäherung.

Es zählt `displayLineForPoint`:
- In einer aufgerufenen Datei ist es die Aufrufzeile, nie die eigene Nummer der Datei.
- Liefert die Funktion **keine** Zeile (nicht vertrauenswürdig und ohne Aufrufzeile), zeigt das Ereignis den Namen des Unterprogramms, wenn einer bekannt ist, sonst „—“. Es setzt keine Code-Marke, und sein „?“ sagt warum. Auf die rohe Zeile wird nie zurückgegriffen.
- Weil die Zeile aus dem verfeinerten Eintritt kommt, entfällt der R90/R91-Versatz (siehe 2.2).

### 1.4 Speicher: Blöcke typisierter Felder

Drei Tabellen in Spalten (SoA), in Blöcken zu 4096 Zeilen. Ein Block wird angehängt, nie umkopiert.

| Tabelle | Spalten | Bytes je Zeile |
|---|---|---|
| Episode | Paar u32, Nummer u32, Kennzeichen u16, Eintritt f64, Ende f64 (letzte Probe im Rand; NaN = offen), nächste Stelle f64, nächster Abstand f32, erstes Intervall u32, Zahl der Intervalle u32 | 46 |
| Intervall | Episode u32, Eintritt f64, Austritt f64 (NaN = offen oder ausgesetzt), Kennzeichen u8 (möglich, ausgesetzt, nach Lücke, nach unbekanntem Werkzeug, Eintritt entschieden, Austritt entschieden), nächstes Intervall derselben Episode u32, **Zeuge** f64 (die entdeckende bestätigte Berührungsprobe, 2.2), freie Probe danach f64 und ihr Freiradius f32 (der Trennbeleg nach dem Austritt; NaN = keiner) | 45 |
| Lücke | Paar u32, Beginn f64, Ende f64 (NaN = offen), Grund u8 | 21 |

Die Intervalle verschachtelter Paare liegen nicht zusammenhängend (A1, B1, A2). Jede Episode verkettet ihre Intervalle deshalb über „nächstes Intervall“ (Hinweis a); die vier Bytes stehen im Budget.

**Budget je Anfrage**, über alle Shards zusammen: 65 536 Episoden, 262 144 Intervalle und 16 384 Lücken. Das sind 3,0 + 11,8 + 0,3 MB = 15,2 MB Tabellen. Dazu kommen je Zeile ein Byte Änderungsmerker (0,3 MB) und je Shard und Tabelle höchstens ein angefangener Block samt seiner Merker (bei K ≤ 8 höchstens 3,8 MB). Zusammen sind das **T = 19,3 MB je Halter**.

Zum Vergleich: 84 Beginne bei `haus.ngc`, 201 in Codex' synthetischem Fall R84. Das Budget wird nur von einem Programm erreicht, das ein Paar zehntausendfach in den Rand und wieder heraus führt.

## 2 · Der Sweep-Kern

### 2.1 Schreiben statt Sätze

Der Sweep schreibt über eine **Senke** mit diesen Ereignissen:
- Episode beginnt, Episode endet;
- Berührung beginnt, Berührung endet;
- Intervall ausgesetzt, Intervall läuft nach der Lücke weiter;
- Lücke beginnt, Lücke endet.

Dazu kommt die laufende nächste Annäherung einer offenen Episode. `worst`, `samples`, `carriedFrom`, die Cluster und `CLUSTER_GAP` entfallen in der neuen Senke.

### 2.2 Verfeinerung beim Übergang

Jede Grenze einer **Berührung** wird verfeinert, sobald sie erkannt ist, nicht erst am Ende für 200 ausgewählte Sätze:
- **Eintritt einer Berührung:** Bisektion zwischen der letzten Stelle, die als nicht berührend ausgewiesen ist, und der entdeckenden Probe. Es gelten die heutigen Mittel (`distAtCum`, `bisectBoundary`, 1e-3), „unentscheidbar“ nach Regel 2 in 1.1.
- **Austritt:** Bisektion zwischen der letzten berührenden und der ersten nicht berührenden Probe, nach der heutigen Wiederabtastung bei MIN_ADV (R86).
- **Keine Zeilengrenze als Boden.** Der Eintritt darf vor der Zeile der entdeckenden Probe liegen. Die Zeile folgt aus ihm (1.3); das ist der Punkt aus 2c von Schritt 4.
- **Entschiedene und vorsichtige Grenzen.** Endet die Bisektion einer Grenze auf ihrer Kontaktseite mit einer entschiedenen Berührung oder Innenlage, ist die Grenze **entschieden** (Kennzeichen). Liegt dort eine unentscheidbare Antwort, bleibt die Grenze die heutige vorsichtige Grenze mit benannter Lücke, ist aber **kein positiver Beleg** (Codex R142; `collisionInside.test.ts`, „met only by the refinement“: wahrer Beginn bei 19,5, verfeinerter unter 19).
- **Der Zeuge.** Jedes Intervall wird nur durch eine bestätigte Berührung oder Innenlage geöffnet (1.1, Regel 1). Diese entdeckende Probe ist sein Zeuge: ein entschiedener Kontaktort, den kein Freiraum enthalten kann. Sie wird mit dem Intervall gespeichert.
- **Der Eintritt in den Rand wird nicht verfeinert,** wie heute. Er bleibt die entdeckende Probe, und die Art der Episode (Eilgang oder Vorschub) bleibt die Art ihres Segments, wie `noteQuery` sie heute bestimmt. Ein verfeinerter Randeintritt könnte in ein Segment anderer Art zurückfallen und die Schneidregel umkehren (Vorschub = Bearbeitung, Eilgang = Fehler).

**Kein Zusammenführen** (VP139-02). Jeder Übergang wird genau einmal bisektiert, also gibt es nichts numerisch Doppeltes zusammenzufassen.
- `mergeContiguousIntervals` hat in der neuen Senke keine Aufgabe.
- Eine nachgewiesene nicht berührende Probe zwischen zwei Intervallen gehört zur Ereignisidentität; die beiden bleiben getrennt, auch wenn die Lücke unter 2e-3 liegt.
- **Der Trennbeleg** ist die erste nicht berührende, entschiedene Probe nach einem Austritt. Er steht am **endenden** Intervall (`freie Probe danach`) und geht mit dessen Austritt in dasselbe Delta. Er ist also übertragbar, bevor ein nächstes Intervall existiert: im Teilstand, am Ende und beim Rückfall direkt nach der Trennung (Codex R141).
- **Sein Freiradius** ist r = (d − CONTACT_EPS) / V, mit d dem gemessenen Abstand und V der Schranke des Paars im Abschnitt der Probe. Aus der Schranke folgt d(q) ≥ d(p) − V·|q − p|, also kann im **offenen** Bereich (p − r, p + r) keine Berührung liegen, in beide Richtungen. Am Rand darf genau CONTACT_EPS erreicht sein, was laut Vertrag noch Berührung ist; deshalb sind die Ränder offen (Codex R142).
  - Der Bereich wird auf den Abschnitt der Probe geschnitten, wo V gilt; bei V = 0 ist es der ganze Abschnitt.
  - Gespeichert wird r als f32 **nach innen gerundet**: Ist `Math.fround(r) > r`, wird der nächstkleinere f32-Wert genommen. Die Speicherung vergrößert den bewiesenen Bereich nie.
  - Auch keine Innenlage: Ein Körper gelangt nicht ins Innere eines anderen, ohne dass sich die Oberflächen berühren. Das ist dasselbe Zertifikat, auf dem die Lückenlosigkeit des Sweeps beruht, hier rückwärts gelesen. Es beweist die Umgebung der Probe, nicht die Spanne zwischen zwei gefundenen Kontakten.
- Eine **unbeprobte** Lücke zwischen zwei berührenden Proben ist dagegen keine Trennung. Sie gilt wie heute als Kontakt.

**Pose und Zeit** (Hinweis c).
- Die Bisektion stellt das Modell auf andere Parameter. Danach stellt der Sweep seine Pose wieder her, bevor er das nächste Paar fragt; das ist die Regel aus TWP-07 für Snapshot-Proben.
- Kosten: etwa 30 Abfragen eines Paars je Grenze. Die Erstmeldung kommt damit nach der Verfeinerung ihres Eintritts, nicht mehr an der entdeckenden Probe. Diese Verzögerung wird gemessen und genannt, ebenso die Antwortzeit auf Anhalten und Abbruch (7.5). „Sofort“ heißt dann: nach der Probe und der Bisektion dieses einen Paars.
- Im ungünstigsten Fall begrenzt das Budget die Zahl der Grenzen und damit die Kosten.

Weil die Grenzen beim Schreiben schon verfeinert sind, gibt es keine späteren Verfeinerungen. Eine Zeile ändert sich nach dem Schreiben nur noch, wenn ein offenes Ende sich schließt, ein Intervall ausgesetzt wird oder weiterläuft, oder die nächste Annäherung einer offenen Episode besser wird.

### 2.3 Sonderfälle, unverändert in der Bedeutung

- **Schneidpaar:** Ein im Vorschub begonnener Kontakt schreibt nichts, ein im Eilgang begonnener eine Episode. Der Eilgang nach einem Vorschubkontakt folgt der heutigen Regel (R87/R88).
- **Bremsbereich** (`possible`): Ein Intervall, dessen Proben alle im Bereich liegen, ist „möglich“; eine sichere Probe macht es sicher. Ein mögliches Intervall öffnet keine Wiedereintritts-Regel (R126).
- **Grenzkontakt** eines Bereichs-Checks: eine Episode der Herkunft „Grenze“, offen ab dem Bereichsbeginn. Sie zählt nirgends und endet mit einer bestätigten Trennung; ein Eintritt danach ist ein eigener Befund, wie heute.
- **`atStart`:** Eine Episode, die an der ersten Pose schon berührt, beginnt bei cum 0 mit dem Kennzeichen.
- **Unbekanntes Werkzeug und unentscheidbare Innenprüfung:** Wissenslücken nach 1.1.

### 2.4 Budget und „unvollständig ab“

Ist eine Tabelle voll, die Lücken eingeschlossen, hält der Sweep an der Stelle an, an der er das nächste Ereignis schreiben müsste:
- Das Ergebnis trägt `incompleteFrom` (Spur-cum) und `truncated.reason = "budget"`.
- Offene Episoden und Intervalle bleiben offen; es gibt keinen erfundenen Austritt.
- Die Übersicht sagt „nicht geprüft ab L…“, wie heute beim Abbruch nach der Probenzahl (`truncated.reason = "samples"`).
- Liste und Navigation erreichen weiter jedes gespeicherte Ziel.

**Teilbudgets.** Im Pool bekommt jeder Shard ein festes Teilbudget (1/K); Codex hat das in R139 angenommen. `incompleteFrom` und die Abdeckung des Pools sind das Minimum über die Shards. Ein einzelner voller Shard macht die Gesamtprüfung ausdrücklich unvollständig. Die Seitenläufe (Anfahrt, startabhängiger Anfang) haben ein eigenes Budget von T/8 mit derselben Regel.

## 3 · Transport, Shards und Merges

### 3.1 Teilstände: Anhänge, zusammengefasste Aktualisierungen, Bestätigung

`peek` liefert ein **Delta**:
- die Zeilen seit dem letzten gesendeten Delta;
- die Zeilen, die sich seitdem geändert haben: ein geschlossenes Ende, ein ausgesetztes oder weiterlaufendes Intervall, eine bessere nächste Annäherung einer offenen Episode.

Eine geänderte Zeile trägt einen Änderungsmerker und wird **einmal** mit ihrem neuesten Stand gesendet, wie oft sie sich auch geändert hat.

**Höchstens ein unbestätigtes Delta je Transportweg** (VP139-03).
- Der Sender schickt das nächste Delta erst, wenn der Empfänger das vorige angewendet und bestätigt hat. Bis dahin sammeln sich Änderungen nur als Merker in der eigenen Tabelle, nicht als Puffer.
- Ein langsamer Empfänger erzeugt keine Warteschlange. Die Rechnung aus R139 (1000 wartende Aktualisierungen eines Blocks von 4096 Episoden, 188 MB) wird dann zu einem einzigen Delta von höchstens einer Tabelle.
- Jedes Delta trägt Auftrag und Generation. Ein Delta einer älteren Generation wird verworfen.
- Die Felder gehen als übertragbare Puffer an `postMessage`.

**Das Endergebnis** ist das letzte Delta mit dem Kennzeichen „fertig“ und den Metadaten: Abdeckung, Notizen, statische Kontakte, `incompleteFrom`. Es bezieht sich auf denselben Tabellenstand und erzeugt keine Vollkopie.

Die Erstmeldung aus Paket 1 (1b) ist ein sofortiges Delta, sobald das erste Berührungsintervall geschrieben ist (mit der Verzögerung aus 2.2). Eine eigene Nachrichtenart `first` braucht es dann nicht mehr.

### 3.2 Shards

- Der Koordinator führt je Shard eine Tabelle, wendet deren Deltas an und bestätigt sie. An den Viewer schickt er ein zusammengefasstes Delta, wieder höchstens eines unbestätigt.
- **Er baut keinen zusammengeführten Teilstand mehr aus älteren Worten der Shards.** Daher kamen VP-I91 und VP-I92: Ein zusammengeführter Teilstand ersetzte, was schon gezeigt war. Der Viewer wendet nur noch Deltas an; was gezeigt ist, geht nicht zurück.
- Die Tabellen des Koordinators bleiben für die Übergabe bei einem Rückfall (VP-I48/I49): Ein angehaltener Lauf wird mit seinem Stand übergeben.
- Statische Kontakte und die Zahl der vorab ausgeschlossenen Paare kommen wie heute von Shard 0. Die Notizen werden vereinigt (`unitedNotes`); ihre Länge folgt aus den Lücken und Paaren und ist damit begrenzt.

### 3.3 Anfahrt und startabhängiger Anfang

**Anfahrt** (`mergeEntryResult`):
- Die Episoden der Anfahrt kommen mit der Herkunft „Anfahrt“ hinzu, um die Länge der Anfahrt verschoben.
- Ein Kontakt, den beide Läufe sehen, zählt einmal. Das ist eine offene Anfahrt-Episode mit einem Intervall bis zum Ende der Anfahrt, und eine Programm-Episode desselben Paars, die bei cum 0 im Kontakt beginnt. Ihr **erstes** Intervall wird Fortsetzung des Anfahrt-Intervalls; spätere Intervalle bleiben Wiedereintritte des Programms (R34 VP-I09).
- Der tote Zweig `continuation === 0` (GcodePanel, R85) entfällt mit dem Feld.

**Startabhängiger Anfang** (`mergeBeginningOntoBase`): Die Episoden des Anfangs kommen auf die Basisachse, mit `max(0, c − shift)` wie heute. Das bleibt eine benannte Grenze der Anzeige.

### 3.4 Halter und ihr Budget

T = 19,3 MB nach 1.4; S = T/8 = 2,4 MB für die Seitenläufe.

| Halter | Inhalt | Obergrenze |
|---|---|---|
| Sweep je Shard | eigene Tabellen (Teilbudget) | Σ ≤ T |
| Shards → Koordinator | je Shard höchstens ein unbestätigtes Delta, jedes ≤ seine Tabellen | Σ ≤ T |
| Koordinator | Tabellen je Shard | ≤ T |
| Koordinator → Viewer | höchstens ein unbestätigtes Delta | ≤ T |
| Viewer, aktuelle Generation | Tabellen des Auftrags | ≤ T |
| Viewer, gehaltene Generation | die Belege der vorigen Generation (3.5) | ≤ T |
| Viewer, Ableitungen über **beide** Generationen von Auftrag und Seitenlauf, nach einem Rückfall als Vereinigung (der Seitenlauf mit einem Achtel; hergeleitet nach Codex R152 VP-I112, `derivationBound` neben `heldBytes`) | Ziele und Hilfsintervalle, 4,25 B je Stück und Beinahe-Kollision — Stücke ≤ 2·(I₀+I₁) + 4·(G₀+G₁) (Eintritt, Freiraumende, Zonenanfang), Beinahe-Kollisionen ≤ E₀+E₁: 6,27 MB · Episoden nach Beginn: 0,63 MB · Gruppenindex u32 je Intervall: 2,36 MB · nach Codex R158 (VP-I115 Rest B) das Komponentenende je Intervall, das der Gang schreibt, u32 je Intervall beider Generationen: 2,36 MB (das angenommene u32 je Intervall; die nächste freie Probe über einen Blockindex) · zwei Blockindizes (nächste freie Probe, nächstes nicht nur mögliches Intervall), 4 B je 64 Positionen und Generation: 0,07 MB · Lückenindex 20 B je Lücke (Zeile, weitestes Ende des Paars, nächste Werkzeuglücke, letztes Glied der berührenden Lücken): 0,74 MB · Episodenindex 4 B je Episode (ein Schlüssel findet sein Ereignis): 0,59 MB · Trenner 8 B: 0,29 MB · Zuordnung der Beinahe-Kollisionen, 12 B (mit der Ordnung nach der früheren): 0,88 MB · Joins: 0,33 MB — `ContactView` ≤ 14,52 MB (R152: 10,91 MB). Dazu die gehaltenen Zeitleisten-Bänder (`clashBands`): höchstens 8192 Spalten, zusammenhängende zusammengefasst, also höchstens 4096 Bänder, 65 536 B Zahlen-Nutzdaten (Codex R153; JavaScript-Array- und Heap-Overhead getrennt gemessen); nicht gehalten wird die unbegrenzt genaue geometrische Vereinigung. Die zuerst vereinbarten 8,4 MB kannten keine Teilung durch Freiräume, keine Lücken, keine Trenner und keine Zuordnung. | ≤ 14,59 MB |
| Seitenläufe | dieselben sechs Halter mit Budget S | ≤ 6 · S = 14,5 MB |
| **Summe im ungünstigsten Fall** | | **etwa 145,2 MB** (bis R152: 139 MB mit 8,4 MB Ableitungen; R153: 10,91 MB Kontaktansicht + 0,066 MB Bänder → 141,6 MB; R158: 14,52 MB Kontaktansicht + 0,066 MB Bänder) |

**Nicht materialisiert** (VP139-03), damit die Ableitungen begrenzt bleiben:
- die Vereinigung der Berührungen für die Bänder: Sie wird in Anzeigeauflösung berechnet (4.3);
- die Code-Marken: Sie werden nur für sichtbare Zeilen abgefragt (4.2).

Lückenstücke, also ein Kontakt `[0,10]` mit Lücke `[4,6]` als zwei Bandstücke, entstehen damit nur in dieser begrenzten Darstellung.

**Außerhalb der Zusage, getrennt gemessen und berichtet:** der Index der Anzeigezeilen (je Spur, abhängig von der Zahl der Spurpunkte, wie heute `lineIndex.ts`) und der Zustand je Paar im Sweep (je Modell, wie heute).

Im üblichen Fall ist die Summe ein Bruchteil davon. Berichtet werden dann die tatsächlich **belegten Puffer** samt der 4096er-Blöcke, nicht nur die Nutzbytes; bei `haus.ngc` mit 84 Beginnen liegen sie im Bereich eines MB je Halter. Heute stehen bei Fall B 1176 MB in einem einzigen Halter, und zwar unbegrenzt.

Im Viewer entsteht kein Objekt je Ereignis. Objekte gibt es nur für das sichtbare Fenster der Liste (4.4).

Gemessen werden **Datenbudget und Heap getrennt**: die Summe der Tabellen, Deltas und Ableitungen je Halter, und der Heap des Prozesses (7.4).

### 3.5 Rückfall: alle Belege bleiben (VP139-04)

Bei einem Pool-Rückfall rechnet der lokale Lauf als neue Generation neu, auf derselben Prüfgrundlage. Für die Anzeige gilt:

**Drei Arten Wissen** (Codex R141). Je Paar und Herkunft, aus jeder Generation:
- **bestätigte Kontaktorte:** der Zeuge jedes Intervalls und seine **entschiedenen** Grenzen (2.2);
- **nur angenommener Kontakt:** das Innere eines Intervalls zwischen berührenden Proben (die unbeprobte Lücke aus 2.2) und eine vorsichtige Grenze auf einer unentscheidbaren Antwort samt der Strecke bis zum Zeugen;
- **bewiesener Freiraum:** die offene Strecke (p − r, p + r) um jede freie Probe nach 2.2 (redaktionell nach R143: die Ränder sind offen).

Die verfeinerten Grenzen eines Laufs sind **kein** Freiraumzertifikat für die Spanne zwischen zwei Kontakten. Dort kann ein schmaler Kontakt liegen, den dieser Lauf übersprungen hat.

**Gezeigt wird** je Paar die Vereinigung der Intervalle beider Generationen, **minus** die bewiesenen Freiräume beider Generationen.
- Ein Freiraum kann einen bestätigten Kontaktort nicht enthalten, denn dieselbe Geometrie kann an derselben Stelle nicht zugleich frei und berührend sein. Bei einem numerischen Konflikt innerhalb der Verfeinerungstoleranz (1e-3) gewinnt der bestätigte Kontaktort. Der Freiraum schneidet also nur angenommenen Kontakt, auch eine vorsichtige Grenze auf einer unentscheidbaren Antwort.
- **Codex' R142-Folge:** Kontakte [0; 0,5] und [2, 3], unentscheidbare Innenantwort auf [1; 1,9]. Der alte Eintritt wird bei 1,00037 auf unentscheidbar verfeinert; die neue freie Probe bei 0,875 beweist das Innere von [0,5; 1,25] als frei. Der Freiraum schneidet die vorsichtige Grenze weg. Das Intervall bleibt ab 1,25 mit seinem Zeugen bei 2,5 bestehen, als dasselbe Ereignis mit derselben ID.
- **Codex' R140-Folge:** Pool A = [0, 1] und B = [1,001; 2], frei bei 1,0005; lokal C = [0, 2]. Der Freiraum um 1,0005 schneidet das angenommene Innere von C. Gezeigt werden zwei Stücke, getrennt an der freien Stelle.
- **Codex' R141-Folge:** gehalten [0, 1], [1,4; 1,6] mit Berührung bei 1,5, und [2, 3]; neu [0, 1] und [2, 3] mit freien Proben bei 1,125, 1,375, 1,625 und 1,875. Deren Freiräume reichen nur so weit, wie der Abstand dort trägt. Sie erreichen die bestätigten Orte bei 1,4 bis 1,6 nicht, also bleibt der schmale Kontakt in allen Ansichten.
- **Umgekehrt** wird ein altes, grobes Intervall genauer, wenn die neue Generation in seinem angenommenen Inneren Freiraum nachweist.
- **Erreichen ist kein Widerlegen.** Ein bestätigtes Intervall verschwindet nie, weil eine andere Generation die Stelle ohne Treffer überholt.
- „Möglich“ und „sicher“: Wo beide Generationen eine Stelle haben, gilt „sicher“. Ein offenes Intervall mit späterem Ende in der anderen Generation verlängert sich durch die Vereinigung.

**Ereignisse und Anzeige-Identität** (Rest B).
- Jedes Stück nach dem Schneiden ist ein Ereignis. Getrennte alte Ereignisse sind durch Freiraum getrennt, deshalb überdeckt ein Stück höchstens ein altes Ereignis. Überdeckt ein neues grobes Intervall mehrere alte, trennt der Freiraum der alten Generation die Stücke, und jedes behält die Identität seines alten Ereignisses.
- **Teilt sich ein altes Ereignis** (Freiraum der neuen Generation in seinem Inneren), behält **genau ein** Stück dessen Anzeige-ID: das Stück, das den **Zeugen** des Beginns des alten Ereignisses enthält. Der Zeuge ist ein bestätigter Kontaktort und wird nie weggeschnitten; anders als die verfeinerte Grenze, die auf einer unentscheidbaren Antwort liegen kann (Codex R142). Der Navigationspunkt bleibt die verfeinerte Grenze des Stücks, entschieden oder vorsichtig; nur die ID-Übernahme hängt am Zeugen. Jedes weitere Stück bekommt eine **neue** ID.
- **Stückschlüssel.** Ein Stück hat nicht automatisch eine eigene Tabellenzeile. Seine neue ID wird an einen Schlüssel gebunden: die Ursprungszeile (Generation, Herkunft, Paar, Nummern) und der Trennbeleg, der das Stück links begrenzt (dessen Zeilenidentität), bzw. „Beginn“ für das erste Stück. Mehrere Schnitte derselben Zeile ergeben so verschiedene Schlüssel. Ein späteres Delta, das diese Belege nicht ändert, ändert die IDs nicht (Codex R142, Bedingung 2).
- **Auswahl und Fokus** folgen der ID: Ein gewähltes Ereignis, das sich teilt, bleibt am Stück mit dem Zeugen gewählt. Die neuen Stücke reihen sich in die Navigation ein und sind per ‹ › je genau einmal erreichbar.
- Beinahe-Episoden werden nach Herkunft, Paar und Überdeckung ihrer Spanne eins zu eins in Stellen-Reihenfolge zugeordnet. Eine nicht wiedergefundene alte bleibt, „aus dem früheren Lauf“.

**Weiter gilt:**
- Nachrichten einer älteren Generation werden nach dem Wechsel verworfen.
- Ein neuer Auftrag mit anderer Grundlage trennt wie heute: Er übernimmt keine Belege.
- Startabhängiger Anfang: Seine Zeilen werden mit `max(0, c − shift)` abgebildet und behalten Herkunft und Nummer. Mehrere Ereignisse bei 0 bleiben getrennt und werden nie über die Stelle zusammengelegt.

Der gehaltene erste Kontakt aus Paket 1 (`_colFirstHeld`, `withFirstContact`, `holdsFirst`) wird ein Sonderfall dieser Regel und entfällt als eigener Code. Die gehaltenen Belege und die ID-Zuordnung stehen im Budget (3.4).

### 3.6 Aufbau in Schritten: zwei Tabellenfassungen (Form 1; Codex R152, R154, R155 — Fassung 2)

**Warum.** Nach dem Listenfenster (4.4, R154) hält die Seite noch lange Aufgaben, gemessen im Browser in Budgetgröße (262 144 Ziele): Ankunft 0,29–0,46 s, nach einem Rückfall bis 1,24 s. In Node, Budget, Vereinigung:

| Phase | Kosten |
|---|---:|
| Aufbau | 330–570 ms |
| Bänder | 250–410 ms |
| Kollisionsstriche (`posOf` der Stücke) | 85–105 ms |
| Zählung | bis 13 ms |
| Delta einspielen | 175 ms; neue Zeilen jetzt blockweise 2,7 ms (`bb2214c0`), Aktualisierungen über das ganze Budget am Stück aber 68–78 ms im Browser (Codex R155) |

Eine lange Aufgabe hält auch die Handler von Escape und des E-Stop-Knopfs auf; der Herzschlag der Seite läuft im WebSocket-Worker und ist nicht betroffen.

**Zwei Fassungen und wer veröffentlicht ist** (Fassung 2 nach Codex R155 VP155-02).
- Je Auftrag (Haupt- und Seitenlauf) hält der Viewer die aktuelle Generation in **zwei Kopien X und Y**.
- Geführt wird ausdrücklich, **welche veröffentlicht ist** (`pub`), unabhängig von den Arbeitsnamen. Die andere ist die Arbeitskopie (`work`).
- **Die veröffentlichte Kopie wird nie beschrieben**, in keiner Phase.
- Die gehaltene Generation (3.5) ist unveränderlich und wird von beiden geteilt.

**Einspielen in Schritten, auch innerhalb eines Deltas** (Codex R155 VP155-01).
- Die Arbeitseinheit ist eine begrenzte Zahl von Kopier- und Aktualisierungsoperationen:
  - neue Zeilen blockweise;
  - Aktualisierungen in Stücken.
- Ein kleines Delta wird in einem Schritt fertig. Ein großes hält seinen Fortsetzungsstand und sein Ticket.
- Vor dem ersten Schreiben werden die Grenzen **aller drei Tabellen** eines Deltas geprüft (Reihenfolge, Budget). Abgewiesen wird die ganze Nachricht, nichts geschrieben.
- Gemessen in R155: Ein Update-Delta über das ganze Budget kostet am Stück 68–78 ms im Browser.
- Das gilt für das erste Einspielen in `work` wie für das Nachziehen.

**Die Phasen eines Durchgangs** (höchstens einer in Arbeit; keine anwachsende Delta-Warteschlange):
1. **Einspielen:** Die wartenden Deltas (je Weg höchstens eines, unbestätigt) gehen in Schritten in `work`. `pub` und seine Ansicht bleiben gezeigt.
2. **Aufbau** aus `work`, unverändert gelesen, in Schritten: Ziele samt Sortierung, Gruppenindex, Vereinigung, auch **innerhalb einer großen Gruppe**, Bänder, Striche, Zählung und Startpaare.
3. **Veröffentlichung in einer Aufgabe:** `pub := work`. Ansicht, Tabellenrevision, Bindung an Spur und Auftrag, Abdeckung, Ergebniszustand und Notizen, Bänder, Striche und Zählung gehen gemeinsam hinaus.
   - Jede Abfrage geht über diesen veröffentlichten Stand.
   - Der vorige Stand wird **tot** gesetzt: Jede Abfrage an ihm wirft (`check`), auch aus einem Vue-Cache, der ihn noch hält (Codex R154, Bedingung 1).
4. **Nachziehen:** Dieselben Deltas gehen in Schritten in die andere, nun tote Kopie. Erst wenn sie vollständig darin sind, gehen die Bestätigungen hinaus, je Auftrag und Generation. Danach sind beide Kopien gleich, und die tote ist die nächste `work`.

**Rückfall** (Generationswechsel desselben Auftrags): **Der Aufbau wird verworfen, nicht die Belege.**
- **Die gehaltene Generation wird immer die vollständige nicht veröffentlichte Kopie.** Sie übernimmt den restlichen Abfluss der alten Generation (Runde A) und ist ab dem ersten Delta der neuen Generation unveränderlich.
- Je Phase:
  - **in 1 oder 2:** Ein angefangenes Delta wird in `work` zu Ende eingespielt; `work` übernimmt den Abfluss und wird gehalten.
  - **in 4:** Das Nachziehen in die tote Kopie wird in Schritten zu Ende geführt; diese vollständige Kopie übernimmt den Abfluss und wird gehalten.
  - **danach:** `work` — inhaltlich gleich `pub`, ein getrenntes Speicherobjekt — übernimmt den Abfluss und wird gehalten.
- `pub` bleibt bis zur Veröffentlichung der Vereinigung unberührt und gezeigt; dann wird es frei, ebenso eine vorige gehaltene Generation.
- Die neue Generation beginnt in zwei leeren Kopien.
- So bleiben D1 (veröffentlicht oder nicht) und D2 (der Abfluss) vollständig, und die sichtbare Kopie wird nie beschrieben (Codex' Folge D1 → Veröffentlichung → Rückfall → D2).

**Abbruch und Wechsel.**
- **Neuer Auftrag oder ungültige Prüfgrundlage:** Ein laufender Aufbau wird verworfen. Die Tabellen eines Auftrags, den niemand mehr besitzt, gehen samt ihrem Ticket; dessen Abbruch ging an den Worker.
- **Was gezeigt wird, ändert sich, derselbe Auftrag** (andere Spur, ein Seitenlauf kommt dazu oder geht):
  - Ein laufender Aufbau beginnt neu aus `work`.
  - Ein laufendes Nachziehen wird zuerst zu Ende geführt; danach folgt der Aufbau mit dem neuen Stand.
- **Eine neue Abdeckung allein verwirft nichts** (Codex R155, Antwort 2):
  - Der veröffentlichte Stand behält die Abdeckung seines Aufbaus.
  - Die neueste Abdeckung wird für den nächsten Durchgang vorgemerkt, zusammengefasst. Dieser Durchgang findet **auch ohne neues Delta** statt.
  - Fertig- oder Fehlerstand, Notizen und Abdeckung eilen der veröffentlichten Tabellenfassung nie voraus.
- **Ein später Fertig- oder Fehlerstand** geht mit der nächsten Veröffentlichung hinaus; ein Fehler beendet den Auftrag wie heute.

**Bestätigungstickets** (Codex R154, Bedingung 3):
- Je Auftrag, Generation und Delta, höchstens eines je Weg.
- Es wird **genau einmal** erledigt:
  - durch das vollständige Nachziehen (der Normalfall);
  - beim Rückfall, sobald das Delta vollständig in der Kopie steht, die gehalten wird;
  - durch das Ende des Auftrags (es verfällt; der Worker wartet für einen abgebrochenen Auftrag auf nichts).
- Bestätigt wird nur vom Übergangscode selbst, nie von einer Fortsetzung eines verworfenen Aufbaus. Ein Aufbau trägt seine Nummer, ein später Rest von ihm bestätigt nichts, auch kein Folgeticket.

**Schritte.**
- Arbeitsziel etwa 8–16 ms je Schritt; ein Schritt ist eine begrenzte Zahl von Operationen, auch innerhalb eines Deltas.
- **50 ms ist die gemessene Obergrenze je Aufgabe im Browser**, kein Takt; darunter bleibt Reserve für Vue, DOM und Eingaben (Codex R154, Bedingung 4).
- Der ganze Pfad ist eingeschlossen: Einspielen, Aufbau, Sortierung, die große Einzelgruppe, Bänder, Striche, Startpaare, Nachziehen, und am Ende das Rendern der 400 Zeilen und der Striche.
- In Unit-Tests werden **Operationen je Schritt gezählt**, keine Uhrzeiten.

**Speicher, je gleichzeitig lebendem Besitzer gemessen** (Codex R154, Bedingung 5):
- **Im Regelfall:** `pub` + `work` der aktuellen Generation (zusätzlich T + S ≈ 21,7 MB gegenüber 3.4), die geteilte gehaltene, der veröffentlichte und der entstehende Ableitungssatz (zusätzlich bis 14,59 MB), dazu die vorübergehenden Sortier- und Aufbaupuffer, getrennt ausgewiesen: gezählt, wo sie entstehen (`withMeter`, Codex R158 VP-I118), als obere Schranke, ab dem ersten Schritt des Aufbaus bis zu seiner Veröffentlichung oder seinem Verwerfen (`views.inProgress`, neben `published` und `waiting`). Am größten sind die Puffer des Vereinigungsgangs, etwa 84 B je Intervall der größten Gruppe beider Generationen (Ansicht und Bänder teilen einen Satz); gemessen bis 61 MB im Aufbau beim Rückfall einer Gruppe von 2 × 262 144 Intervallen.
- **Beim Rückfall:** `pub`, die vollständige nicht veröffentlichte Kopie (jetzt gehalten), die neue aktuelle Generation, die vorige gehaltene bis zur Veröffentlichung, der entstehende Vereinigungsaufbau.
- Die Ausgangsrechnung ist etwa 181,5 MB (145,2 + 21,7 + 14,59) ohne Aufbaupuffer (R156: 174,3 MB); gemessen wird jeder Übergang.
- Die Zeilen-, Strich- und DOM-Objekte der Liste werden als Heap getrennt berichtet.

**Nicht gewählt: ein Aufbau-Worker.**
- Er hielte die Seite ganz frei, aber:
  - Ohne `SharedArrayBuffer` gäbe es die gehaltene Generation zweimal (zusätzlich T + S). Über LAN-HTTP fehlt der sichere Kontext dafür.
  - Übertragene Tabellenpuffer hinterließen auf der Seite tote Speicherobjekte mit noch passender Revision; ein später Leser läse Unsinn (VP-I107 in neuer Form).
  - Sein bester Grund, das teure Nachziehen, ist mit dem Einspielen in Schritten (oben) auch auf der Seite begrenzt.
- Er bleibt als Alternative benannt.

**Abnahme 3.6:**
- Der Aufbau in Schritten ergibt **Feld für Feld** dieselbe Ansicht wie der Aufbau am Stück: auf allen Ansichtstests und den Budgetformen.
- Die Operationen je Schritt sind begrenzt: in einer einzigen großen Gruppe und beim Einspielen und Nachziehen von Anhänge-, Aktualisierungs- und gemischten Deltas.
- Eine alte Ansicht, über Veröffentlichung und Nachziehen gehalten, wirft bei jeder Abfrage.
- Die veröffentlichte Kopie wird nie beschrieben, in jeder Phase.
- **Rückfall in jeder Phase** (vor der Veröffentlichung, nach ihr während des Nachziehens, danach), jeweils mit einem noch ausstehenden Abfluss, der einen weiteren Kontakt bringt: Beide Deltas stehen in der gehaltenen Generation mit eigener Abdeckung; das alte Ticket ist genau einmal erledigt.
- Abbruch während des Einspielens und während des Nachziehens.
- Die Tickets: keine Bestätigung durch einen verworfenen Aufbau, kein Folgeticket bestätigt.
- Mehrere reine Fortschrittsmeldungen während eines Aufbaus, danach Ruhe: Der letzte Stand wird veröffentlicht, ohne Abbruchschleife und ohne ein weiteres Delta abzuwarten.
- Im Browser in Budgetgröße, eine Generation und Rückfall: keine Aufgabe über 50 ms, das Einspielen eines Update-Deltas über das ganze Budget eingeschlossen. Eine Eingabe zwischen den Phasen wird innerhalb eines Schritts bedient. Ein Abbruch in einer großen Gruppe greift.
- Speicher je Besitzer und Übergang.

## 4 · Eine Ableitung für alle Ansichten

Alle Ansichten lesen die Tabellen über **ein** Modul (`viewer/contactView.ts`).

### 4.1 Ziele, Zählung, Navigation

- **Ziele** sind die Berührungsintervalle (Kollision, Wiedereintritt, möglich, Anfahrt) und die Beinahe-Kollisionen (Episode ohne Intervall, an ihrer nächsten Annäherung).
- Ein **Index** führt sie nach Stelle sortiert als typisierte Felder (Reihenfolge, Art).
- `findingWords` zählt aus dem Index.
- Navigation: `targetAfter` / `targetBefore` suchen binär im Index. Der Schlüssel ist die Identität (1.2), nicht mehr die Zeile.
- „touch“ heißt überall: das Ziel ist ein Berührungsintervall. Die Schwelle 1e-3 der Ansichten neben 1e-4 im Sweep entfällt; es gilt eine Klasse, die des Sweeps.

### 4.2 Code-Marken

- Eine Zeile ist markiert, wenn eine Episode eine ihrer Bewegungen überdeckt; heute markieren die Sätze genau die Zeilen im Rand. Die Arten bleiben die heutigen: Grenze, „möglich“, sonst Kontakt (`collisionMarkByLine`). Eine Unterscheidung von Annäherung und Berührung in der Marke kommt nicht hinzu. Wissenslücken markieren nicht.
- Das Code-Panel fragt **nur die sichtbaren Zeilen** ab:
  - Anzeigezeile → ihre Spurbereiche über einen Index der Anzeigezeilen, einmal je Spur gebaut wie `lineIndex.ts`, mit den Aufrufspannen. Eine wiederholte Quellzeile (Schleife, mehrere Aufrufe) behält **jede** ihrer Spannen einzeln; eine Spanne von der ersten bis zur letzten Ausführung würde fremde Bewegungen dazwischen markieren (Hinweis b).
  - Dann Überdeckung, binär gesucht.
- Es entsteht keine Menge über alle Zeilen. Das Ereignis `collision-lines` übergibt die Tabellen bzw. eine Abfragefunktion statt einer Liste.

### 4.3 Färbung, Bänder

- **Färbung:** Ein Paar leuchtet, wenn die Pose in einem seiner gezeigten Intervalle liegt (3.5), binär gesucht im Intervallindex des Paars. Ein offenes Intervall gilt bis zur Abdeckung, **außer über eine Wissenslücke**; ein ausgesetztes bis zum Lückenbeginn. Es gibt keine Spanne aus einem Beginnsatz und keine Verlängerung über eine Annäherung (R85).
- **Bänder der Zeitleiste:** Sie werden **in Anzeigeauflösung** berechnet, nicht als vollständige Vereinigung gespeichert. Je Pixelspalte der Leiste zählt, ob ein gezeigtes Intervall sie berührt. Ein Kontakt schmaler als ein Pixel belegt sein Pixel und verschwindet nie. Freiraum und Lücken unterbrechen ein Band, **soweit die Auflösung sie darstellen kann**: Eine freie Stelle in einer Pixelspalte zwischen zwei Kontakten darin bleibt im Band unsichtbar (Codex R141). Ein offenes Intervall reicht bis zur Abdeckung und ist gekennzeichnet. Höchstens 8192 Stücke.
- **Das Band ist nie Quelle** von Zählung, Färbung, Navigation oder einer Kontaktentscheidung; diese lesen die gezeigten Intervalle selbst.

### 4.4 Liste im Sim-Tab

- Die Liste zeigt ein **Fenster** von höchstens 400 Zeilen um die gezeigte bzw. nächste Zeile. Davor und danach steht je eine Zeile „N frühere“ / „N spätere“.
- ‹ › und die Zählung erreichen jedes Ziel; nur die Liste ist begrenzt (R84).
- **Kollisionsstriche** der Zeitleiste (Codex R154, Antwort 2): einer je belegter Spalte der Leiste, an seinem ersten Ziel, eine Beinahe-Kollision nur, wo jedes Ziel der Spalte eine ist; höchstens min(Ziele, Spalten), die Spalten höchstens `TIMELINE_COLUMNS` = 8192 wie die Bänder. Werkzeug- und Limitstriche getrennt, einer je Ziel. Gehalten in `marks` und als DOM-Knoten; `derivationBound` bleibt, der Heap dieser Objekte wird mit 3.6 gemessen.
- Fokusführung (R78) und Mitlaufen (R81) gelten für das Fenster. Der Fokus hängt an der **Ereignisidentität** (3.5), nicht an der Quellzeile. Verschiebt sich das Fenster unter einem fokussierten Element, gilt die heutige Regel: dasselbe Ereignis, sonst das an seiner Stelle, sonst der Filter.

### 4.5 Erster Kontakt (Paket 1)

Entfällt als eigene Regel: Der gehaltene erste Kontakt ist ein Sonderfall von 3.5.

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

Die Laufzeit mit Pflichtprobe lief zeitweise neben einem Browsertest. Codex nimmt die Laufzeiten deshalb nicht als Beschleunigungsfaktor ab (R139); gemessen wird im Commit selbst unter gleicher Last. Heap und Zählungen hängen von der Last nicht ab.

Die 23 fehlenden Beginne sind ausnahmslos Beinahe-Kollisionen mit 1,83–2,0 mm Abstand, also am Rand des Prüfabstands, in vier Paaren (Säule gegen Abdeckungen, Wellen, Planscheibe und Lagerlippe). Jeder liegt im Lauf ohne Pflichtprobe innerhalb eines Aufenthalts desselben Paars, der dieselben Zeilen überdeckt. Es gibt keinen Beginn, den nur der Lauf ohne Pflichtprobe hat.

Ursache: Eine Episode endet erst mit einer **abgetasteten** Trennung (`d > 2·margin`). Die Pflichtprobe je Zeile tastete bei 0,09-mm-Zeilen so dicht, dass kurze Ausflüge über 4 mm gesehen wurden. Ohne sie bestimmt der Erkundungstakt, wo eine Trennung gesehen wird; dazwischen gilt der Aufenthalt als zusammenhängend. Das ist die vorsichtige Richtung: Keine Berührung fehlt, eine Annäherung wird nie verschwiegen, nur seltener unterteilt.

**Codex R139 (Antwort 1):** zulässig im Paket, als letzter eigener Commit der Runde B **nach** der Umstellung von Modell und Ansichten, mit eigener Abnahme. Weniger Unterteilungen eines unbeobachteten Randaufenthalts sind vertretbar, wenn keine bekannte Trennung, Berührung oder Schneid-/Eilgang-Regel verloren geht. Keine zusätzliche Probe, nur um die alte Zahl 69 wiederherzustellen. „Neu ⊇ alt“ gilt für die Abdeckung durch Intervalle und für alle Ansichten, nicht nur für die Zahl der Beginne; dazu VP139-02 und VP139-05 (7.2, 7.3).

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

Während Runde A schreibt der Sweep in **beide** Senken, in der alten wie in der neuen; die Proben sind also dieselben. Auf zufälligen Spuren der mitgelieferten und der erzeugten Modelle gilt je Paar:
- dieselbe Vereinigung der Berührungsintervalle bis auf die Verfeinerungstoleranz;
- dieselben Beinahe-Episoden.

Erlaubt sind Abweichungen nur dort, wo das alte Modell gekappt (200), zusammengefasst (16 Cluster, `CLUSTER_GAP`, `mergeContiguousIntervals` über eine nachgewiesene freie Probe) oder an der Zeilengrenze verfeinert hat (R90), wo es eine Annäherung als Spanne gezählt hat (R85), oder wo die neue Senke eine Wissenslücke führt, die das alte Modell als Kontakt las (1.1). Dazu kommt die Stelle einer Beinahe-Kollision: die nächste Annäherung der ganzen Episode statt der der Beginnzeile. Jede solche Abweichung wird gelistet und von der Wahrheit entschieden (7.3).

### 7.3 Orakel, Auflösung und Shards (VP139-05)

**Das 0,5-Raster ist ein Suchwerkzeug, kein Beweis.** Es tastet bei 0,25, 0,75, … und sieht einen Kontakt auf [0,35; 0,65] nie, obwohl er breiter ist als MIN_ADV (Codex R139). Es bleibt als schneller Suchtest im Gate. Für die Zusage „jede Berührung breiter als MIN_ADV“ gelten drei eigene Prüfungen:

1. **Analytische Kontaktfenster.** Synthetische Spuren mit bekannten Fenstern: ein Körper fährt mit fester Geschwindigkeit an einem anderen vorbei, Eintritt und Austritt sind geschlossen berechnet. Variiert werden:
   - Breiten von 0,26 bis 0,5;
   - zufällige Phasen gegen das Raster und gegen Zeilenenden;
   - nachgewiesene freie Zwischenräume von 0,3 und darunter;
   - Wiedereintritte;
   - Vorschub-/Eilgang-Wechsel innerhalb des Fensters.

   Verlangt: Jedes Fenster ist genau ein Intervall mit seinen Grenzen auf 1e-3, und jeder freie Zwischenraum, den der Sweep **mit einer Probe nachgewiesen** hat, bleibt eine Trennung (VP139-02). Ein analytisch vorhandener, unbeprobter Zwischenraum unter MIN_ADV darf nach der vereinbarten Regel überbrückt bleiben (Codex R140). Der Wächter prüft deshalb zuerst, dass die freie Probe im Ergebnis steht.
2. **Erzeugte Maschinen bei feinem Raster.** `generatedCase` (Commit `3e08df86` auf `feat/step4-p2`) mit STEP = 0,05 auf kurzen Spuren, als Abnahme des Pflichtproben-Commits und der Modellumstellung, nicht in jedem Gate.
3. **Die Geschwindigkeitsschranke direkt.** Ein Eigenschaftstest auf erzeugten Maschinen: Je Abschnitt ist `pairV` mindestens die relative Punktgeschwindigkeit der Netzpunkte beider Körper. Diese wird **im Inneren** des Abschnitts dicht abgetastet, nicht nur an den Endpunkten, damit mehrere Drehachsen und veränderliche Hebel gesehen werden. Gemessen wird in derselben Parameter- und Koordinatenbasis wie `pairV` (mm bzw. °, 1° ≙ 1 Einheit; Codex R140). Das prüft die Hebelrechnung selbst und nicht nur ihre Folgen.

**Empfindlichkeit, gemessen** (12. Oktober, kompilierende Mutationen der Hebelrechnung in `collision.ts`):

| Mutation | Orakel mitgeliefert, Gate | erzeugt, Gate | erzeugt, gründlich (50) |
|---|---|---|---|
| Hebel × 0,5 | grün | grün | grün |
| Hebel ohne Körperradius | grün | grün | grün |
| Drehachse immer z | – | – | grün |
| Hebel × 0,25 | – | – | **rot** |

Die Folgen-Orakel fangen nur grobe Fehler. Der doppelte Sicherheitsfaktor der Schranke und der Mindestschritt verdecken kleinere. Prüfung 3 soll genau diese Lücke schließen; ihre Abnahme sind die Mutationen der Tabelle, rot.

**Ein eigener Befund am Orakel** (Commit `3e08df86`). Die erste gründliche Suche schlug auf Maschine 20261051 fehl. Ein Paar trat 0,15 vor dem Ende seiner Zeile in den Rand und lief in einen Kontakt auf der nächsten Zeile. Der Sweep sah es an der Segmentgrenze, 0,2 nach dem Eintritt und damit innerhalb seiner Garantie, und buchte es auf die nächste Zeile. Das Orakel maß die Strecke über das Zeilenende hinweg und verlangte einen Eintrag auf der früheren Zeile; den hat der Sweep nie zugesagt. Gemessen wird jetzt innerhalb der Zeile (`runWide … within = lineSpan`). Im neuen Modell wird die Bedingung zu „liegt in einer Episode, außer die unbedeckte Strecke ist schmaler als MIN_ADV“.

**Shards:** `sweepShards.test.ts` verlangt gleiche Episoden und Intervalle in 1, 2 und 3 Shards bis auf Ereignisse schmaler als MIN_ADV; die Wahrheit entscheidet wie heute. `collisionOracle.test.ts` bekommt seine Prüfungen auf dem neuen Modell.

Die erzeugten Maschinen erweitern die empirische Abdeckung. Die Allgemeinheit über beliebige Gelenkbäume beweisen sie nicht allein; Grundlage bleiben die Schrankenbeweise und ihre zulässigen Familien (R139).

### 7.4 Budget und Speicher

- Ein künstlich kleines Budget hält an, sagt „unvollständig ab“, lässt offene Kontakte offen und zeigt die gesicherten Funde. Im Pool ist `incompleteFrom` das Minimum über die Shards.
- **Angehaltener Empfänger:** Der Viewer bestätigt nicht, während dieselbe offene Episode tausendfach aktualisiert wird und ein Seitenlauf sowie viele unentscheidbare Abschnitte laufen. Verlangt: höchstens ein Delta je Weg, kein Wachstum der Puffer, das Datenbudget unter seiner Grenze.
- **Speicherwächter mit beiden Generationen** (VP139-03): gehaltener und neuer Bestand mit nicht zugeordneten Kontakten, Wissenslücken, die Bänder zerlegen, und ein gleichzeitiger Seitenlauf. Verlangt: die Ableitungen unter ihrer Grenze aus 3.4, die Bänder höchstens 8192 Stücke.
- Volle Lückentabelle: Der Sweep hält an und sagt „unvollständig ab“.
- `haus.ngc` Fall B: Datenbudget (belegte Puffer samt Blockrundung und Nutzbytes) und Heap getrennt, vorher und nachher; nach Commit 5 zusätzlich die Abfragen.

### 7.5 Weitere Abnahme

- Ein Befund in der M600-Routine nennt die Aufrufzeile. Ein Ereignis ohne Anzeigezeile zeigt den Namen bzw. „—“, setzt keine Marke und bleibt navigierbar.
- **Wissenslücken** (VP139-01), je mit Zählung, Band, Färbung und Vorbehalt zusammen:
  - zunächst unentscheidbar;
  - bestätigter Kontakt → unentscheidbar → wieder bestätigt, ohne und mit nachgewiesener Trennung;
  - Kontakt → unbekanntes Werkzeug → wieder bekannt.
- **Trennung:** Codex' Gegenbeispiel [0,1] und [1,001; 2] mit freier Probe bei 1,0005 ergibt zwei Intervalle (VP139-02).
- **Rückfall** (VP139-04), je in allen sechs Ansichten:
  - die A/B-Folge: beide bleiben;
  - Codex' R140-Folge A = [0, 1], B = [1,001; 2], frei bei 1,0005, danach C = [0, 2]: zwei Ziele, **Färbung an 1,0005 aus**, das Band an einer Auflösung, die die Stelle darstellen kann, ebenso, die Trennung erhalten, die Navigation eindeutig;
  - Codex' R141-Folge mit dem schmalen Kontakt [1,4; 1,6] (Berührung bei 1,5) gegen eine neue Generation mit freien Proben bei 1,125 / 1,375 / 1,625 / 1,875: **der schmale Kontakt bleibt** in allen sechs Ansichten, gleichzeitig mit der R140-Folge im selben Test;
  - eine freie Probe direkt nach einer Trennung ohne nächstes Intervall (Teilstand, Ende, Rückfall unmittelbar danach): der Trennbeleg kommt mit dem Austritt an;
  - Codex' R142-Folge: Eine vorsichtige Grenze auf einer unentscheidbaren Antwort wird von einem späteren gültigen Freiraum überdeckt. Verlangt: Der tatsächliche Kontakt bleibt mit seinem Zeugen, er behält genau eine ID, die Auswahl bleibt bei ihm, und ein unverändertes Folgedelta lässt die ID stabil;
  - eine Zeile mit mehreren Schnitten: jedes Stück mit eigenem Schlüssel und eigener stabiler ID, über wiederholte Deltas gleich;
  - der Freiraum am Rand: Eine Probe mit d knapp über CONTACT_EPS und eine Berührung genau am Rand des Radius werden nicht geschnitten (offene Ränder, nach innen gerundeter f32-Radius, auf den Abschnitt geschnitten, V = 0);
  - Freiradius: Der Freiraum einer Probe überdeckt nie eine dicht abgetastete Berührung (Eigenschaftstest auf erzeugten Maschinen, wie Prüfung 3 in 7.3);
  - der umgekehrte Fall: altes grobes [0, 3] mit ID 11, neuer Freiraum bei 1,5 ergibt zwei Stücke. Das Stück mit dem Zeugen behält 11, das andere bekommt eine neue ID, beide sind per ‹ › je einmal erreichbar, die Auswahl bleibt bei 11, und nach einem unveränderten Delta sind beide IDs dieselben;
  - ein neues Intervall über mehrere getrennte alte Ereignisse: jedes behält seine Identität;
  - ein offenes Intervall mit späterem Ende: verlängert;
  - eine alte Nachricht nach dem Generationswechsel: verworfen;
  - ein neuer Auftrag: übernimmt nichts.

  Dazu die R136–R138-Folgen als Wächter.
- **Zeit:** Erstmeldung mit Verfeinerung und Antwort auf Anhalten und Abbruch, gemessen wie in R138 und alt gegen neu verglichen (2.2).
- Mutationen für jede Regel, kompilierend und rot.

## 8 · Runden

Codex hat zwei Umsetzungsrunden angenommen (R139, Antwort 6):

- **Runde A — Kern:**
  - Modell und Tabellen mit Lücken und Verkettung;
  - die Senke im Sweep mit beiden Senken und exakter Gegenprobe (7.2);
  - Verfeinerung beim Übergang, Budget;
  - Shard- und Anfahr-Merge auf Tabellen;
  - Deltas mit Bestätigung, Generationen, Koordinator;
  - die Orakelprüfungen 1 und 3 aus 7.3.

  Die App liest in Runde A noch die alte Senke. Geprüft wird durch Orakel, Gegenprobe und `collisionWorker.test` mit falschen Sub-Workern, auch mit angehaltenem Empfänger.
- **Runde B — Ansichten:**
  - `contactView`, Code-Marken, Färbung, Bänder, Liste mit Fenster, Navigation, Anzeigezeilen;
  - der Rückfall nach 3.5;
  - Umstellung des Viewers, Entfernen der alten Senke und des Paket-1-Haltens;
  - Doku.
  - **Als letzter, getrennt beurteilter Commit** die Pflichtprobe je Zeile (5), mit Prüfung 2 aus 7.3 und Messung unter gleicher Last. So verdecken sich Modellwechsel und weniger Abfragen nicht gegenseitig.

## 9 · Nicht in diesem Paket

- Das Kontaktzertifikat für anhaltende Durchdringung (eigener Plan nach Paket 2).
- Erklärte erlaubte Kontakte (Paket 3).
- Die Teilung der Spur in Abschnitte (Schritt 5).
- GPU.
- Die Messung auf einem getrennten Browser-PC bleibt eigens offen.

## Antworten auf R139

| Befund | Antwort | Wo |
|---|---|---|
| VP139-01 | Drei Zustände: Berührungsintervall, Beinahe-Episode, Wissenslücke mit Grund. Entdeckung nur durch bestätigte Berührung oder Innenlage; Verfeinerung zählt „unentscheidbar“ zur Kontaktseite und benennt die Stelle; ein Intervall an einer Lücke wird ausgesetzt, ohne erfundenen Austritt, und läuft ohne nachgewiesene Trennung weiter. `toolUnknown` beginnt danach neu, wie heute. Lücken zählen, färben und markieren nicht. | 1.1, 1.4, 2.1, 2.3, 4.2, 7.5 |
| VP139-02 | Kein Zusammenführen in der neuen Senke; eine nachgewiesene freie Probe gehört zur Identität, auch unter 2e-3; unbeprobte Lücken sind keine Trennung. | 2.2, 7.3, 7.5 |
| VP139-03 | Höchstens ein unbestätigtes Delta je Weg, Aktualisierungen je Zeile zusammengefasst; Endergebnis = letztes Delta auf demselben Stand; Lücken, Seitenläufe, Rückfallbestand, Merker und Blockrundung im Budget; Obergrenze im ungünstigsten Fall etwa 93 MB; Datenbudget und Heap getrennt gemessen. | 1.4, 2.4, 3.1, 3.2, 3.4, 7.4 |
| VP139-04 | Alle erhaltenen Befunde bleiben über einen Rückfall; Zuordnung eins zu eins nach Herkunft, Paar und Überdeckung; Erreichen ist kein Widerlegen; Generation in jeder Nachricht; `max(0, c−shift)` verschmilzt nichts. Das Paket-1-Halten entfällt als Sonderfall. | 1.2, 3.5, 4.4, 4.5, 7.5 |
| VP139-05 | 0,5-Raster nur als Suche; Abnahme durch analytische Fenster, erzeugte Maschinen bei 0,05 und einen direkten Test der Geschwindigkeitsschranke; Empfindlichkeit gemessen; eigener Orakelbefund (Zeilenspanne) benannt. | 7.3 |
| Hinweis a | Verkettung „nächstes Intervall“, im Budget. | 1.4 |
| Hinweis b | Jede Spanne einer wiederholten Quellzeile einzeln; Fokus an der Ereignisidentität. | 4.2, 4.4 |
| Hinweis c | Pose nach jeder Bisektion wiederhergestellt; Erstmeldung nach der Verfeinerung ihres Eintritts, Verzögerung und Antwortzeiten gemessen. | 2.2, 7.5 |

## Antworten auf R140

| Befund / Frage | Antwort | Wo |
|---|---|---|
| VP139-04, Rest | Belege bleiben über den Rückfall, positive wie negative. Gezeigt wird die Vereinigung der Intervalle beider Generationen, geschnitten an jeder nachgewiesenen freien Probe (gespeichert als `freie Probe davor`). Ein gröberes Intervall überbrückt keine bewiesene freie Stelle; ein altes grobes wird genauer. Identität nach dem frühesten überdeckten alten Ereignis, beim Überdecken mehrerer alter Ereignisse durch Schneiden getrennt. Wächter in allen sechs Ansichten mit Codex' Folge. | 1.4, 2.2, 3.5, 7.5 |
| VP139-03, Rest | Ableitungen für beide Generationen und den Seitenlauf ohne Zuordnung budgetiert (≤ 7,8 MB), Bänder in Anzeigeauflösung (≤ 8192 Stücke) und Code-Marken je sichtbarer Zeile nicht materialisiert, Lückenstücke damit begrenzt; Summe etwa 113 MB; Anzeigezeilenindex und Paarzustand getrennt ausgewiesen; Speicherwächter mit beiden Beständen, Lücken und Seitenlauf; belegte Puffer samt Blockrundung berichtet. | 3.4, 4.3, 7.4 |
| Frage 1 (`toolUnknown`) | Übernommen: Neubeginn als eigenes Ziel „nach unbekanntem Werkzeug“, kein geometrischer Wiedereintritt; die Lücke ohne Marke und Band. | 1.1, 1.4 |
| Frage 2 (Budget) | Übernommen: Größenordnung bleibt, keine kleineren Budgets; Grenze nach VP139-03 neu gerechnet. | 3.4 |
| Hinweise zu den Wächtern | Freie Zwischenräume nur als vom Sweep nachgewiesene Trennbelege; `pairV` im Inneren der Abschnitte in derselben Basis verglichen. | 7.3 |

## Antworten auf R141

| Befund | Antwort | Wo |
|---|---|---|
| VP139-03, Zahlen | Codex' Rechnung übernommen (Seitenlauf ein Achtel beider Generationen): Ableitungen ≤ 8,4 MB. Mit dem erweiterten Intervall (37 B) T = 16,8 MB, S = 2,1 MB, Summe etwa 122 MB. | 1.4, 3.4 |
| VP139-03, Raster | Bänder zeigen Freiraum und Lücken nur, soweit die Auflösung sie darstellen kann; das Band ist nie Quelle von Zählung, Färbung, Navigation oder Kontaktentscheidung. Der Bandwächter prüft bei einer Auflösung, die die Stelle darstellen kann. | 4.3, 7.5 |
| VP139-04 A | Drei Arten Wissen: bestätigte Kontaktorte, angenommener Kontakt, bewiesener Freiraum. Freiraum ist nur die Umgebung [p − r, p + r] einer freien Probe, r = (d − ε)/V, nicht die Spanne zwischen den Grenzen eines Laufs. Gezeigt: Vereinigung beider Generationen minus bewiesener Freiraum; bestätigte Orte gewinnen. Der Trennbeleg steht am endenden Intervall und geht mit dem Austritt, also auch ohne nächstes Intervall. Beide Codex-Folgen im selben Wächter. | 1.4, 2.2, 3.5, 7.5 |
| VP139-04 B | Beim Teilen behält nur das Stück mit dem Anker (verfeinerter Eintritt des Beginns) die alte ID; weitere Stücke bekommen neue, an ihre Tabellenidentität gebundene IDs, stabil über unveränderte Deltas; Auswahl folgt der ID. Wächter mit zwei Stücken, eindeutigen IDs, einmaliger Erreichbarkeit und stabilen IDs. | 3.5, 7.5 |

## Antworten auf R142

| Befund / Bedingung | Antwort | Wo |
|---|---|---|
| VP139-04 B, Anker | Verfeinerte Grenze und Zeuge sind getrennt. Der Zeuge ist die entdeckende bestätigte Berührungsprobe jedes Intervalls und als einziger der ID-Anker; er liegt nie im Freiraum. Eine Grenze ist nur mit dem Kennzeichen „entschieden“ ein positiver Beleg; eine vorsichtige Grenze auf „unentscheidbar“ ist angenommener Kontakt und darf von Freiraum geschnitten werden. Die konservative Bisektion und ihr Vorbehalt bleiben. Codex' Folge ist Wächter. | 1.4, 2.2, 3.5, 7.5 |
| Bedingung 1, Freiraum streng | Offene Ränder, Radius als f32 nach innen gerundet, auf den Abschnitt geschnitten, V = 0 = ganzer Abschnitt; Randfall als Wächter. | 2.2, 7.5 |
| Bedingung 2, Stückschlüssel | Neue IDs sind an (Ursprungszeile, linker Trennbeleg) gebunden, nicht an die gemeinsame Ursprungszeile allein; stabil über wiederholte Deltas; mehrere Schnitte als Wächter. | 3.5, 7.5 |
| Budget | Zeuge (8 B) und Merker angefangener Blöcke nachgeführt: Intervall 45 B, T = 19,3 MB, S = 2,4 MB, Summe etwa 139 MB. | 1.4, 3.4 |

Keine offenen Fragen.
