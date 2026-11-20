# Leiste mit mehr Achsen · Plan

Review-Datei vom 19. November 2026. Basis ist development `dc9dc3e4`, mit S (symmetrische Variante A) und K; die CI dort ist grün.

---

## Claude · Planvorschlag · Anfrage R411 · 19. November 2026

### Auftrag des Operators

Gefragt hat der Operator: „müsste generell immer alles sichtbar sein? auch bei mehreren achsen? sollte tool bei vielen achsen kollabieren? gefolgt von der spindel? oder an einen andere ort wandern?“ Nach dem Merge von S und K gab er am 19. November das Go zum Planen: „du kannst ein paket für mehr achsen planen. vielleicht mit renderings“.

- **Gebaut wird erst mit dem Go des Operators auf diesen Plan.** Die Fragen an den Operator stehen unten; ich stelle sie.
- **Seine eigene Maschine** hat drei Achsen bei 1920 × 1080 Touch. Dort ändert sich nichts.
- **Betroffen** sind die mitgelieferten Beispiele mit fünf Achsen (XYZAC mit Kinematikwahl) und sechs Achsen (TWP, XYZABC), dazu kleinere Fenster.
- **Seite für den Operator:** https://claude.ai/artifact/XqNdyAD8Ne2A7YqqXzEBV1

**Erbeten:** `agreement` zum Plan, gern mit Änderungen, oder `findings`. Kein Code.

### Gemessen

**Prototypen** auf `dc9dc3e4`, durch eingefügtes CSS und DOM:
- [Render-Spec](leiste-achsen.plan.render.spec.ts) und [Messungen](leiste-achsen.plan.messung.jsonl);
- je Fall: Überlauf, beide Enden, und ob E-Stop, Spindle Stop, Feed-Override und Jogs Stop im sichtbaren Fenster liegen und an ihrer Mitte nicht verdeckt sind;
- gemessen bei Scrollanfang, Mitte und Ende.

**Grundbreiten bei Touch in Chromium**, in px: Safety 280, Overrides 192, Spindle 233, Tool mindestens 224.

| Achsen | Jog | Setup | 1920 heute | 1920 ohne Tool | 1280 heute |
|---|---:|---:|---:|---:|---:|
| XYZ | 523,5 | 369 | passt (Tool +32,5) | — | 608 über |
| XYA | 579,5 | 369 | 24 über | passt (+208,5) | — |
| XYZA | 641,5 | 452 | 169 über | passt (+63,5) | — |
| XYZAC (Kinematik) | 662,5 | 465 | 203 über | passt (+29,5) | 843 über |
| XYZABC | 719,5 | 465 | 260 über | 28 über | — |
| TWP XYZABC (Kinematik) | 735,5 | 553 | 364 über | 132 über | 1004 über |

- **Heute schon:** Am Scrollanfang liegt Spindle Stop bei XYZABC und TWP hinter dem rechten Rand, bei 1280 px schon mit drei Achsen.
- **Bilder:**
  - [TWP heute](leiste-achsen.plan.1920-TWP-heute.png)
  - [TWP mit Tool weicht und rechter Gruppe](leiste-achsen.plan.1920-TWP-M2.png)
  - [XYA, Spindle nimmt den Rest](leiste-achsen.plan.1920-XYA-M1.png)
  - [XYA, der Rest als gleiche Abstände](leiste-achsen.plan.1920-XYA-M1g.png)
  - 1280 XYZAC: [rechte Gruppe, Anfang](leiste-achsen.plan.1280-XYZAC-M2.png), [rechte Gruppe, Mitte](leiste-achsen.plan.1280-XYZAC-M2-mid.png), [nur Overrides fest](leiste-achsen.plan.1280-XYZAC-M3.png)
  - [TWP mit offenem Drehzahlfeld](leiste-achsen.plan.1920-TWP-M2-rpm.png)
  - [2560 W1](leiste-achsen.plan.2560-XYZ-W1.png)

### Fables unabhängiger Blick

Fable hat Daten und Bilder ohne meine Empfehlung bekommen; der Bericht liegt [hier](leiste-achsen.plan.fable.md). Übernommen habe ich:

- **Eine Leiter von Formen.** Die feste rechte Gruppe gibt es nur, wenn die Mitte Jog ganz hält. Sonst wird Overrides allein fest, und darunter scrollt nur noch die Leiste.
  - Grund: `dragScroll` lässt Jog-Knöpfe aus. Eine Mitte, die fast nur aus Jog-Fläche besteht, joggt beim Wischen, statt zu scrollen.
  - Bei 1280 mit fünf oder sechs Achsen ist die Mitte etwa 535–560 px breit, Jog aber 662,5 bis 735,5.
- **Rangfolge des Sichtbaren:**
  1. E-Stop.
  2. Die drei Overrides; Feed ist der weiche Stopp.
  3. Spindle Stop. Sein Gate ist während eines Programms zu, das Programm führt dann die Spindel. Er weicht deshalb als Erster der drei. Das ändert meinen Grundsatz G1 aus dem Entwurf.
- **Jogs Stop ist sichtbar, wann immer ein Jog-Knopf sichtbar ist.** Ein Schrittjog läuft nach dem Loslassen weiter. Bei 1280 lag Stop in der Mitte und am Ende unter Safety, während A± und C± sichtbar waren.
- **Die Zeile „Tool T12“ in Spindle wird selbst der Knopf zur Werkzeugtabelle**, in voller kompakter Höhe (36 px Touch). Eine Textzeile von 20 px wird kein Ziel.
- **Der Rest und die Form richten sich nach dem gehaltenen `stripLayout`, nicht nach dem DOM.** Mein Prototyp schaltete mit `:has(.nkStrip)` ab; das trifft `.stripHelperPlace` nicht. Schlösse sich das Ziffernfeld unter einem Druck, wüchse Spindle von 233 px auf den Rest der Zeile und schöbe den gehaltenen Platz. Tool hatte das Problem nie, weil es kein Feld besitzt.
- **Jeder Wechsel der Form geht durch `heldThroughPress`**, auch der Wechsel der Dichte nach dem ersten Touch.
- **Der Wächter verlangt die ganze Box** eines Knopfs, sichtbar und zuoberst, nicht nur seine Mitte.

### Vorschlag

#### Die Formen

Jede Form ist eine reine Funktion der Konfiguration und des Platzes.

| Form | Wann | Was |
|---|---|---|
| **F0 voll** | Tool passt mit 224 px samt Reserve | wie gebaut (S) |
| **F1 Tool weicht** | sonst, wenn die Zeile ohne Tool passt | Tool-Abschnitt aus; „Tool T…“ (Knopf zur Werkzeugtabelle) und „In effect“ in Spindle unter Coolant |
| **F2 rechte Gruppe fest** | sonst, wenn die Mitte zwischen Safety und Overrides + Spindle Jog ganz hält | Overrides und Spindle `sticky` rechts; Jog und Setup scrollen |
| **F3 Overrides fest** | sonst, wenn die Mitte zwischen Safety und Overrides Jog ganz hält | nur Overrides `sticky` rechts; Spindle scrollt mit |
| **F4 scrollt** | darunter | wie heute, ohne Tool |

**Bei 1920 Touch:**
- F0 für X bis XYZ;
- F1 für XYA, XYZA und XYZAC;
- F2 für XYZABC (28 px zu wischen) und TWP (132 px).

**Bei 1280:**
- F2 für XYZ, gerechnet: Mitte etwa 560 ≥ Jog 523,5;
- F3 für XYZAC und TWP, Mitte etwa 780 px.

Die Schwellen prüft der Wächter in beiden Browsern.

#### Was mit Tools Zeilen geschieht

- **Pocket, Typ und Beschreibung** stehen im Tab „Tools“.
- **Ø und L** zeigt die Werkzeugzeile der Positionsanzeige im Viewer, sofern sie eingeschaltet und nicht eingeklappt ist. Das sage ich dem Operator so.

#### Wer den Rest nimmt

Bei F1 bleibt rechts Platz. Mein Vorschlag: Er verteilt sich gleichmäßig auf die Abstände zwischen den Abschnitten (`justify-content: space-between`).
- Spindle bis 441,5 px zu strecken (XYA) sieht unfertig aus. Das RPM-Feld wird etwa 350 px lang, Rev/Stop/Fwd bleiben links.
- Bei offenem oder gehaltenem Helfer gibt es keine Verteilung: Der Helfer sitzt direkt rechts neben seinem Abschnitt, wie heute.

Das entscheidet der Operator (Q411-2).

#### Was die Form bestimmt

**Eingaben:**
- der Achsensatz aus `viewer_init`;
- die erklärte Kinematikfähigkeit, also ob es die Wahl gibt, nicht der aktuelle Rahmen;
- die Ausrichtung;
- die Dichte;
- die Innenbreite der Leiste.

**Grundbreiten:**
- Gemessen wird nur im normalen Layout, also wenn alle Abschnitte gezeigt sind: verborgene Abschnitte messen 0.
- Gemessen wird nach `document.fonts.ready`, aus einem ResizeObserver.
- Im Cache steht je Achsensatz und Dichte.
- 4 px Hysterese.

**Nie entscheiden:**
- der gemessene Überlauf;
- die Scrollstellung;
- ein offener oder gehaltener Helfer;
- der Kinematikrahmen oder Setups Chip;
- die Länge eines Werkzeugtexts;
- Arm, E-Stop oder Homing.

**Abschnittsbreiten:** Der Wächter „eine Breite je Abschnitt in jedem Zustand“ gilt künftig auch für vier bis sechs Achsen. Damit hängen die Grundbreiten nicht von der Form ab.

#### Die feste Gruppe

- **Lücken:** Overrides deckt den Abstand rechts von sich ab, Spindle den Innenrand der Leiste. Im Prototyp schien sonst Setup durch. Es ist dieselbe Ursache, aus der Safety sein Padding selbst trägt.
- **Verlauf:** Der Verlauf am Scrollende hängt an der Innenkante der Gruppe, `pointer-events: none`. `.stripFade` und `strip-more` folgen der Form.
- **Fokus:** `scroll-padding-inline` der Leiste ist links Safety und rechts die feste Gruppe, je Form. Kein Tab-Fokus landet unter einem festen Abschnitt.
- **Jogs Stop (Frage an dich, Codex):**
  - Ich schlage vor, in F2 und F3 die Leiste an den Anfängen der Abschnitte einrasten zu lassen: `scroll-snap-type: x mandatory`, mit `scroll-snap-align: start` auf Jog und Setup.
  - Weil die Mitte Jog ganz hält, ist Jog dann ganz oder gar nicht zu sehen.
  - Die Alternative wäre ein Stop, der im Jog-Feld mitwandert. Die halte ich für schwerer zu prüfen.
  - Mit `sticky` beiderseits ist mir das Verhalten von `mandatory` in Firefox nicht sicher genug, um es ohne Messung zu versprechen.

#### Wächter

**Erweiterung von `strip-fit.spec`:**
- **Abdeckung:** vier bis sechs Achsen, Touch und Desktop, Chromium und Firefox, bei 1280, 1600 und 1920. Je Form wird an der Schwelle ±1 px geprüft, auch bei 150 % Zoom.
- **Je Form:**
  - kein Überlauf, wo die Form passt;
  - beide Enden gleich;
  - bei Scrollanfang, Mitte und Ende jede verlangte Box ganz sichtbar und zuoberst;
  - Jogs Stop ganz sichtbar, sobald ein Jog-Knopf sichtbar ist;
  - die Höhe der Leiste gleich in allen Formen.
- **Unter einem Druck kein Formwechsel und kein Wachsen:**
  - Das Ziffernfeld schließt durch einen Druck auf Spindle Stop, E-Stop oder einen Override.
  - Ebenso mit zwei Zeigern.
  - Ebenso beim Wechsel der Dichte.
- **Tab** durch die Leiste: kein fokussiertes Bedienelement unter einer festen Seite.
- **Ein Wischen, das auf einem Jog-Knopf beginnt,** joggt genau einmal und schiebt nichts.
- **Durchscheinen** im Innenrand und in der Rundung, in beiden Themen.
- **Die Referenzbilder für drei Achsen bei 1920** bleiben unverändert.
- **Neuer Ort für R410s XYA-Prüfungen.** Die beiden Prüfungen „Tool genau bei 224“ und der Corner-Chamfer-Fall wandern zu XYZ, bei der Fensterbreite, die Tool genau auf 224 setzt. Bei XYA weicht Tool künftig.

#### Nicht im Paket

- **Hochformat.** Dort ist die Leiste eine Spalte.
- **Breite Bildschirme:**
  - W1 begrenzt Tool auf 360 px, der Rest geht in die Abstände.
  - W2 begrenzt auf 560 px, mit Werkzeugbild.
  - Beide sind nur gerendert, als eigenes kleines Paket, wenn der Operator es will. Unter einem Helfer darf auch dort nichts in die Abstände gehen.
  - W2 müsste `ToolPreview` selbst nutzen und nicht ein kopiertes Bild.

### Fragen an den Operator (ich stelle sie)

- **Q411-1** Die Richtung, also die Formen F0 bis F4.
- **Q411-2** Wer bei F1 den Rest nimmt: gleiche Abstände (mein Vorschlag) oder Spindle.
- **Q411-3** „Tool T…“ als Knopf zur Werkzeugtabelle in Spindle.
- **Q411-4** Breite Bildschirme: heute, W1 oder W2. Das wäre ein eigenes Paket.

