# Sim-Tab-Marken auf der Zeilenlinie, dazu die zwei Korrekturen des Merges

## Claude · Umsetzung · Anfrage R266 · 3. November 2026

**Anlass.** Der Operator sah sich die LAN-Vorschau an. „Die Highlights sehen gut aus“, also ist gemergt. Seine eine Bemerkung: „Im Sim-Tab scheinen die blauen Punkte, gelben Dreiecke und Kreuze noch nicht ganz auf einer Linie mit der übrigen Zeile zu sein. Anders als beim Program-Tab.“

**Stand.**
- **development `ddd2c4fe`** in dieser Reihenfolge:
  1. Snap per Fast-Forward;
  2. `fix/probe-vars` (`78495b08`);
  3. `feat/per-worker-mock` (`77d6c4d8`);
  4. zwei Korrekturen des Merges (`3e52650f`, `fd70a210`);
  5. das Merge-Gate-PASS.
- **Die Marken-Korrektur** liegt auf `fix/sim-mark-align` `8fa4fd15`, auf `ddd2c4fe`.
- **Die LAN-Sim** läuft auf `8fa4fd15`.

### 1 · Die Marken im Sim-Tab (`8fa4fd15`)

**Ursache.**
- **Sim-Tab:** Die Marke ist ein Inline-SVG direkt in `td.colKind`. Sie steht auf der Grundlinie der Schrift, jede Größe (× 12, ▲ 11, ● 10 px) auf ihrer eigenen Höhe über der Zeilenmitte.
- **Program-Tab:** Dort sitzt die Marke in `.lineMark` (`inline-flex`, `align-items: center`) in der Flex-Zeile `.codeLine`, also zentriert auf der Zeile.

**Korrektur.** `SimPanel.vue`, nur Layout: `.colKind svg { display: block; margin-inline: auto; }`. Die Zelle zentriert die Marke auf ihrer Zeile wie der Program-Tab.

**Wächter.** `sim-panel.viewer.spec.ts` „a mark's glyph sits on its row's line — in the Sim tab as in the Program tab“, auf Desktop und Full-HD-Touch.
- **Was gemessen wird:** die Mitte der Glyphen-Box gegen die Mitte der Textbox der Zeilennummer. Die Textbox kommt aus einer Range über das Label; die Content-Box von Inter und JetBrains Mono ist auf ihren Ziffern zentriert.
- **Toleranz:** |d| ≤ 0,75 px.
- **Was geprüft wird:**
  - die sechs Zeilen des Sim-Tabs: zwei Kollisionen, zwei Limits, zwei Werkzeugwechsel;
  - die drei Glyphen der Zusammenfassungszeile neben ihren Worten;
  - zum Vergleich die fünf markierten Zeilen des Program-Tabs.

**Rot und grün** (`sim-mark-align.red.txt`):
- **Ohne die Regel:** 2/2 rot, Sim-Tab `[-1,-2,-1,-1.5,-2,-1.5]`, über der Linie und je nach Art verschieden.
- **Mit der Regel:** Die Schwelle wurde einmal unter null gezwungen, nur um die Werte auszugeben:
  - Sim-Tab: 0,25 ×6
  - Zusammenfassung: 0,5 ×3
  - Program-Tab: 0,5 ×5 auf Desktop, 0,59 ×5 auf Touch
- **Der Wächter wie committet:** 2/2 grün.

### 2 · Die Korrekturen des Merges

**`3e52650f`, die neue Datei ohne Regel.** `toolMarks.ts` kam neu aus dem Snap-Zweig. Die Regeltabelle aus den Test-Stufen kannte die Datei nicht, darum war der Wächter rot, der für jede Datei eine Regel verlangt (`test_selector.py`). Sie steht jetzt neben `limitMarks.ts`:
- in der Regel für den Program-Tab;
- in der Regel „the running line and the marks: the code panel and the Sim tab“.

`test_selector.py` 44/44.

**`fd70a210`, der First-Touch-Test auf einem Pfad.** Der erste Merge-Lauf war 849/850 (`merge-20261103.gate-round.run1.json`). Rot war `collisions.viewer` „the first touch shows while the near miss's acknowledgement is held“, mit `ivs[0]` gleich 1 statt 0. Belege in `merge-20261103.first-touch.txt`:
- **Allein:** 10/10 grün.
- **Unter Last** (3 Worker, 3 Brenner): 2/12 rot.
- **Eine protokollierende Kopie** zeigt die Ursache:
  - Der Pool hat 4 Shards. Fast-Berührung und Berührung gehören zwei Paaren auf zwei Shards.
  - Unter Last war Shard 0 schon an L4007, bevor Shard 1 seine erste Scheibe beendet hatte. Die erste Nachricht des Pools trug darum die Berührung.
  - Es gab also kein ausstehendes Delta, neben das sie hätte gehen können. Die Seite zeigte die Berührung sofort. C2 hält, nur die Vorbedingung des Tests nicht.
- **Korrektur:**
  - `setCollisionShards(1)` vor dem Veröffentlichen. Auf einem Pfad kommen beide in Programmreihenfolge, Scheiben auseinander.
  - Der Test verlangt jetzt auch, dass der Lauf auf einem Shard lief.
  - Die Pool-Regel selbst hält weiter `collisionWorker.test.ts` „the pool: the request's first interval goes to the owner beside a message still unacknowledged — once (C2)“.
- **Nach der Korrektur, unter Last:** 18/18 grün.
- **Empfindlichkeit:** C2 im Einzelpfad entfernt (`inFlight > (firstIntervalUnsent ? 1 : 0)` → `inFlight > 0`): 2/2 rot an „the touch, its acknowledgements held“.

**Merge-Gate-Lauf 2** an `fd70a210` (`merge-20261103.gate-round.json`): **PASS**.
- Lint, Build, 2577 Unit-Tests, Backend.
- Browser 850/850 auf 3 Workern; Worker-Nachweis unter seiner Laufkennung, 3 Mocks.
- Heavy Units nicht gewählt: Kein Kollisionsmodul hat sich geändert.

### Runden-Gate

`sim-mark-align.gate-round.json` an `8fa4fd15`, Basis `ddd2c4fe` (Record-Commit `98beef82`): **PASS**. Lint, Build, 2577 Unit-Tests, Browser 414/414 ausgewählt: die UI-Prüfung und die Viewer-Specs, 3 Worker, Worker-Nachweis.

**Bitte prüfen:** Ursache und Korrektur der Marken, der Wächter. Und ob die zwei Merge-Korrekturen tragen, vor allem, ob der Test auf einem Pfad noch prüft, was C2 verspricht.

Wenn das trägt, bitte `agreement`. Dann geht `fix/sim-mark-align` nach dem Blick des Operators per Fast-Forward nach development.
