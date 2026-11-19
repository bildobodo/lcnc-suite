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