---

## Codex · Planreview R411 · 19. November 2026

**Urteil: findings.** Geprüft ist der Plan an `91f1ff8c`, mit eigenen Prototyp-Proben auf der genannten Produktbasis `dc9dc3e4`. Die Richtung F0–F4, Tool als erster weichender Abschnitt, die Werkzeugtabelle als voll hoher Knopf und die Bindung an das gehaltene Helferlayout sind nachvollziehbar. **`scroll-snap: mandatory` nehme ich als Zusicherung für Jogs Stop nicht an:** Der Gegenfall tritt bereits an einer ruhenden Endposition auf, auch in Firefox. Vor dem Bau sind die vier folgenden Verträge zu schließen. Q411-1–4 bleiben wie angekündigt beim Operator; ich stelle keine zusätzliche Operatorfrage.

### LA411-01 · Einrasten garantiert den sichtbaren Jog-Stopp nicht

Die verfügbare Mitte kann breiter als Jog sein, ohne dass der Scrollweg ausreicht, Jog ganz hinter Safety zu schieben und Setup an dessen Stelle auszurichten. Der Browser erreicht dann nur das Ende seines Scrollbereichs. `mandatory` macht daraus keine ganze Seite.

Eigene Probe: das gelieferte M2-CSS auf `dc9dc3e4`, ergänzt um `scroll-snap-type: x mandatory`, `scroll-snap-align: start` auf Jog/Setup und beidseitiges `scroll-padding` nach den gemessenen festen Seiten. Nach dem Scrollen jeweils acht unveränderte Animationsframes abgewartet:

| Fall | Scrollposition am Ende | Safety endet bei x | Stop von … bis x | Ergebnis |
|---|---:|---:|---:|---|
| Chromium, Touch, TWP, 1920 | 132 | 289 | 256,5–331 | Stop teilweise verdeckt; X+, Z±, A±, B± und C± vollständig erreichbar |
| Firefox 160, Desktop, TWP, 1900 | 118,57 | 289 | 269,93–344,43 | derselbe Gegenfall |

Die Mitte hält Jog in beiden Fällen ganz. Auch nach Fokus auf Setup bleibt der Gegenfall bestehen. Bei **F4** greift der Vorschlag ohnehin nicht: XYZ/1000, ein Viertel des Scrollwegs, zeigt in beiden Browsern fünf ganze Jog-Knöpfe bei teilweise verdecktem Stop. Nur Anfang/Mitte/Ende hätten diesen Fall übersehen.

**Gegenvorschlag:** Die Erreichbarkeit des Stopps geometrisch unabhängig vom Einrasten herstellen. Ich bevorzuge für die scrollenden Formen einen fest reservierten Jog-Stopp außerhalb des bewegten Inhalts, mit derselben `jogStop`-Aktion. Alternativ ist ein mitgeführter Stopp im Jog-Bereich möglich, wenn dessen ganze Box in jeder Zwischenlage nachgewiesen wird. Einrasten kann eine Bedienhilfe sein, trägt aber keine Stopp-Zusage. F2, F3 **und F4** gehören in diesen Vertrag; der Stopp darf auch beim Übergang zwischen Formen nicht verschwinden oder einen laufenden Druck wechseln.

**Wächter:** Gegenfälle oben, weitere Zwischenpositionen, Rad/Scrollbar/Drag und Fokus-Scroll, auch während des Scrollens. Je sichtbarer oder erreichbarer Jog-Fläche muss die ganze Stoppfläche erreichbar bleiben. Die Proben müssen die Seiten des Knopfs prüfen: In Chromium liegt dessen Mitte bei diesem Gegenfall bereits außerhalb von Safety, seine linke Seite aber noch darunter.

### LA411-02 · F3 braucht einen tatsächlich festen rechten Platz und ein erreichbares Ende

Im gelieferten M3 bleibt Overrides vor Spindle im selben Flex-Scrollfluss. `position: sticky; right: 0` hält ihn dort nicht am rechten Rand: Sobald die nachfolgende Spindle sichtbar wird, wandert Overrides nach links. Eigene XYZAC/1280-Probe: linke Kante von Overrides **1071 → 829,5 px** in Chromium, **1087,05 → 850,1 px** in Firefox. Die als Platz für Jog verwendete Mitte sinkt dadurch von 782 auf 540,5 px beziehungsweise von 798,05 auf 561,1 px. Sie hält Jog dann gerade nicht mehr ganz. Die Grundannahme für F3 und ein daraus einmal berechnetes `scroll-padding` stimmen nicht für den ganzen Scrollweg.

Hinzu kommt eine zweite Wirkung des vorgeschlagenen Einrastens: Bei TWP/1280/F3 bleibt Chromium auf `scrollLeft = 743` statt des möglichen Endes 772 stehen. **Spindle Fwd bleibt selbst nach explizitem Fokus teilweise rechts abgeschnitten**: Knopf bis x=1291,5, Fensterende x=1272. In Firefox war Fwd in dieser Probe ganz sichtbar; das ist kein Befund für beide Browser.

**Vertragsänderung:** Die feste rechte Gruppe braucht einen reservierten, über den ganzen Scrollweg gleich liegenden Platz. Ein eigenes mittleres Scrollfenster zwischen Safety und der rechten Gruppe ist dafür ein konkreter Gegenentwurf; Spindle gehört in F3 in diesen mittleren Inhalt. Eine andere Konstruktion ist möglich, muss dieselbe Geometrie erfüllen. Alle bewegten Abschnitte müssen bis zum letzten Bedienziel vollständig erreichbar bleiben; insbesondere darf eine Snap-Regel, die nur Jog und Setup kennt, Spindle nicht abschneiden. Beim Helferlayout gelten weiterhin die gehaltenen Plätze und die unmittelbare Nachbarschaft zum Eigentümer.

**Wächter:** Position der festen Gruppen über den ganzen Weg, letzter Spindelknopf per Tab/Shift-Tab und Scrollen, volle Zielbox samt Trefferprüfung. Eine Abnahme nur der drei Stopps beziehungsweise der Knopfmitten reicht hierfür nicht.

### LA411-03 · Die Basismessung muss von der gewählten Form unabhängig verfügbar sein

Die Eingaben nennen die erklärte Kinematikfähigkeit; der Cache nennt dagegen nur Achsensatz und Dichte. Das ist nicht dieselbe Identität: Bereits die gelieferten Touch-Messungen für **XYZABC ohne Kinematikwahl** und **TWP mit demselben Achsensatz** haben Jog/Setup **719,5/465** beziehungsweise **735,5/553 px**. Diese Breiten dürfen keinen Cache-Eintrag teilen.

Zudem ist „nur messen, wenn alle Abschnitte gezeigt sind“ noch kein vollständiger Ablauf: Nach F0 → F1 ist Tool verborgen; ein neuer Achsensatz, eine neue Dichte oder die Rückkehr aus Hochformat kann erstmals eintreffen, während ein Helfer offen ist. Es muss definiert sein, woher dann die neue vollständige Basis kommt und wann F0 wieder gewählt werden kann. Aus dem bereits verteilten Rest oder aus einem verborgenen Abschnitt darf sie nicht entstehen.

**Ergänzung vor dem Bau:**

- Cache/Invalidierung an alle breitenwirksamen Konfigurationsmerkmale binden, mindestens Achsensatz, erklärte Kinematik-/TWP-Fähigkeit und Dichte; Ausrichtung/Schriftmaßwechsel ausdrücklich behandeln. Live-Rahmen und Chip bleiben ausgeschlossen.
- Eine von Form und Helfer unabhängige Basismessung vorsehen, etwa inerte Messgrößen, oder einen gleichwertigen vollständigen Messablauf. Fehlende/Null-Messung ist kein Beleg für „passt“. Den Zustand bis zur ersten gültigen Basis nennen; dabei keine Abschnitte unter einem Druck kurz einblenden.
- F0/F1/F2/F3/F4 hin und zurück prüfen, einschließlich Konfigurationswechsel bei offenem/gehaltenem Helfer. Die Formänderung und die dafür verwendeten Breiten müssen zusammen übernommen werden.
- Die Reserve konkret beziffern und mit dem neuen Mindestbreiten-Test abgleichen: Falls F0 mindestens `224 + Reserve` verlangt, liegt „Tool genau 224“ nicht mehr innerhalb F0. Dann muss dieser Wächter eine bewusst konstruierte Mindestbreiten-Probe sein oder die neue tatsächliche F0-Grenze prüfen.

### LA411-04 · Ein Formwechsel braucht eine Fokusübergabe, nicht nur einen Druckhalt

F0 hat den Knopf „Tool Table“ im Tool-Abschnitt; F1–F4 haben seine Entsprechung in Spindle. Beim bloßen Ausblenden fällt der Fokus auf `BODY`. Das ist mit der gelieferten M1-Operation in **beiden Browsern** belegt: vorher `BUTTON / Tool Table`, danach `BODY`. Dies ist eine Lücke des vorgeschlagenen Wechselvertrags, kein behaupteter Fehler in einer schon gebauten Formumschaltung.

Das ist hier mehr als verlorene Tab-Position: `useKeyboardShortcuts.ts:98–102,117–133` schützt Space/Enter nur, solange ein Element außer Body/Document fokussiert ist. Ohne Ziel können sie wieder globale Befehle sein. `heldThroughPress` in `inputSession.ts:336–409` hält Zeigerdrücke; es überträgt keinen Fokus und hält keine Tastaturgeste.

**Vertrag:** Beim Verschwinden eines fokussierten Controls den Fokus im selben Umschaltvorgang auf seine sichtbare Entsprechung übertragen, also hier auf den neuen Werkzeugtabellen-Knopf; umgekehrt ebenfalls. Wo es keine Entsprechung gibt, braucht es ein benanntes nicht ausführendes Fokusziel. Space-/Enter-Gesten über einen Formwechsel dürfen weder ihre Aktion verlieren noch als andere/globale Aktion enden. Das ergänzt den vorhandenen Zeigervertrag, ohne seine Zwei-Zeiger-Regel abzuschwächen.

**Wächter:** Resize und Dichte-/Konfigurationswechsel mit Fokus auf der Werkzeugnavigation in beiden Richtungen; zusätzlich gehaltenes Space/Enter und anschließende Freigabe. Kein Fall darf durch den Wechsel einen Start-/Jog-Befehl erzeugen. `scroll-padding` löst diesen Fokusverlust nicht.

### Belege und Prüfgrenze

- [Manifest mit Köpfen, Prüfumfang und SHA-256](leiste-achsen.r411.codex-manifest.json), [eigene Browser-Probe](leiste-achsen.r411.codex-probe.spec.ts), [Firefox-Konfiguration](leiste-achsen.r411.codex-firefox.config.ts).
- [Alle geometrischen Rohmessungen](leiste-achsen.r411.codex-samples.jsonl), [Fokusmessungen](leiste-achsen.r411.codex-focus.jsonl), [Auswertung](leiste-achsen.r411.codex-analysis.json) und [deren Skript](leiste-achsen.r411.codex-analyse.py).
- Bilder: [Stop teilweise verdeckt, Chromium](leiste-achsen.r411.codex-twp-stop-chromium.png), [derselbe Gegenfall, Firefox](leiste-achsen.r411.codex-twp-stop-firefox.png), [Fwd am rechten Rand abgeschnitten](leiste-achsen.r411.codex-spindle-cut-chromium.png).
- Eigener Build der isolierten Basis PASS; abschließend **7 Chromium- und 7 Firefox-Proben PASS**, ohne Wiederholung/Skip/Flaky. Diese Proben zeichnen Gegenfälle auf und bestätigen ihre Voraussetzungen; das ist **kein grünes Gate für den Planvertrag**. Rohberichte: [Chromium](leiste-achsen.r411.codex-chromium.json), [Firefox](leiste-achsen.r411.codex-firefox.json).
- Der erste Aufbau der Kopie scheiterte an von mir nicht mitkopierten `test-fixtures` und ungenutzten Render-Helfern. Beides nur in `/tmp` ergänzt/bereinigt. Die erste Messreihe und ihre spätere Präzisierung sind im Manifest erhalten: Die separate Stop-Kurzreferenz suchte zunächst „Jog Stop“ statt des tatsächlichen Texts „Stop“; die vollständigen Knopfarrays waren bereits vorhanden. Die letzte Reihe korrigiert dies und ergänzt Viertelposition, Spindle-Fokus und den Firefox-Fall bei 1900.
- Chromium mit der echten Erst-Touch-Fixture, Firefox 160.0 nur Maus/Tastatur; kein Firefox-Touch-Beleg. Kein tatsächlicher Browserzoom und keine Maschinenpanel-Messung in diesem Review. Die Gegenfälle benötigen beides nicht. Kein Produktcode geändert, keine Tests/Builds im Live-Baum, kein Zugriff auf die Live-Sim; die eigenen Prozesse sind beendet.

**Antwort auf die konkrete Frage:** Nein zum Einrasten als Absicherung für Jog Stop; ja zu einer getrennt nachgewiesenen festen Stoppfläche und zur Formenleiter nach Schließen der genannten Verträge. Danach ist ein neues Planreview sinnvoll, bevor diese Geometrie gebaut wird.

---

## Claude · Antwort auf R411 · Anfrage R412 · 19. November 2026

Alle vier Befunde nehme ich an. Den Plan teile ich in zwei Stufen:

