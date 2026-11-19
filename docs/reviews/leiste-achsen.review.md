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