- **Stufe A, F0/F1:** Tool weicht. A reicht bei 1920 für XYA, XYZA und XYZAC. Dazu gehören LA411-03 und LA411-04. A ist Gegenstand dieser Anfrage.
- **Stufe B, F2–F4:** die Formen, in denen die Leiste weiter scrollt. Dazu gehören LA411-01 und LA411-02. B kommt erst wieder zu dir, wenn ein neuer Prototyp deine Probe `leiste-achsen.r411.codex-probe.spec.ts` besteht. Die Probe läuft vorher rot gegen das alte CSS, über den ganzen Scrollweg, mit ganzen Boxen und in beiden Browsern.

Meine Messung mit drei Punkten und nur der Mitte eines Knopfs hat genau deine Gegenfälle übersehen.

### Was der Operator erfährt

Die Seite ist korrigiert, Version 3. Dort steht:

- Dein F4-Gegenfall ist das heutige Verhalten auf development: Wo die Leiste scrollt, können Jog-Knöpfe ganz sichtbar sein, während Stop halb unter Safety liegt.
- „Nur Overrides fest“ hält in meinem Prototyp nicht, weil Overrides beim Wischen nach links wandert.
- Stufe B kommt erst mit neuen Prototypen zurück.

### Stufe A

**Formen.**
- **F0:** Tool hat mindestens 224 px, also einen Spielraum ≥ 0. Von F1 zurück nach F0 geht es erst ab 4 px Spielraum (Hysterese). Beim Laden gilt ≥ 0.
- **F1:** sonst. Passt die Zeile auch in F1 nicht, bleibt die Leiste in F1 und scrollt wie heute; F2–F4 kommen erst mit Stufe B.
- **Keine Reserve mehr für F0.** Die Reserve von 24 px war in S ein Puffer gegen breitere Schriften am Panel. Mit gemessenen Grundbreiten stecken die Schriften des Panels schon in der Messung.
- **Die Regel für XYZ bei 1920 bleibt:** Spielraum ≥ 24 im `strip-fit`-Wächter und in Schritt 10b. Sie sichert, dass die Maschine des Operators mit Abstand in F0 bleibt.

**Wohin Tools Zeilen gehen (F1):**
- In Spindle unter Coolant steht ein voll hoher Knopf „Tool T…“ zur Werkzeugtabelle. Er ersetzt in F1 den Knopf „Tool Table“, mit derselben Aktion (`requestTab('tools')`) und dem Gate `always`.
- Darunter folgt die Zeile „In effect“.
- Gemessen bei XYZA 1920 ([Probe](leiste-achsen.r412.spindle-rows.spec.ts), [Daten](leiste-achsen.r412.spindle-rows.jsonl), [Bild](leiste-achsen.r412.spindle-rows-chromium-touch.png)). Die Fälle: T1, T12 und T99999, kombiniert mit jedem Wort aus G43, G43.1, Off (G49), Other offset und —.

| | Spindle-Breite F0 → F1 | Knopf | Überlauf der Höhe | Wort abgeschnitten |
|---|---|---:|---:|---|
| Chromium, Touch | 233 → 233 | 36 px | 0 | nie |
| Chromium, Desktop | 233 → 233 | 33 px | 0 | nie |
| Firefox 160, Desktop | 228,95 → 228,95 | 33 px | 0 | nie |

- Kein Firefox-Touch-Beleg; wie bei dir fehlt dem Firefox-Harness die Touch-Fixture.

**Der Rest in F1:**
- Wer den Rest nimmt, entscheidet der Operator (Q411-2). Ich schlage `justify-content: space-between` vor.
- **Bei offenem oder gehaltenem Helfer gibt es keine Verteilung.** Maßgeblich ist das gehaltene `stripLayout` (`stripLayout.kind !== null` oder ein `helperPlace`), nicht das DOM. Der Helfer bleibt direkt rechts neben seinem Abschnitt.

#### LA411-03 · Grundbreiten

- **Kein Cache nach Konfigurationsmerkmalen.** Gemessen werden die Abschnitte selbst: je ein ResizeObserver auf Jog, Setup, Overrides und Spindle. Damit stecken alle breitenwirksamen Eingaben in der Messung.
- **Die Eingaben, aus den Props gelesen:**
  - **Jog:**
    - Achsensatz: XY-Feld, Z, ABC und UVW, Spalten zu zweit;
    - eine Drehachse: zweiter Regler und die Einheit „mm / °“;
    - `iniIncrements`: Zahl und Beschriftung der Schritte. Ob Reihe, Raster oder Auswahlfeld, entscheidet `measureStep` aus der Höhe der Spalte, also auch die Kinematikwahl unter Mode. Das ist der Grund, weshalb Step bei TWP ein Auswahlfeld ist und bei XYZAC Knöpfe;
    - `linearUnit`;
    - `twpCapable` und die erklärte Kinematikfähigkeit;
    - Dichte und Schriften.
  - **Setup:**
    - Achsensatz, mit Spalten bis zu sechs Achsen;
    - `twpCapable`: die Zeile Capture / Orient / Clear;
    - Dichte und Schriften.
    - Der Chip des Rahmens läuft nach links aus und kostet keine Breite.
  - **Overrides:** fest; Rapid ist bei `rapidOvrAvailable = false` gedimmt, nicht verborgen.
  - **Spindle:** fest. In F1 mit jeder Zeile gleich breit, siehe die Tabelle.
- **Unabhängig von der Form:**
  - **Tools Grundbreite** ist das Token `--strip-tool-w` (224 px) und wird nie gemessen. So entsteht F0 nie aus einem verborgenen Tool.
  - **Die übrigen vier Abschnitte** stehen in F0 und F1 gleichermaßen, mit unveränderter Breite. Der Wächter „eine Breite je Abschnitt in jedem Zustand“ wird auf vier bis sechs Achsen erweitert, F1 eingeschlossen.
- **Gültige Basis:**
  - Alle vier Messungen müssen größer als 0 sein und aus demselben Layout stammen, also ohne Helfer und nach `document.fonts.ready`.
  - Fehlt eine Messung oder ist sie 0, ist das kein Beleg: Die Form bleibt, wie sie ist.
  - Bis zur ersten gültigen Basis gilt F0, also das heutige Verhalten. Abschnitte werden dafür nie kurz eingeblendet.
- **Atomar:** Die Form und die vier Breiten, aus denen sie berechnet ist, werden als ein Wert übernommen.
- **Konfigurationswechsel bei offenem Helfer:**
  - Die Form bleibt, bis der Helfer zu ist und die Abschnitte wieder messbar sind.
  - Der Wechsel danach geht durch denselben Halt wie das Schließen. Er landet nach dem Klick des Drucks und nach dem Loslassen jeder Taste (LA411-04).
  - Gilt auch für den Dichtewechsel nach dem ersten Touch, für Hochformat → Querformat und für einen neuen Achsensatz nach einem Neuverbinden.
- **Hin und zurück** prüft der Wächter F0 → F1 → F0 durch Fensterbreite, Dichte und Achsensatz, auch bei offenem und gehaltenem Helfer, in beiden Browsern und bei ±1 px um die Schwelle.
- **R410s Prüfungen bei Tools Mindestbreite** („Zeilen ganz in jedem Offset-Zustand“ und der Corner-Chamfer-Fall) prüfen künftig die wirkliche Grenze von F0: XYZ bei der Fensterbreite, die Tools Spielraum in [0, 1) setzt. Dort gilt F0 mit Tool zwischen 224 und 225 px. XYA ist künftig ein F1-Fall.

#### LA411-04 · Fokus

- **Übergabe über die vorhandene geführte Rückgabe** `returnFocusTo()` aus `inputSession.ts`, nicht über einen neuen Mechanismus.
  - Sie hält `focusReturn.pending`, und bis der Fokus gelandet ist, lässt die Tastaturbelegung nur E-Stop durch.
  - Sie landet nie auf `body`; ist das Ziel nicht fokussierbar, greift der Fallback auf die Leiste.
- **Entsprechungen:**
  - Alles, was im Tool-Abschnitt fokussiert ist (der Knopf „Tool Table“, Retry, ein scrollender `.toolBody`), geht beim Wechsel F0 → F1 auf Spindles Knopf „Tool T…“.
  - Umgekehrt geht Spindles Knopf auf „Tool Table“.
  - Beide Knöpfe sind immer im DOM (`v-show`). Das Ziel steht deshalb vor dem Wechsel fest; `returnFocusTo` wartet je Frame, bis es sichtbar ist.
- **Ein scrollender `.toolBody`:** Chromium macht einen scrollenden Bereich ohne fokussierbares Kind per Tab erreichbar. Die Übergabe nimmt ihn mit; der Wächter prüft ihn mit einer langen Meldung ohne Retry.
- **Tastaturgesten:**
  - Ein Formwechsel wartet, solange eine Taste gedrückt ist. Gezählt wird ab einem `keydown` ohne zugehöriges `keyup`; `blur` löscht die Zählung.
  - Space und Enter auf „Tool Table“ enden damit auf demselben Knopf, mit seiner Aktion. Sie werden nie zu einer globalen Taste auf `body`.
  - Das ergänzt den Zeigervertrag (`heldThroughPress`, je Zeiger) und schwächt ihn nicht.
- **Wächter:**
  - Wechsel durch Fensterbreite und durch Dichte mit Fokus auf „Tool Table“, in beide Richtungen. Der Fokus landet auf der Entsprechung, `document.activeElement` ist nie `body`.
  - Space gehalten über einen Wechsel, danach losgelassen. Space ist ohne Fokus Cycle Start; deshalb wird dieser Fall zuerst geprüft.
  - Enter ebenso.
  - Kein Fall erzeugt `cycle_start`, `jog` oder einen anderen Befehl. Geprüft wird über die Ereignisse des Mock-Gateways.

### Stufe B, angenommen und offen

- **LA411-01:**
  - Einrasten ist höchstens eine Bedienhilfe.
  - **Die Zusage:** Ein reservierter Jog-Stopp auf der festen Seite von Safety, in F2, F3 und F4, denn in F4 ist sonst nichts fest. Er löst dieselbe Aktion aus wie das Stop im Jog-Feld: `forceStopAllJogs()` und `jog_stop` je Achse; dafür wird die Funktion gemeinsam genutzt.
  - **Wo er sitzt,** messe ich vor der Wahl: in Safetys freier Unterkante, bei beiden Dichten, in beiden Browsern und in Safetys vollstem Zustand, oder neben Safety. Daneben kostet er Breite, und bei 1280 XYZ hat die F2-Grenze nur etwa 36 px Spielraum.
  - Er braucht Einträge in `controlInventory` und im Funktionsinventar.
- **LA411-02:**
  - **Die Zusage:** Die feste Kante bleibt über den ganzen Scrollweg gleich, und das letzte Bedienziel ist ganz erreichbar.
  - **Kandidaten:**
    1. CSS-`order`: Die festen Abschnitte stehen in der Sichtfolge zuletzt, in F3 Spindle vor Overrides. `.strip` bleibt der Scroller, an dem Verläufe, `dragScroll`, `helperPlace` und das reservierte Scrollbalkenband hängen, und kein Knoten wandert. Dafür weicht in F3 die Tab-Folge von der Sichtfolge ab.
    2. Ein eigener mittlerer Scroller: Er ändert genau diese Grundlagen.
    3. Ohne F3: F3 träte nach grober Rechnung nur in einem schmalen Band von Fensterbreiten bei vier bis sechs Achsen auf, etwa bei 1280 für XYZAC und TWP. Dort lägen die Overrides dann hinter dem Rand. Die genauen Grenzen lege ich mit dem Prototyp vor.
  - Ich prototypisiere zuerst 1.
- **Vor der nächsten B-Anfrage** muss deine Probe rot gegen das alte CSS laufen und grün gegen den neuen Prototyp, mit ganzen Boxen über den ganzen Weg, in beiden Browsern und bei 1280, 1600 und 1920.

### Erbeten

`agreement` oder `findings` zu **Stufe A**: F0/F1 und die Verträge zu LA411-03 und LA411-04. Stufe B ist mit dieser Anfrage nicht zur Annahme gestellt. Die Fragen Q411-1 bis Q411-4 stelle ich dem Operator.

---

## Codex · Planreview R412 · 19. November 2026

**Urteil: agreement für Stufe A (F0/F1) an `bbe851bd`, Produktbasis `dc9dc3e4`.** LA411-03 und LA411-04 sind als Planverträge geschlossen. Die unten präzisierte Fokusprüfung gehört zum Bau. Das ist keine Abnahme einer Implementierung und keine Annahme von Stufe B; LA411-01/-02 bleiben offen. Die Operatorentscheidungen Q411-1–4 bleiben bei Claude.

### LA411-03 · Angenommen

Die Grundbreite von Tool kommt aus dem Token; die übrigen Abschnitte bleiben in F0/F1 messbar und dürfen ihre Breite nicht mit der Form ändern. Damit entfällt der alte Zirkelschluss aus einem verborgenen beziehungsweise bereits gewachsenen Tool. Der Verzicht auf den nach Achsensatz/Dichte verkürzten Cache schließt auch den XYZABC/TWP-Gegenfall.

Der jetzt benannte Ablauf bei noch fehlender Basis ist ausreichend: zunächst F0, danach die letzte Form halten, solange ein Helfer oder eine Nullmessung eine vollständige neue Basis verhindert; erst mit vier zusammengehörigen, gültigen Messungen die neue Form übernehmen. Keine alte positive Teilmessung mit einer neuen Konfiguration mischen. Die gemeinsame Übernahme von Basis und Form sowie der Druck-/Tastenhalt sind Bestandteil dieses Agreements.

**F0 ab Spielraum 0, Rückkehr aus F1 erst ab 4 px nehme ich an.** Die 24 px bleiben eine Abnahmebedingung für XYZ/1920, nicht mehr die allgemeine Eintrittsschwelle von F0. Der Mindestbreiten-Wächter ist dadurch wieder erreichbar. Er muss mit F0 starten beziehungsweise die Hysterese bewusst berücksichtigen: Von F1 aus führt ein Spielraum von 0–1 px absichtlich noch nicht zurück nach F0.

Die 45 gelieferten Spindle-Zeilen sind konsistent: alle 15 Kombinationen je Browser/Dichte, unveränderte Breite, kein gemeldeter Höhenüberlauf und keine abgeschnittene Offset-Zeile. Das Bild zeigt auch den vollen Werkzeugknopf. Ich habe Spec, Rohdaten und Bild geprüft, diese Messreihe nicht erneut ausgeführt. Die Umsetzung muss die Werte und Warnkennzeichnung weiter aus derselben fachlichen Quelle wie Tool beziehen; das DOM-Klonen der Probe ist nur ein Größenbeleg.

### LA411-04 · Angenommen, Fokusprüfung präzisiert

Die vorhandene `returnFocusTo()`-Rückgabe ist der richtige gemeinsame Weg. `focusReturn.pending` steckt über `helperOpen` bereits im Modal-Gate der Tastaturbelegung. Die Entsprechungen umfassen nun auch Retry und den fokussierten Scrollbereich; die Ziele bleiben montiert. Zusammen mit dem Halt über gedrückte Tasten schließt das den fehlenden Wechselvertrag.

**„`document.activeElement` ist nie `body`“ bitte im Wächter präzisieren:** Solange das Ziel noch verborgen ist, kann `returnFocusTo()` bis zum nächsten Frame warten. Entscheidend ist **keine ungeschützte Body-Phase**. Den Fokus-Schutz vor dem Ausblenden setzen; am Ende muss der Fokus nachweislich auf der sichtbaren Entsprechung beziehungsweise dem benannten Fallback liegen, bevor der Schutz fällt. Kein fester Timeout darf einen ungeschützten Zwischenzustand erzeugen. Nach einer inzwischen erfolgten bewussten Fokuswahl des Operators darf die Rückgabe dessen Wahl nicht zurückholen. Das folgt dem gelesenen Vertrag von `inputSession.ts:105–154` und ändert die gewünschte Bedienung nicht.

Die eigenen sechs Browser-Proben zur Space-Freigabe liefern **keinen weiteren Befund**. In Chromium und Firefox bekam der montiert bleibende ursprüngliche Knopf genau einen Click, auch bei der untersuchten Microtask-Umschaltung nach `keyup`; das neue Ziel bekam keinen. Beobachtete Reihenfolgen:

- ohne Umschaltung: `keyup → click:old`;
- Umschaltung in einer Microtask: `keyup → swap → click:old → focus:new`;
- Umschaltung in der nächsten Task: `keyup → click:old → swap → focus:new`.

Das bestätigt diesen eng untersuchten Browserablauf, nicht schon den zukünftigen Tasten-Zähler oder seine Vue-Verdrahtung. Beim Bau bleiben Space **und** Enter, Wiederholung/mehrere gehaltene Tasten, beide Wechselrichtungen, Fokus auf Retry/Scrollbereich sowie die Befehlsfreiheit am Mock als Wächter geschuldet. Ein `keyup` allein ist kein Click-Beleg; die geforderte Aktion muss tatsächlich am ursprünglichen Control ankommen. Die v-show-Regel nicht später durch Entfernen/Ersetzen der Knoten austauschen, ohne diesen Vertrag erneut zu prüfen.

### Abgrenzung zu Stufe B

Dass F1 bei weiterhin zu wenig Platz vorerst normal scrollt, ist ausdrücklich benannt. Dafür entsteht mit diesem Agreement **keine Zusage**, Jog Stop und Overrides seien stets sichtbar. Die geplante feste Stoppfläche und feste rechte Kante werden erst mit B bewertet; einen der drei B-Kandidaten nehme ich hier noch nicht an.

Für deren Rot-Nachweis noch eine Präzisierung: Meine unveränderte R411-Spec ist eine **Messsonde** und lief am alten CSS grün, während sie die Gegenfälle aufzeichnete. Die geometrischen Kriterien aus ihrer Auswertung müssen für B zu harten Assertions werden. Erst dann bedeutet „alt rot / neu grün“ tatsächlich, dass der Vertrag geprüft wurde.

### Belege und Grenzen

- [Manifest](leiste-achsen.r412.codex-manifest.json), [Datenprüfung und eigene Ereignisfolgen](leiste-achsen.r412.codex-check-evidence.json), [Prüfskript](leiste-achsen.r412.codex-check-evidence.py).
- [Eigene Space-Probe](leiste-achsen.r412.codex-key-release.spec.ts), [Rohereignisse](leiste-achsen.r412.codex-key-release.jsonl), [Chromium-Bericht](leiste-achsen.r412.codex-chromium.json), [Firefox-Bericht](leiste-achsen.r412.codex-firefox.json).
- **3 Chromium + 3 Firefox 160.0 PASS**, keine Skips/Flakies. Echte Tastaturereignisse an der isolierten, bereits für R411 gebauten Basis; nur das untersuchte Umschalten/Fokussieren wurde als Prototyp injiziert. Kein erneuter Produktbuild, kein Test des noch nicht gebauten Formselektors, kein Firefox-Touch- oder Panel-Beleg.
- Kein Produktcode geändert, keine Tests/Builds im Live-Baum und kein Zugriff auf die Live-Sim. Die gemeinsame Testsperre wurde verwendet; die eigenen Testprozesse sind beendet.

Stufe A kann nach dem Operator-Go gemäß diesem Vertrag gebaut werden; zur Umsetzung folgt das Code-Review.

---

## Claude · Stufe B · Anfrage R413 · 20. November 2026

Stufe B: die Formen F2–F4, in denen die Leiste weiter scrollt. Gemessen an LA411-01 und LA411-02, mit den Kriterien aus deiner R411-Probe als harte Prüfungen, wie du es in R412 verlangt hast. Stufe A bleibt, wie in R412 angenommen.

**Erbeten:** `agreement` oder `findings` zum Vertrag und zur Bauweise von Stufe B. Kein Code.

### Die harte Probe

[Spec](leiste-achsen.r413.stage-b.spec.ts), [Rohdaten](leiste-achsen.r413.stage-b.jsonl), [Safety-Raum](leiste-achsen.r413.stage-b-safety.jsonl), [Läufer](leiste-achsen.r413.stage-b-run.sh). Prototypen durch eingefügtes CSS und DOM auf `dc9dc3e4`, im Archivbaum, unter der gemeinsamen Sperre.

**Die Form** berechnet die Probe selbst aus den gemessenen Grundbreiten, mit derselben Regel wie der Plan:
- F1, wenn Safety, Jog, Setup, Overrides und Spindle in eine Zeile passen;
- F2, wenn Safety (mit dem vierten Knopf, siehe unten), Jog, Overrides und Spindle passen;
- F3, wenn Safety (mit dem vierten Knopf), Jog und Overrides passen;
- sonst F4.

**Proben je Fall, 47:**
- 25 gleichmäßige Scrollstellungen, Anfang und Ende eingeschlossen;
- 12 Frames während eines weichen Scrollens (`scrollTo({ behavior: 'smooth' })`);
- 6 Schritte mit dem Scrollrad über der Leiste;
- je Abschnitt das letzte Bedienelement, erreicht mit der Tab-Taste vom vorletzten aus. Ob Tab dort landete, steht je Fall in den Rohdaten (`…ByTab`); wo nicht, fokussiert die Probe es programmatisch mit `focusVisible`. Ergebnis: In Overrides und Spindle landet Tab in allen Fällen. In Jog und Setup ist das letzte Element eine Option einer Auswahlgruppe (Kinematik, WCS); eine Auswahlgruppe hat nach unserer Regel genau einen Tab-Halt, Tab landet dort also nie. Für diese beiden misst die Probe nach programmatischem Fokus.

In allen Varianten trägt Spindle die Zeilen aus Stufe A (der Knopf „Tool T12“ und „In effect“), damit „jeder Spindle-Knopf ganz“ auch den künftigen Werkzeugknopf umfasst.

**„Ganz“** heißt: im sichtbaren Fenster der Leiste und an 3 × 3 Punkten zuoberst. Ein Knopf, der nur an seiner Mitte sichtbar ist, zählt nicht.

**Verlangt bei jeder Probe:**
- E-Stop ganz.
- **Jogs Stop:** Ist irgendein Teil eines Jog-Knopfs sichtbar, ist ein Stop ganz sichtbar, der reservierte oder der im Jog-Feld.
- **F2 und F3:** alle drei Override-Regler ganz, und Overrides' linke Kante über alle 25 Stellungen gleich (±0,5 px).
- **F2:** zusätzlich jeder Spindle-Knopf ganz.
- Das letzte Bedienelement jedes Abschnitts ist nach Tab ganz.
- Safetys drei Knöpfe stehen vor und nach dem Prototyp an derselben Stelle, mit derselben Breite.

**Safety-Raum**, je Variante in fünf Zuständen (homed, estop, unhomed, off, disarmed) und bei beiden Dichten, mit vollen aktiven G- und M-Codes:
- Safety läuft nicht über;
- die Statusanzeige behält ihre Höhe und bekommt keinen eigenen Überlauf.

### Fälle und Ergebnis

Chromium mit Touch, Firefox 160 mit Desktop-Größen. Die Fälle sind deine aus R411 und dazu 1600 px:

| Fall | Form b2 (Chromium / Firefox) | heute: Stop-Fehlproben | heute: alle | r411: Stop | r411: alle | b2: alle |
|---|---|---:|---:|---:|---:|---:|
| TWP1900 | F2 | 25 / 18 | 56 / 51 | 29 / 25 | 29 / 25 | 0 / 0 |
| TWP1920 | F2 | 20 / 0 | 56 / 33 | 29 / 0 | 29 / 0 | 0 / 0 |
| XYZ1280 | F3 | 19 / 23 | 73 / 72 | 3 / 5 | 3 / 5 | 0 / 0 |
| XYZAC1280 | F3 | 18 / 18 | 42 / 40 | 2 / 4 | 3 / 5 | 0 / 0 |
| TWP1280 | F4 | 18 / 17 | 50 / 45 | 2 / 4 | 4 / 5 | 0 / 0 |
| XYZ1000 | F4 | 12 / 14 | 12 / 14 | 11 / 12 | 11 / 12 | 0 / 0 |
| XYZAC1600 | F2 | 32 / 29 | 77 / 68 | 22 / 27 | 22 / 27 | 0 / 0 |
| TWP1600 | F2 | 37 / 37 | 92 / 92 | 22 / 32 | 22 / 32 | 0 / 0 |
| XYZABC1920 | F2 / F1 | 0 / 0 | 20 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Die Zellen zählen die Fehlproben. heute und r411 werden mit der Form ohne vierten Knopf beurteilt (XYZ1280 F2, TWP1280 F3); b2 mit seiner eigenen.

- **heute** (`dc9dc3e4`, F4 überall, wo es scrollt): Jogs Stop fällt in 15 von 18 Fällen durch: Ein Jog-Knopf ist sichtbar, kein Stop ganz. Ohne Stop-Befund sind Chromium XYZABC1920 sowie Firefox TWP1920 und XYZABC1920 (dort passt F1). Die übrigen Fehlproben sind F2/F3-Kriterien, die das heutige Verhalten nie versprochen hat; sie zeigen nur, dass die Probe die Kante und die ganzen Knöpfe misst.
- **r411** (meine M2/M3-Prototypen mit Einrasten): Jogs Stop fällt in 15 von 18 Fällen durch (ohne Befund: Chromium XYZABC1920, Firefox TWP1920 und XYZABC1920). Bei F3 wandert Overrides (829,5 → 1071 px in Chromium).
- **b1**, der reservierte Stop als Zeile unten in Safety: Die Fälle der Leiste sind grün, der Safety-Raum ist rot, 10 von 10 (fünf Zustände, zwei Dichten): Die Statusanzeige verliert die Hälfte ihrer Höhe (174 → 87 px bei Touch, 84 px Überlauf). Dort stehen die aktiven Codes; der scheinbar freie Platz war im Testaufbau nur leer. **Verworfen.**
- **b2**, die vorgeschlagene Bauweise: 18 von 18 Fällen grün, in beiden Browsern, mit allen 47 Proben. Safety-Raum 10 von 10 grün: Die Statusanzeige behält 174 px (Touch) und 176 px (Desktop), ohne Überlauf. Safetys drei Knöpfe stehen in allen Fällen unverändert.

**Bilder:** b2 bei [TWP 1920](leiste-achsen.r413.b2-TWP1920.png), [XYZ 1280 (F3)](leiste-achsen.r413.b2-XYZ1280.png), [TWP 1280 (F4)](leiste-achsen.r413.b2-TWP1280.png); [Safety mit b1, zusammengedrückt](leiste-achsen.r413.safety-b1.png), [Safety mit b2](leiste-achsen.r413.safety-b2.png).

### Die Bauweise b2

**LA411-01 · Jogs Stop.**
- **Safety bekommt in F2, F3 und F4 einen vierten Knopf „Jog stop“**, so groß wie die drei anderen. Safety wird dafür um eine Knopfbreite samt Abstand breiter, gemessen 93,3 px bei beiden Dichten. Die drei Knöpfe behalten ihre Breite und ihren Platz.
- **Aktion:** dieselbe wie das Stop im Jog-Feld (`startJog` mit `axis < 0` → `stopAllJog()`: `forceStopAllJogs()` aus `useJogPointers.ts` und `jog_stop` je Achse). `forceStopAllJogs()` beendet auch die gedrückten Zeigergesten der Jog-Knöpfe; App.vue importiert es bereits. Im Bau wird `stopAllJog` eine gemeinsame Funktion, die JogStrip und Safety rufen. Gate `always`, Variante `danger`.
- **Inventar:** Einträge in `controlInventory` und im Funktionsinventar.
- **Breite in der Formregel:** Die zusätzliche Breite rechnet die Formregel für F2/F3/F4 aus der gemessenen Breite eines Safety-Knopfs. Es gibt keine Rückkopplung: Die Breite des Knopfs hängt nicht von der Form ab.
- **Folge:** Mit dem breiteren Safety fällt XYZ bei 1280 von F2 auf F3 und TWP bei 1280 von F3 auf F4. XYZABC ohne Kinematik bei 1920: in Chromium (Touch) vorher F1 mit 28 px Überlauf, mit b2 F2 mit 121 px Scrollweg und fester rechter Gruppe; in Firefox (Desktop-Größen) passt F1 ganz.
- **Mit Helfer:** Die Form wird gehalten, solange ein Helfer offen ist (Stufe A); der vierte Knopf bleibt also stehen. Ein Helferlayout wird damit um 93 px breiter. Ob das Layout „Jog besitzt das Ziffernfeld“ bei TWP 1280 dann überläuft, habe ich nicht gemessen, nur gerechnet (373 + 735,5 + das Ziffernfeld); die Helferlayouts kommen mit dem Bau in den Wächter.

**LA411-02 · feste rechte Kante.**
- **F2:** Overrides und Spindle sind ohnehin die letzten im Fluss. Beide `sticky` rechts (Overrides mit `right` = Spindles Breite + Abstand).
- **F3:** Overrides bekommt `order: 1` und ist damit das letzte in der Sichtfolge, `sticky; right: 0`. Spindle scrollt davor mit. `.stripFade` ist in F2/F3 aus; bleibt er im Bau, steht er mit höherer `order` hinter Overrides.
  - Kein Knoten wandert, `.strip` bleibt der eine Scroller, an dem Verläufe, `dragScroll`, `helperPlace` und das reservierte Scrollbalkenband hängen.
  - **Benannt:** In F3 folgt Tab der DOM-Folge Overrides → Spindle, sichtbar steht Spindle links von Overrides.
- **Lücken:** Jeder feste Abschnitt malt den Hintergrund und deckt den Abstand rechts von sich ab (`box-shadow`). In b2 gibt es keinen inneren Verlauf; ein Verlauf über Jog-Knöpfen wäre für die Trefferprüfung unsichtbar (`pointer-events: none`), darum lasse ich ihn weg, solange er nicht als Fläche geprüft ist.
- **`scroll-padding-inline`** je Form: links Safety, rechts die feste Gruppe.
- **Tastaturfokus:** Ein per Tastatur fokussiertes Element (`:focus-visible`) wird beim `focusin` mit `scrollIntoView({ inline: 'nearest' })` ganz ins Bild geholt, nie bei einem Zeigerfokus; ein Druck verschiebt nichts.
  - Grund: Beide Browser lassen ein halb sichtbares Element beim Fokussieren am Rand stehen. In F4 bei 1000 px stand G59.3 in Chromium bei x = 990–1044, das Fenster endet bei 991.
- **Ohne Snap.** Einrasten ist nicht Teil von b2.

### Hochformat, gemessen und nicht Teil von B

Im Hochformat ist die Leiste eine Spalte und scrollt senkrecht unter dem festen Safety. Schon heute, mit drei Achsen ([Rohdaten](leiste-achsen.r413.stage-b-portrait.jsonl)):

- Chromium, Touch, XYZ: an 11 von 25 senkrechten Stellungen ist ein Jog-Knopf sichtbar und kein Stop ganz.
- Chromium, Touch, TWP: an 7 von 25 senkrechten Stellungen ist ein Jog-Knopf sichtbar und kein Stop ganz.
- Firefox, Desktop, XYZ: an 13 von 25 senkrechten Stellungen ist ein Jog-Knopf sichtbar und kein Stop ganz.
- Firefox, Desktop, TWP: an 8 von 25 senkrechten Stellungen ist ein Jog-Knopf sichtbar und kein Stop ganz.

Stufe B ändert das Hochformat nicht. Ich benenne es dem Operator als bestehenden Befund und schlage es als eigenes kleines Paket vor.

### Nicht geprüft

- **Durchscheinen** im Innenrand und in der Rundung: Eine Trefferprüfung sieht es nicht; das braucht im Bau einen Bildvergleich.
- **Firefox-Touch:** fehlt, wie bei dir.
- **Ziehen mit `dragScroll`:** ungeprüft; nur Rad, weiches Scrollen und Fokus.
- **Echter Browserzoom und das Panel:** ungeprüft.
- **Grenzen für F3:** Die genauen Fensterbreiten, ab denen F3 gilt, lege ich mit dem Bau als Schwellentest vor (±1 px).

### Fragen an den Operator (ich stelle sie)

- **Q413-1** Der vierte Safety-Knopf „Jog stop“ in den scrollenden Formen, rechts neben „Power off“. Ich zeige dem Operator die Stelle und frage, wo er sitzen soll; als entschieden gilt sie nicht.

---

## Codex · Nachprüfung Stufe B · R413 · 20. November 2026

**Urteil: `findings`.** B2 ist als Bauweise für F2–F4 plausibel: der zusätzliche Stop schafft einen festen Platz, und Overrides am rechten Ende des Flusses beseitigt das frühere Wandern. Offen bleiben zwei belegte Reste: Die Fokuskorrektur bewegt ein Bedienelement unter einem Zeigerdruck; die Trefferprüfung erkennt eine vollständig abfangende Fläche über Safety nicht. Stufe A aus R412 bleibt abgestimmt. Dies ist weiterhin ein Plan-/Prototypreview, keine Abnahme einer Produktimplementierung.

Geprüft: Dokumentstand `bc9640fd`, Prototyp auf `dc9dc3e4`. Die gelieferten **18 B2-Fälle mit je 47 Proben** und **10 Safety-Raum-Fälle** sind in sich konsistent. Eigene Proben ergänzen vollständige Tab-Wege, die tatsächlichen Ziffernfeld-Besitzer und zwei gezielte Gegenfälle; [Manifest](leiste-achsen.r413.codex-manifest.json), [Auswertung](leiste-achsen.r413.codex-check-evidence.json).

### LA413-01 · `:focus-visible` beweist keinen Tastaturfokus; das Select bewegt sich während `pointerdown`

Der neue Handler in [stage-b.spec.ts:102](leiste-achsen.r413.stage-b.spec.ts#L102) ruft bei `focusin` und `:focus-visible` sofort `scrollIntoView` auf. Native Eingabefelder können auch nach Zeigerfokus `:focus-visible` erfüllen. Das widerspricht dem zugesagten „nie bei einem Zeigerfokus; ein Druck verschiebt nichts“ bereits im Prototyp.

**Eigene Gegenprobe:** TWP, 1280 × 800, F4, Chromium mit Touch-Größen, echte Mausereignisse. Die native Step-Auswahl steht teilweise hinter Safety; gedrückt wird ihr noch sichtbarer Teil bei **x = 385,328 px**. Gemessen wird nach `mouse.down`, vor `mouse.up`:

| Fall | scrollLeft vorher → unter Druck | Select links vorher → unter Druck | `:focus-visible` unter Druck |
|---|---:|---:|---|
| Nur den neuen Fokus-Handler entfernt, sonst dasselbe B2 | 657 → 657 | 307,828 → 307,828 | ja |
| B2 mit dem neuen Handler | 657 → 574 | 307,828 → 390,828 | ja |

Das Select wandert **83 px** nach rechts; der ursprüngliche Druckpunkt liegt danach sogar links außerhalb seiner Box. Die Kontrolle entfernt ausschließlich den von B2 hinzugefügten Listener. Die native Fokussierung allein verschiebt es in dieser Kontrolle nicht. [Gegenprobe](leiste-achsen.r413.codex-countercheck.spec.ts), [Rohdaten](leiste-achsen.r413.codex-select-control.jsonl), ergänzend [Fokusereignisse](leiste-achsen.r413.codex-pointer.jsonl).

**Vertragskorrektur:** `:focus-visible` darf das Aussehen steuern, aber nicht allein die Ursache des Fokus feststellen. Das automatische Ins-Bild-Holen muss an die tatsächliche Tastaturnavigation gebunden sein und durch den bestehenden Druckvertrag gehen: keine automatische Verschiebung, solange ein Zeigerdruck noch seinen Klick/Abbruch schuldet. Auch Tab während eines anderen gehaltenen Zeigers darf diesen Vertrag nicht umgehen. Ein aufgeschobenes Scrollziel gilt nur, solange es noch der aktuelle Fokus ist; eine spätere Bedienhandlung darf nicht zurückgeholt werden. Native Select-Eingaben dafür nicht pauschal mit `preventDefault` unterbinden.

**Wächter:** den obigen Zeigerfall rot vor/grün nach der Korrektur, daneben positives Tab zum teilweise verdeckten Ziel sowie Tab bei gehaltenem zweitem Zeiger und Fokuswechsel vor der Freigabe. Die bestehende Anforderung „Tastaturziel ganz ins Bild“ bleibt bestehen. Für Firefox liefert meine Select-Sonde hier keinen Nachweis: Dort rendert dieser Fall eine Radiogruppe, siehe Grenzen unten.

### LA413-02 · Ein verdeckender Vorfahr zählt fälschlich als ganzer, erreichbarer Knopf

`whole()` akzeptiert in [stage-b.spec.ts:190](leiste-achsen.r413.stage-b.spec.ts#L190) neben dem Knopf und seinen Kindern auch **jeden Vorfahren innerhalb desselben Abschnitts**. Damit erfüllt selbst Safety als Trefferfläche den Nachweis für einen von Safety verdeckten Stop. Dieselbe Lockerung steht in der Prüfung des letzten Bedienelements bei Zeile 286.

**Gegenprobe in Chromium und Firefox:** B2, TWP1280/F4, `scrollLeft = 200`. Ein Jog-Knopf ist sichtbar, der Stop im Jog-Feld ist verdeckt; der reservierte Stop muss also tragen. Eine transparente, eingabeabfangende `::before`-Fläche über `.safetyStrip` wird hinzugefügt, ohne die Geometrie zu ändern. `elementFromPoint` liefert danach **DIV `.safetyStrip`**, weder den Stop noch dessen Kind. Trotzdem meldet die unveränderte Probe weiterhin `reservedWhole = true`, `stopOk = true` und `estop = true`. [Rohdaten beider Browser](leiste-achsen.r413.codex-occlusion.jsonl), [Gegenprobe](leiste-achsen.r413.codex-countercheck.spec.ts).

Das ist ein Fehler des Nachweises, keine Behauptung, dass das unveränderte B2 diese Fläche bereits besitzt. Er verhindert aber, die 18 grünen Fälle als harten Beleg der geforderten Treffer-Erreichbarkeit anzunehmen.

**Korrektur:** Für die aktiven Stop-/E-Stop-Ziele muss jeder Prüfpunkt den Knopf selbst oder ein Kind treffen. Falls ein absichtlich gesperrtes Bedienelement seine Erklärung über eine Hülle anbietet, diese konkrete Hülle und deren Funktion gesondert prüfen; ein beliebiger Abschnittsvorfahr ist kein Ersatz. Beide Prüfstellen müssen denselben Vertrag tragen. Die abfangende Fläche muss den Wächter rot machen, das unverdeckte B2 grün. Die Prüfung gegen visuelles Durchscheinen bleibt zusätzlich erforderlich, wie von dir benannt.

### Was ich mittrage, und zwei Präzisierungen für den Bau

- **F2/F3 ohne Snap, ein Scroller, feste rechte Gruppe:** Zustimmung zur Richtung. Die abweichende Sicht-/DOM-Reihenfolge von F3 ist benannt. Eigene vollständige Tab-Durchläufe über TWP1600/F2, XYZAC1280/F3 und TWP1280/F4 in beiden Browsern ergaben **404 Fokuspositionen ohne gemeldete Geometriefehler**. Das ist ein ergänzender Beobachtungsbeleg mit dem bisherigen Prädikat, kein unabhängiger Ersatz für LA413-02. [Tab-Rohdaten](leiste-achsen.r413.codex-tab.jsonl).
- **Helfer:** Am Prüfstand besitzt Jog kein numerisches Eingabefeld. Geprüft habe ich deshalb die wirklichen Besitzer **Setup und Spindle**, jeweils in diesen drei Formen und beiden Browsern: alle **12 Ziffernfeld-Boxen** im Leistenfenster, reservierter Stop laut Probe ganz. Das beantwortet den Platzbedarf dieser Fälle; gehaltene Öffnungs-/Schließübergänge und jede einzelne Ziffernfeld-Aktion sind damit nicht bewiesen. [Rohdaten](leiste-achsen.r413.codex-helper.jsonl), Bilder [Setup](leiste-achsen.r413.codex-TWP1280-setup.png) / [Spindle](leiste-achsen.r413.codex-TWP1280-spindle.png).
- **„So groß wie die drei anderen“ ist noch nicht gerendert.** Die vorhandenen drei Safety-Knöpfe sind laut Rohdaten 58 px hoch (Chromium Touch) bzw. 56 px (Firefox Desktop); der vierte misst 44 bzw. 42 px. Die gleiche Breite ist nachgewiesen, die gleiche Höhe nicht. Für den Bau den versprochenen vierten Knopf auch in der Höhe angleichen und alle vier Boxen prüfen. Das ändert nicht den hier belegten Bedarf von 93,3 px zusätzlicher Breite.
- **Die Vergleichsspalte „heute“ hat bereits die Stufe-A-Transformation.** `toolRowsIntoSpindle()` und `HIDE_TOOL` laufen auch für diese Variante. Das ist für den Vergleich mit B sinnvoll und im Text teilweise erklärt; die Zahlen bitte ausdrücklich als „Basis mit A-Prototyp, ohne B“ bezeichnen, nicht als Messung des unveränderten `dc9dc3e4`. Die separate Hochformatmessung bleibt davon unberührt.
- **Gemeinsame Stop-Aktion:** Der Vorschlag ist richtig; im Bau auch die bestehende sofortige Auslösung des Jog-Stops bei Zeigerdruck bzw. Enter/Leertaste bewahren, nicht nur dieselbe Funktion erst beim Loslassen aufrufen. Der DOM-Klon dieser Runde belegt noch keine Zustellung. Q413-1 bleibt bei dir und dem Operator; daraus mache ich keine weitere Operatorfrage.

### Belege, eigene Testfehler und Grenzen

- [Beobachtungsspec](leiste-achsen.r413.codex-probe.spec.ts), [Gegenproben](leiste-achsen.r413.codex-countercheck.spec.ts), [unverändert übernommene Prototyp-Helfer](leiste-achsen.r413.codex-prototype.ts), [Prüfskript der aufgezeichneten Daten](leiste-achsen.r413.codex-check-evidence.py). Dateihashes und Zuordnung zu den ursprünglichen Laufpfaden stehen im Manifest.
- Beobachtungslauf: **Chromium 11 PASS; Firefox 10 PASS / 1 eigener Sondenfehler** (kein Select vorhanden). Gegenprobenlauf: **Chromium 3 PASS; Firefox 1 PASS / 2 eigene Sondenfehler** (dieselben nicht vorhandenen Selects, Timeout). Die grünen Gegenproben bestätigen ausdrücklich die oben beschriebenen Fehler, nicht die Einhaltung des Vertrags. Berichte: [Chromium](leiste-achsen.r413.codex-chromium.json), [Firefox](leiste-achsen.r413.codex-firefox.json), [Chromium Gegenproben](leiste-achsen.r413.codex-mutation-chromium.json), [Firefox Gegenproben](leiste-achsen.r413.codex-mutation-firefox.json).
- Einen ersten Lauf habe ich nach der falschen Annahme eines Jog-Ziffernfelds selbst abgebrochen und auf Setup/Spindle korrigiert. [Ursprüngliche Sonde](leiste-achsen.r413.codex-initial.spec.ts) und [Abbruchbericht](leiste-achsen.r413.codex-initial-chromium.json) bleiben erhalten; es gibt hier keinen pauschalen „alles grün“-Befund.
- Die neun gelieferten Geometriefälle je Browser habe ich anhand ihrer Rohdaten geprüft, nicht vollständig erneut ausgeführt. Kein Firefox-Touch, kein tatsächlicher Browserzoom/Panel, kein `dragScroll`-Ziehen, kein vollständiger Nachweis gehaltener Mehrzeiger-/Formwechsel. Diese benannten Bauprüfungen bleiben offen.
- Ausschließlich isolierte Kopie und Mock, gemeinsamer Test-Lock; die eigenen Testprozesse sind beendet. Kein Produktcode geändert, kein Build/Test/Checkout im Live-Baum und kein Zugriff auf die Live-Sim.

Nach Korrektur von LA413-01/-02 kann B mit denselben geometrischen Kriterien erneut vorgelegt werden; ein anderer Grundaufbau ist durch diese Befunde nicht gefordert.

---

## Claude · Antwort auf R413 · Anfrage R414 · 20. November 2026

Beide Befunde nehme ich an; sie lagen im Prototyp und in meiner Probe, nicht in der Bauweise. Die Präzisierungen übernehme ich.

**Belege:**
- [Spec](leiste-achsen.r414.stage-b.spec.ts) und [Läufer](leiste-achsen.r414.stage-b-run.sh);
- Leiste [b2, b2old, b2occ](leiste-achsen.r414.strip.jsonl), [Safety-Raum](leiste-achsen.r414.safety.jsonl) und [Fokusfälle](leiste-achsen.r414.focus.jsonl);
- die Zusammenfassung der [Läufe](leiste-achsen.r414.runs.txt);
- [Bild b2 bei TWP 1920](leiste-achsen.r414.b2-TWP1920.png) mit vier gleich großen Safety-Knöpfen.

### LA413-01 · Fokus nur bei Tastaturnavigation, nie unter einem Druck

**Vertrag**, korrigiert:
- **Tastatur, nicht `:focus-visible`:** Das automatische Ins-Bild-Holen hängt an echter Tastaturnavigation, also an Tab, Shift+Tab, Pfeilen, Home oder End seit dem letzten `pointerdown`. `:focus-visible` bleibt Aussehen.
- **Warten auf den Druck:** Hält noch ein Zeiger, ist das Ziel nur vorgemerkt und wird erst nach dem Loslassen geholt. Im Bau geschieht das über den bestehenden Druckvertrag `heldThroughPress`, je Zeiger bis zu seinem Klick, seinem Abbruch oder 500 ms nach dem Loslassen. Mein Prototyp nimmt dafür die Menge der gedrückten Zeiger und die Aufgabe nach dem letzten `pointerup`.
- **Kein Zurückholen:** Das vorgemerkte Ziel gilt nur, solange es den Fokus noch hat. Eine spätere Bedienhandlung wird nicht zurückgeholt.
- **Kein `preventDefault`** auf native Auswahlfelder.

**Wächter, rot vor und grün nach der Korrektur:**

| Fall | b2old (dein Handler) | b2 (korrigiert) |
|---|---|---|
| Dein Zeigerfall, Step-Auswahl halb unter Safety, Chromium | 657 → 574 unter dem Druck, **rot** | 657 → 657 → 657, grün |
| Tab auf einen Setup-Knopf, der rechts über den Rand ragt (rechte Kante 1286 bzw. 1276, Fenster 1271) | ganz im Bild | ganz im Bild, beide Browser |
| Zeiger auf Safetys Kopf gehalten, dann Tab auf das Ziel | — | Unter dem Druck keine Bewegung (0 → 0). Nach dem Loslassen ganz im Bild (Scroll 15 bzw. 5,2 px). Wechselt der Fokus vor dem Loslassen weg, wird nicht zurückgeholt (0 → 0). Beide Browser. |

- **Firefox:** Dort ist die Step-Wahl eine Radiogruppe, wie bei dir. Einen Firefox-Zeigerfall mit einem Auswahlfeld gibt es deshalb nicht.
- **Verworfener Fall:** Das Drehzahlfeld als Ersatz habe ich verworfen. Es nimmt per Absicht keinen Zeigerfokus; sein Tippen öffnet das Ziffernfeld, und dieses Layout ändert die Leiste nach dem Klick. Der Fall prüfte das Fokus-Scrollen also gar nicht.

### LA413-02 · Die Trefferprüfung ist streng

- **Ein Treffpunkt zählt nur**, wenn er den Knopf selbst trifft, eines seiner Kinder oder, bei einem gesperrten Knopf, genau seine eigene `.btnTip`-Hülle. Diese Hülle trägt den Grund und das Tippen dazu (`MachineBtn`, `.btnTip > :disabled { pointer-events: none }`). Kein anderer Vorfahr zählt. Dasselbe gilt in beiden Prüfstellen.
- **Die Treffpunkte:**
  - die vier Kantenmitten, je 3 px innen;
  - dazu ein Raster aus 3 × 3 Punkten bei 25 %, 50 % und 75 %.
  - Ecken prüft die Probe nicht: Mein erster strenger Lauf maß 2 px innen in den Ecken. Dort traf Firefox an runden Knöpfen den Rahmen, und E-Stop las „nicht ganz“. In demselben Lauf war die Höhe des vierten Knopfs noch nicht angeglichen. Er bleibt als eigener Beleg erhalten: [Rohdaten](leiste-achsen.r414.first-strict.jsonl), [Lauf](leiste-achsen.r414.first-strict-run.txt).
- **Gegenprobe `b2occ`:** Eine abfangende `::before`-Fläche über Safety macht **18 von 18 Fällen rot**, in beiden Browsern (E-Stop und Jog-Stopp nicht ganz). Das unverdeckte b2 ist **18 von 18 grün**.
- **Durchscheinen** bleibt für den Bau als Bildprüfung offen, wie benannt.

### Präzisierungen

- **Der vierte Knopf in voller Höhe.** Die Probe verlangt jetzt in b2 vier Safety-Knöpfe mit gleicher Breite und Höhe (±0,5 px): Chromium 85,3 × 58, Firefox 85,3 × 56. Im Prototyp setze ich die Höhe aus dem ersten Knopf. Im Bau trägt der vierte dieselbe Klasse `.safetyBtn` wie die drei anderen.
- **„heute“ heißt Basis mit A-Prototyp, ohne B.** Die Spalte in R413 ist `dc9dc3e4` mit verborgenem Tool und den Zeilen von Stufe A in Spindle, nicht das unveränderte `dc9dc3e4`. Die Hochformatmessung ist davon nicht berührt.
- **Die Stop-Aktion löst sofort aus**, wie das Stop im Jog-Feld. Das tut es bei `pointerdown` (`startJog` → `stopAllJog`) und bei Enter oder Leertaste auf `keydown`, nicht erst beim Loslassen. Der Bau ruft die gemeinsame Funktion auf genau diesen Ereignissen. Die Zustellung belegt erst ein Wächter am Mock, der zählt, wie viele `jog_stop` je Achse ankommen.
- **Helfer:** Danke für die Korrektur. Jog besitzt am Prüfstand kein Ziffernfeld; die wirklichen Besitzer sind Setup und Spindle. Meine Rechnung in R413 („Jog besitzt das Ziffernfeld“) war falsch.

### Erbeten

`agreement` oder `findings` zu Stufe B mit diesen Korrekturen. Q413-1 (wo der Jog-Stopp sitzt) stelle ich dem Operator.

---

## Codex · Nachprüfung Stufe B · R414 · 20. November 2026

**Urteil: `findings`, ein Rest bei LA413-01.** LA413-02 ist geschlossen; die Gleichheit der vier Safety-Knöpfe ist jetzt nachgewiesen. Der ursprüngliche Select-Mausfall aus LA413-01 ist korrigiert. Beim Tab-Schritt zu einem vollständig verdeckten Ziel scrollt jedoch der Browser selbst unter dem gehaltenen Zeiger. Das Aufschieben des eigenen `scrollIntoView` reicht dafür nicht aus.

Prüfstand: Dokument `71428477`, unveränderte Produktbasis `dc9dc3e4` mit injiziertem R414-Prototyp. [Manifest](leiste-achsen.r414.codex-manifest.json), [Datenprüfung](leiste-achsen.r414.codex-check-evidence.json).

### Geschlossen: LA413-02 und die Präzisierungen

Die Trefferprüfung akzeptiert jetzt nur Ziel/Kinder sowie die eigene `.btnTip`-Hülle eines gesperrten Knopfs, an beiden Prüfstellen. Das entspricht dem verlangten Vertrag. Kantenmitten und das innere Raster sind für die gerundeten Ziele sinnvoll; die gesonderte Bildprüfung auf Durchscheinen bleibt bestehen.

Die gelieferten Daten enthalten **18/18 B2-Fälle ohne Fehler**, **18/18 mit der abfangenden Safety-Fläche fehlerhaft**, jeweils 47 Proben, sowie **10/10 Safety-Raum-Fälle**. Eigene Wiederholung des Abdeckungsgegenfalls in Chromium und Firefox: unverdeckt `estop/stopOk = true`, verdeckt beide `false`. Auch die vier Höhen stimmen: **58 px / 56 px**, bei gleichen Breiten innerhalb 0,5 px. [Eigene Rohdaten](leiste-achsen.r414.codex-occlusion.jsonl).

Die korrigierte Bezeichnung der Vergleichsbasis, Setup/Spindle als tatsächliche Helferbesitzer und der sofortige Stop auf `pointerdown` beziehungsweise Enter/Leertaste auf `keydown` sind übernommen. Der Zustellungswächter bleibt beim Bau. Q413-1 bleibt bei dir und dem Operator.

### LA413-01 · Rest: natives Tab-Scrollen bei einem ganz verdeckten Ziel

Dein Haltefall erreicht den ersten Setup-X-Knopf, dessen linke Seite noch sichtbar ist. Das bestätigt auch meine Wiederholung: unter dem Druck 0 px Scrollweg, nach dem Loslassen 15 px in Chromium beziehungsweise 5,23 px in Firefox. Der Select-Fall ist laut deinen Rot-/Grün-Daten ebenfalls geschlossen: alt −83 px, neu 0 px.

**Der nächste Tab-Schritt fällt durch.** TWP1280/F4, Scrollanfang. Der erste Setup-X-Knopf hat Fokus; der zweite liegt vollständig rechts außerhalb des Fensters. Mit der Maus wird **X+ im Jog-Feld gedrückt und gehalten**. Dessen `pointerdown.prevent` lässt den Setup-Fokus stehen. Jetzt einmal Tab, weiterhin ohne Loslassen:

| Browser | Zweites Setup-Ziel vor Tab | Sichtfenster rechts | Scroll unter Druck | Gehaltener X+-Knopf: links vorher → danach |
|---|---:|---:|---:|---:|
| Chromium, Touch-Größen | 1293,83–1348,83 px | 1271 px | **0 → 490 px** | 564,33 → 74,33 px |
| Firefox 160, Desktop-Größen | 1284,23–1338,83 px | 1271 px | **0 → 480,37 px** | 564,33 → 83,97 px |

Der Druckpunkt liegt in beiden Fällen weiterhin bei x ≈ 601,58 px; der gehaltene Knopf ist inzwischen darunter weggewandert. Die Zeigermenge enthält während dieser Messung weiterhin genau den gedrückten Zeiger, und das neue Fokusziel ist korrekt vorgemerkt. Es gibt keine zwischenzeitliche Freigabe der Geste.

**Ursachenkontrolle:** Nur den neuen `focusin`-Listener entfernt, denselben Ablauf wiederholt: exakt derselbe Scrollweg in beiden Browsern. Damit ist die Grenze klar: Das vorhandene native Fokus-Scrollen muss ebenfalls vom zugesagten Druckvertrag erfasst werden. `heldThroughPress` um einen aufgeschobenen eigenen Scrollauftrag verhindert den bereits ausgeführten nativen Tab-Schritt nicht. [Sonde mit echtem Jog-Druck und Kontrolle](leiste-achsen.r414.codex-native-tab.spec.ts), [vier Rohfolgen](leiste-achsen.r414.codex-native-tab.jsonl); ergänzend [Haltefälle auf Safetys Kopf](leiste-achsen.r414.codex-tab.jsonl).

**Vorgeschlagener Vertrag:** Solange noch ein Druck seinen Abschluss schuldet, auch die fokussierende Tastaturnavigation vor ihrem nativen Scrollen zurückhalten. Beispielsweise den Tab-/Shift+Tab-Schritt samt Fokuswechsel bis zur Freigabe vormerken; alternativ das Ziel kontrolliert mit `preventScroll` fokussieren und nur das anschließende Ins-Bild-Holen aufschieben. Die Freigabe prüft den aktuellen Druck- und Fokuszustand; neuere Bedienung verwirft den alten Auftrag. Die bestehende Auswahlgruppen-Navigation gehört in diese Prüfung, weil sie ebenfalls `focus()` aufruft. Die genaue Umsetzung kann mit dem bestehenden Druckbesitzer erfolgen, aber die Browser-Standardaktion muss ausdrücklich Teil des Vertrags werden.

**Erforderlicher Wächter:** neben dem teilweise sichtbaren Ziel auch das vollständig außerhalb liegende Nachbarziel, mit tatsächlich gehaltenem Jog-Knopf in beiden Browsern. Während des Drucks bleiben Scrollposition und Knopfbox unverändert; nach zulässigem Abschluss funktioniert die vorgesehene Navigation. Den Fall mit inzwischen gewechseltem Fokus beibehalten. Für diese Korrektur ist keine weitere Operatorentscheidung erforderlich.

### Eigene Läufe und Grenzen

- Beobachtungs-/Trefferlauf: **4 Chromium + 4 Firefox PASS**; zusätzliche Jog-/Ursachenkontrolle: **2 Chromium + 2 Firefox PASS**, keine Skips oder Flakies in diesen abgeschlossenen Läufen. Die Gegenproben bestätigen ausdrücklich den Fehler mit mehr als 400 px Bewegung; ihr PASS bedeutet keine Vertragserfüllung. [Beobachtungsspec](leiste-achsen.r414.codex-probe.spec.ts), Berichte [Chromium](leiste-achsen.r414.codex-chromium.json) / [Firefox](leiste-achsen.r414.codex-firefox.json), Kontrolle [Chromium](leiste-achsen.r414.codex-native-chromium.json) / [Firefox](leiste-achsen.r414.codex-native-firefox.json).
- Der erste Zusatzlauf verwendete meinen falschen Locator `Jog X+` statt `X+`: ein Timeout, danach von mir abgebrochen. [Ursprüngliche Sonde](leiste-achsen.r414.codex-initial-native.spec.ts) und [Bericht](leiste-achsen.r414.codex-initial-native-chromium.json) sind erhalten. Nur dieser Locator wurde für die Wiederholung korrigiert.
- Die gesamte gelieferte Geometriematrix wurde anhand der Rohdaten geprüft, nicht erneut ausgeführt. Kein Firefox-Touch, echter Zoom/Panel oder vollständiger Mehrzeiger-/Helferübergangsnachweis. Die übrigen benannten Bauprüfungen bleiben beim Implementierungsreview.
- Isolierte Kopie und eigener Mock unter der gemeinsamen Testsperre; alle eigenen Testprozesse beendet. Keine Produktänderung, kein Test/Build/Checkout im Live-Baum und kein Zugriff auf die Live-Sim.

Der B2-Grundaufbau bleibt tragfähig; offen ist jetzt dieser eine zusätzliche Eintrittsweg in das Scrollen unter Druck.

---

## Claude · Antwort auf R414 · Anfrage R415 · 20. November 2026

Den Rest von LA413-01 nehme ich an. Die Standardaktion des Browsers gehört jetzt zum Druckvertrag. Belege: [Spec](leiste-achsen.r415.stage-b.spec.ts), [Fokusfälle](leiste-achsen.r415.focus.jsonl), [Leiste](leiste-achsen.r415.strip.jsonl) und die Zusammenfassung der [Läufe](leiste-achsen.r415.runs.txt).

### Vertrag

**Solange ein Druck seinen Abschluss schuldet:**
- **Tab und Shift+Tab** übernimmt die Leiste: `preventDefault`, dann Fokus auf den nächsten bzw. vorigen Tab-Halt mit `preventScroll`. Das Ins-Bild-Holen wird wie bisher bis nach dem Loslassen vorgemerkt.
  - **Tab-Folge:** Die Folge der Tab-Halte ist die DOM-Folge. Die App hat keinen positiven `tabindex` (geprüft per Suche über `src/`).
  - **Am Dokumentende** gibt es keinen nächsten Halt; dann bleibt Tab beim Browser.
- **Jeder programmatische Fokus** nimmt `preventScroll`. Das betrifft die Pfeile einer Auswahlgruppe, `returnFocusTo` und jeden anderen `focus()`-Aufruf. In `src/` stehen 35 `.focus(`-Stellen.
  - **Im Prototyp** geschieht das durch eine Hülle um `HTMLElement.prototype.focus`. Im Bau ist es eine benannte Hilfsfunktion, die die Leiste und `choiceGroup.ts` rufen. Für `returnFocusTo` gilt, dass seine Rückgabe ohnehin erst nach dem Klick landet.
  - **Der Wächter** für den Bau zählt die Stellen, die unter einem Druck fokussieren können.
- **Prüfung beim Loslassen:** Die Freigabe prüft den aktuellen Druck- und Fokuszustand. Eine neuere Bedienung verwirft den alten Auftrag (bestehender Fall „später gewechselter Fokus“).
- **Der Druckbesitzer im Bau** ist `heldThroughPress`, je Zeiger. Der Prototyp nimmt die Menge der gedrückten Zeiger.

### Wächter, rot vor und grün nach der Korrektur

Dein Fall: TWP 1280, F4, Scrollanfang. Der erste Setup-Knopf hat den Fokus, der zweite liegt ganz rechts außerhalb. X+ im Jog-Feld wird mit der Maus gehalten, dann einmal Tab.

| Browser | ohne Tab-Übernahme (Stand R414) | mit Tab-Übernahme |
|---|---|---|
| Chromium, Touch | Scroll 0 → **490** unter dem Druck, X+ 564,3 → **74,3** px | 0 → 0, X+ bleibt bei 564,3. Nach dem Loslassen 78 px gescrollt; das Ziel endet an der Fensterkante (1271). |
| Firefox 160, Desktop | 0 → **480,4**, X+ 564,3 → **84,0** | 0 → 0, X+ bleibt. Nach dem Loslassen 67,8 px; das Ziel endet bei 1271. |

- **Der Fokus** landet in beiden Fällen unter dem Druck auf dem Ziel.
- **Die übrigen Fälle bleiben grün:**
  - die 9 Leistenfälle je Browser;
  - die 5 Fälle für den Safety-Raum;
  - dein Auswahlfeld-Fall (657 → 657);
  - Tab auf ein halb verdecktes Ziel;
  - gehaltener Zeiger mit späterem Fokuswechsel.
- **Ergebnis:** Chromium 18 von 18, Firefox 17 von 17; der Auswahlfeld-Fall entfällt in Firefox mangels Auswahlfeld. Die Variante ohne Tab-Übernahme fällt nur an diesem einen Fall durch.

### Erbeten

`agreement` oder `findings` zu Stufe B.

---

## Codex · Nachprüfung Stufe B · R415 · 20. November 2026

**Urteil: `findings`. LA413-01 ist am bisherigen Gegenfall geschlossen; zwei Folgefehler der Tab-Übernahme bleiben.** Der gehaltene Jog-Knopf bewegt sich bei Tab und Shift+Tab jetzt in beiden Browsern nicht. Die neue dokumentweite Tab-Behandlung verändert jedoch die bestehende Fokusfolge: im Dialog durch einen zweiten Schritt desselben Ereignisses, von einem neutralen Fokusziel durch den Sprung zum ersten Halt des Dokuments. LA413-02 bleibt geschlossen.

Geprüft: Dokument `51192615`, R415-Prototyp auf `dc9dc3e4`. [Manifest](leiste-achsen.r415.codex-manifest.json), [Auswertung](leiste-achsen.r415.codex-check-evidence.json).

### Geschlossen: LA413-01 am gehaltenen Jog

Eigene Wiederholung mit tatsächlich gehaltenem X+: **Zero X → Tab → Unhome X → Shift+Tab → Zero X**, dann wieder Tab und loslassen. Unter dem Druck bleiben Scrollposition und X+-Box unverändert, in Chromium und Firefox. Nach dem Loslassen wird das Ziel mit **78 px beziehungsweise 67,83 px** ins Bild geholt. [Sonde](leiste-achsen.r415.codex-probe.spec.ts), [Rohfolgen](leiste-achsen.r415.codex-held.jsonl).

Auch die gelieferten Rot-/Grün-Daten passen: ohne Tab-Übernahme weiterhin 490/480,37 px Bewegung, mit Übernahme 0 px. Die 18 Leistenfälle der korrigierten Variante enthalten je 47 Proben ohne Fehler. Das löst den belegten Scroll-Eintrittsweg; ein anderer B2-Grundaufbau ist weiterhin nicht erforderlich.

### LA415-01 · Im Dialog wird dasselbe Tab zweimal verarbeitet und überspringt den Jog-Stopp

Der neue dokumentweite Capture-Listener in [stage-b.spec.ts](leiste-achsen.r415.stage-b.spec.ts) prüft vor seiner eigenen Navigation weder `defaultPrevented` noch den vorhandenen Fokusbesitzer. `modalRegistry.ts:onTabKey` verarbeitet Tab bei geöffnetem Dialog bereits: genau ein Schritt innerhalb des obersten Dialogs, seiner Helfer, Safety und der ausdrücklich erreichbaren Banner-Aktionen. Danach läuft der neue Listener und geht nochmals einen Schritt in seiner eigenen Dokumentliste.

**Eigene Gegenprobe in beiden Browsern:** Settings offen, Fokus auf dem dritten Safety-Knopf Power on/off, einmal Tab. Ohne gehaltenen Zeiger landet der Fokus korrekt auf **Jog stop**. Mit gehaltenem Zeiger auf Safetys Kopf landet er sofort auf **Active codes — open in the G-code reference**; Jog stop wird übersprungen. Das Dialogregister meldet in beiden Fällen unverändert einen offenen Dialog. [Vergleichsfolgen](leiste-achsen.r415.codex-dialog.jsonl).

**Korrektur am Vertrag:** Ein Tastaturschritt hat genau einen Fokusbesitzer. Die Leiste darf eine bereits behandelte Tab-Taste nicht nochmals auswerten; die bestehende Dialogreihenfolge muss entscheiden dürfen. Deren Fokuswechsel verwendet dann dieselbe druckabhängige `preventScroll`-Funktion. Die Zusammenarbeit muss unabhängig von der Registrierungsreihenfolge der Listener sein. Auch die vorhandenen Regeln zu Ctrl/Alt/Meta und bereits verhinderten Ereignissen bleiben erhalten.

**Wächter:** Vergleich der Fokusfolge mit und ohne gehaltenen Druck im offenen Dialog, insbesondere Power → Jog stop, dazu Shift+Tab und die Grenzen zwischen Dialog, Safety und eigenem Helfer. Ein zusätzlicher eigener Durchlauf von zehn Tabs je Browser blieb innerhalb Dialog/Safety; ich behaupte deshalb keinen nachgewiesenen Ausbruch aus dem Fokusbereich. Belegt ist der doppelte Schritt. [Zusatzsonde](leiste-achsen.r415.codex-dialog-walk.spec.ts), [Rohdaten](leiste-achsen.r415.codex-dialog-walk.jsonl).

### LA415-02 · Von der fokussierten Leiste führt Tab zum Seitenanfang

„Keine positiven `tabindex`“ reicht für die nachgebildete Tab-Folge nicht aus. Die Leiste selbst ist ein absichtlich fokussierbares **`tabindex="-1"`-Ziel**, unter anderem für die bestehende Fokusrückgabe. Sie fehlt in `tabbables()`. Für `document.activeElement === .strip` liefert `list.indexOf(...)` deshalb −1; der nächste Halt wird `list[0]`.

**Eigene Gegenprobe in beiden Browsern:** `.strip` hat Fokus. Ein normales Tab führt zum ersten Safety-Knopf **Arm/Disarm**. Dasselbe Tab unter gehaltenem Zeiger führt zu **Connection details** im Kopf der Seite. Die Scrollposition bleibt zwar ruhig, aber der Ausgangspunkt der Navigation geht verloren. [Rohdaten](leiste-achsen.r415.codex-neutral.jsonl).

**Korrektur am Vertrag:** Die Navigation muss die Position eines fokussierten Elements auch dann bewahren, wenn dieses selbst kein Tab-Halt ist. Für die Leiste heißt vorwärts: ihr erster zulässiger Halt; rückwärts: die reguläre vorherige Position. Ein fehlender Listenindex darf nicht pauschal zum Dokumentanfang werden. Neutrale Dialog- und Helfercontainer gehören ebenfalls zu den vorhandenen Fokuszielen. Wächter jeweils für Tab/Shift+Tab, mit und ohne gehaltenen Druck.

### Präzisierung der Fokus-Hilfsfunktion für den Bau

Die globale `HTMLElement.prototype.focus`-Hülle ist als Prototyp benannt; die produktive Stellenliste und Hilfsfunktion bleiben Bauarbeit. In diese Liste gehören auch `modalRegistry` und `returnFocusTo`. Die Aussage „dessen Rückgabe landet ohnehin erst nach dem Klick“ ist keine belastbare Ausnahme: `inputSession.ts:returnFocusTo` fokussiert einen verfügbaren Rückgabeempfänger **sofort** und versucht es gegebenenfalls in folgenden Frames erneut. Ein anderer Zeiger kann dabei weiterhin gehalten sein. Der Vertrag „jeder programmatische Fokus unter Druck ohne Scrollen“ muss diese Aufrufe daher ausdrücklich einschließen.

### Belege und Grenzen

- Eigene Läufe: **5 Chromium + 5 Firefox**, Zusatzlauf **1 + 1**, alle ohne Skip/Flaky/Testfehler. Die Beobachtungstests zeichnen die tatsächlichen Ziele auf; ihre grünen Berichte bedeuten keine Zustimmung zu den beiden abweichenden Fokusfolgen. Berichte [Chromium](leiste-achsen.r415.codex-chromium.json) / [Firefox](leiste-achsen.r415.codex-firefox.json), Zusatz [Chromium](leiste-achsen.r415.codex-walk-chromium.json) / [Firefox](leiste-achsen.r415.codex-walk-firefox.json), [Prüfskript](leiste-achsen.r415.codex-check-evidence.py).
- Die gesamte gelieferte Geometriematrix ist anhand ihrer Rohdaten geprüft, nicht vollständig erneut ausgeführt. Kein Firefox-Touch, realer Zoom/Panel oder vollständiger Mehrzeiger-/Helferübergangsnachweis. Die spätere Bindung an den bestehenden Druckbesitzer einschließlich Klickabschluss ist noch keine geprüfte Produktimplementierung.
- Isolierte Kopie und eigener Mock unter der gemeinsamen Testsperre; alle eigenen Prozesse beendet. Keine Produktänderung, kein Build/Test/Checkout im Live-Baum und kein Zugriff auf die Live-Sim.

Für LA415-01/-02 ist keine neue Operatorentscheidung nötig: Die bestehende Fokusfolge soll auch unter gehaltenem Druck gelten.

---

## Claude · Antwort auf R415 · Anfrage R416 · 20. November 2026

Beide Folgefehler nehme ich an, ebenso die Präzisierung zu `returnFocusTo`. Belege: [Spec](leiste-achsen.r416.stage-b.spec.ts), [Fokusfälle](leiste-achsen.r416.focus.jsonl), [Leiste](leiste-achsen.r416.strip.jsonl), [Läufe](leiste-achsen.r416.runs.txt).

### LA415-01 · ein Besitzer je Tastaturschritt

- **Die Tab-Übernahme der Leiste** hört jetzt in der Bubble-Phase am `window`. Sie läuft damit nach jedem Listener am `document`, unabhängig davon, in welcher Reihenfolge die Listener registriert wurden.
- **Einen schon behandelten Schritt rührt sie nicht an:** `defaultPrevented`, Ctrl, Alt und Meta lässt sie stehen, wie `onTabKey`.
- **Im Dialog entscheidet damit `onTabKey` allein.** Dessen `focus()` hält unter einem Druck den Scroll über dieselbe druckabhängige Fokusfunktion; im Prototyp ist das die Hülle.

### LA415-02 · der Startpunkt bleibt

- **Der Schritt beginnt am fokussierten Element**, nach seiner Lage im Baum (`compareDocumentPosition`), nicht an seinem Platz in der Liste der Tab-Halte. Das gilt auch, wenn das Element selbst kein Halt ist, wie die Leiste mit `tabindex="-1"` oder ein neutraler Behälter.
  - **Vorwärts:** der erste Halt danach, Nachfahren eingeschlossen.
  - **Rückwärts:** der letzte Halt davor, der das Element nicht enthält.
  - Nur ohne fokussiertes Element zählt der Dokumentanfang bzw. das Dokumentende.

### Wächter

Je Fall wird die Fokusfolge ohne und mit gehaltenem Zeiger auf Safetys Kopf verglichen. Die Fälle: Tab und Shift+Tab, von der fokussierten Leiste und im offenen Dialog Settings von Power on/off aus. Gemessen in beiden Browsern.

| Fall | ohne Druck | mit Druck, R415 | mit Druck, korrigiert |
|---|---|---|---|
| Leiste, Tab | Arm/Disarm | **Connection details** | Arm/Disarm |
| Leiste, Shift+Tab | More program actions | More program actions | More program actions |
| Dialog, Tab von Power | Jog stop | **Active codes** (Jog stop übersprungen) | Jog stop |
| Dialog, Shift+Tab von Power | E-Stop | **Arm/Disarm** (zwei Schritte) | E-Stop |

**Ergebnis:**
- **R415-Fassung:** 3 von 4 Fällen rot, in beiden Browsern.
- **Korrigiert:** 4 von 4 grün.
- **Unverändert grün:**
  - dein Fall mit gehaltenem X+ (0 → 0 unter dem Druck, X+ bleibt bei 564);
  - die Leistenfälle;
  - der Safety-Raum;
  - Auswahlfeld, Tab und gehaltener Zeiger.
- **Zählung:** Chromium 22 von 22, Firefox 21 von 21. Den Auswahlfeld-Fall gibt es in Firefox nicht.

### returnFocusTo

Angenommen: `returnFocusTo` fokussiert sofort und versucht es in den folgenden Frames erneut, auch während ein anderer Zeiger gehalten ist. Die Liste der Stellen, die im Bau die druckabhängige Fokusfunktion nehmen, enthält ausdrücklich:
- `returnFocusTo` und seinen Fallback;
- `modalRegistry` (`onTabKey`, die erste Fokussierung eines Dialogs, die Rückgabe);
- `choiceGroup.ts`;
- jede weitere der 35 Stellen, die unter einem Druck fokussieren kann.

Der Wächter im Bau zählt diese Stellen.

### Erbeten

`agreement` oder `findings` zu Stufe B.

---

## Codex · Nachprüfung Stufe B · R416 · 20. November 2026

**Urteil: `agreement` zum Plan und zur Bauweise von Stufe B in Fassung R416.** LA415-01 und LA415-02 sind geschlossen. Die bereits bestätigten Korrekturen von LA413-01/-02 bleiben bestehen. Stufe A aus R412 bleibt abgestimmt; eine Produktimplementierung wird mit diesem Agreement noch nicht abgenommen.

Prüfstand: Dokument `5fc9b608`, R416-Prototyp auf `dc9dc3e4`. [Manifest](leiste-achsen.r416.codex-manifest.json), [Auswertung](leiste-achsen.r416.codex-check-evidence.json).

### Die beiden Fokusbefunde sind geschlossen

**LA415-01:** Die Tab-Übernahme als unbehandelter Standardfall in der `window`-Bubble respektiert den zuvor entscheidenden Dialogbesitzer, `defaultPrevented` und die Modifikatortasten. Im eigenen Vergleich landet Tab von Power mit und ohne gehaltenen Zeiger auf **Jog stop**, Shift+Tab auf **E-Stop**. Der zweite Schritt desselben Ereignisses ist damit beseitigt. [Tab-Vergleich](leiste-achsen.r416.codex-dialog.jsonl), [Rückwärtsvergleich](leiste-achsen.r416.codex-extra.jsonl).

**LA415-02:** Der Start an der Baumposition erhält auch den neutralen Fokusanker. Von `.strip` führt Tab mit und ohne Druck zu **Arm/Disarm**, Shift+Tab zu **More program actions**. Zusätzlich habe ich den neutralen Ziffernfeld-Container geprüft: Sein Tab erreicht in beiden Fällen dieselbe Taste **7**. Die Zusatzproben vergleichen die tatsächliche DOM-Identität des Ziels, nicht nur dessen Beschriftung. [Leistenvergleich](leiste-achsen.r416.codex-neutral.jsonl), [Zusatzfälle](leiste-achsen.r416.codex-extra.jsonl).

Der ursprüngliche Haltefall bleibt ebenfalls grün: **Zero X → Tab → Unhome X → Shift+Tab → Zero X** bei tatsächlich gehaltenem X+-Jog, ohne Änderung von Scrollposition oder Knopfbox. Nach dem abschließenden Tab und Loslassen wird das Ziel mit 78 px in Chromium beziehungsweise 67,83 px in Firefox ins Bild geholt. [Rohfolgen](leiste-achsen.r416.codex-held.jsonl).

### Vereinbarter Übergang zum Bau

Die ergänzte Stellenliste einschließlich `returnFocusTo`, Fallback, Dialogfokus und Auswahlgruppen ist angenommen. Der Bau verwendet die benannte gemeinsame Fokusfunktion und den bestehenden Druckbesitzer; die globale `HTMLElement.prototype.focus`-Hülle bleibt ein Prototypmittel. Die Freigabe muss nach dem vereinbarten Vertrag den dann aktuellen Druck- und Fokuszustand lesen, bis zum Abschluss jedes Zeigers warten und einen durch spätere Bedienung überholten Auftrag verwerfen. Das ist weiterhin Implementierungsarbeit, die die vereinfachte Zeigermenge dieser Probe nicht vorwegnimmt.

Die bereits benannten Bauprüfungen bleiben bestehen: Stop-Zustellung auf den vereinbarten Ereignissen, gehaltene Form-/Helferwechsel, Schwellen ±1 px, `dragScroll`, Bildprüfung auf Durchscheinen sowie die benannten Zoom-/Panel-Grenzen. Dafür entsteht hier keine weitere Planfrage. Q413-1 und das Operator-Go zum Bau bleiben bei dir und dem Operator.

### Belege und Grenzen

- Eigene Läufe: **8/8 Chromium + 8/8 Firefox 160 PASS**, keine Skips, Flakies oder Testfehler. [Sonde](leiste-achsen.r416.codex-probe.spec.ts), [Chromium-Bericht](leiste-achsen.r416.codex-chromium.json), [Firefox-Bericht](leiste-achsen.r416.codex-firefox.json), [Prüfskript der Daten](leiste-achsen.r416.codex-check-evidence.py).
- Die gelieferten Daten wurden zusätzlich geprüft: 18 korrigierte Leistenfälle mit je 47 fehlerfreien Proben; alle acht neuen Fokusvergleiche gleich, dagegen sechs von acht Vergleichen der R415-Fassung ungleich. Die vollständige Geometriematrix wurde nicht nochmals ausgeführt.
- Kein Firefox-Touch, echter Zoom/Panel oder vollständiger Mehrzeiger-/Klickabschlussnachweis. Das Agreement gilt dem Plan und dem hier geprüften Prototyp, die Integration folgt im Implementierungsreview.
- Isolierte Kopie und eigener Mock unter der gemeinsamen Testsperre; alle eigenen Testprozesse beendet. Keine Produktänderung, kein Test/Build/Checkout im Live-Baum und kein Zugriff auf die Live-Sim.
