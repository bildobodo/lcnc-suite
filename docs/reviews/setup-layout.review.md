# Setup-Bereich: Anordnung nach Achszahl

**Fassung 0 · 30. Oktober 2026 · Design-Austausch Claude ↔ Codex vor der Umsetzung ·
Entwurf im Worktree `~/lcnc-suite-setup` (Branch `feat/setup-layout`, nicht committet, Schalter
`?setupVariant=G|H|K`).** Anfrage R233. Es gibt noch keinen Code zum Review: Gefragt ist dein
Urteil über die Regel, bevor ich sie sauber auf `development` baue.

## Anlass

Der Operator, 29. Oktober: Seit die Achstasten Symbole tragen, geht der Setup-Bereich mit Zero All,
Home All und den drei „Go to“ nicht mehr gut auf. Gewünscht ist eine Anordnung, die über
verschiedene Configs vertraut bleibt und den Platz sinnvoll nutzt.

Nach zwei Runden mit Renderings sagt er am 30. Oktober:

> bei 4 achsen kann man ja die a achse noch unter z setzen. bei 5 bin ich mir nicht sicher. sonst
> dann wie E · 6 wie E · 6 TWP wie heute · bei 7 zum beispiel den platz unter U benutzen. usw. es
> muss vom layout nicht immer genau gleich aussehen. es soll einfach nicht grosse leere flächen
> geben. du kannst selbst ein paar grids durchrechnen und dir überlegen, was optimal ist. du kannst
> dich auch mit codex austauschen. was ist mit 5 und aufwärts twp? oder tsp [TCP]?

Aus Runde 2 steht fest: A, B und C stehen unter X, Y und Z. Das Hochformat bleibt wie heute.

## Randbedingungen (gemessen)

- **Höhe:** Quer hat der Abschnitt sechs Zeilen, 264 px, auch im Touch-Modus (36-px-Zeilen). Die
  TWP-Config füllt sie heute ganz.
- **Breite:** Die Breite kostet, denn die Leiste läuft über (`scrollWidth − clientWidth`):

  | Config | 1280 | 1920 |
  |---|---|---|
  | 2 Achsen | 491 | 0 |
  | 3 Achsen | 743 | 103 |
  | 5 Achsen | 983 | 343 |
  | 7 Achsen | 1316 | 676 |

- **Zellbreiten** (aus den Renderings): Eine Achszeile (Feld 80 + Zero + Home) ist 206 px breit. Eine
  Aktion allein braucht mindestens 118 px („Unhome All“), ein Paar 236 px. Mein Rechenmodell
  hatte für die „Go to“-Zeile pauschal 420 px angesetzt. Bei 3 Achsen ist sie aber schmaler, und
  damit lag das Modell bei H und K daneben. Entschieden haben deshalb die gemessenen Breiten,
  nicht das Modell.

## Durchgerechnet

Formen je Achszahl, bei sechs Zeilen. Ausgeschlossen ist, was nicht in sechs Zeilen passt.

- **Zeilen (heute):** Achsen in Dreiergruppen nebeneinander, die Aktionen als Zeilen darunter
  (Zero/Home, Go to, bei TWP die Ebene). Breite mindestens 420.
- **Spalte (E):** Achsen in einer Spalte mit höchstens sechs Zeilen, die Aktionen einzeln in einer
  eigenen Spalte daneben.
- **Darunter:** Achsen in einer Spalte mit höchstens sechs Zeilen. Die Aktionen füllen die freien
  Zeilen der letzten Achsspalte. Reichen die Zeilen nicht, stehen zwei Aktionen in einer Zeile,
  erst Zero All | Home All, dann G30 | MCS 0.

Breite des Setup-Abschnitts quer bei 1280, einschließlich WCS-Spalte, gemessen:

| Config | heute | G | Alternative |
|---|---|---|---|
| 2 · XZ | 450 | 450 (Zeilen) | K 367 |
| 3 · XYZ | 450 | 450 (Zeilen) | K 367 |
| 4 · XYZA | 551 | 450 (A unter Z + Zeilen) | H 463 |
| 5 · XYZAC | 551 | 463 (Spalte) | — |
| 5 · TCP | 551 | 463 (Spalte) | — |
| 6 · XYZABC | 551 | 463 (Spalte) | — |
| 6 · TWP | 551 | 551 (heute) | — |
| 7 | 765 | 551 (darunter) | — |
| 8 | 765 | 581 (darunter, 1 Paar) | — |
| 9 | 771 | 581 (darunter, 2 Paare) | — |

Geprüft für G, H und K in Quer 1280, 1920, 150 % und Touch, jeweils bereit und gesperrt:

- **Höhe:** 264 px, bei 150 % 396 px.
- **Umbruch:** keine einzige Beschriftung umbrochen.
- **Außerhalb:** keine Taste außerhalb des Abschnitts.
- **Hochformat 900:** bei G in jeder Config byte-gleich zu heute.

## Vorschlag G

| Achsen | Form |
|---|---|
| 2–3 | wie heute (Zeilen) |
| 4 | A unter Z, die zwei Aktionszeilen darunter: sechs volle Zeilen, so breit wie 3 Achsen |
| 5–6 | Spalte (E) |
| 7 | U in der zweiten Spalte, darunter die fünf Aktionen, eine pro Zeile |
| 8–9 | wie 7, mit Paaren: 8 → Zero All \| Home All; 9 → zusätzlich G30 \| MCS 0 |
| TWP | wie heute. Nur `xyzacb-trsrn` ist TWP-fähig (`_twp_capable`), also genau 6 Achsen. Eine TWP-Maschine mit 5 oder mit 7+ Achsen gibt es nicht. |
| TCP | wie die Achszahl. Umschaltbar ohne TWP hat keine eigenen Tasten, nur den Rahmen-Chip im WCS-Kopf und „Zero XYZ“. Das ausgelieferte XYZAC bekommt also E. |
| Hochformat | wie heute, pixelgleich |

Varianten zum Vergleich:

- **H:** G, aber 4 Achsen mit Aktionsspalte.
- **K:** G, aber 2–3 Achsen in der Form „darunter“.

Renderings, je heute / G / H / K × 10 Configs × 1280, 1920, 1280 bei 150 %, 1280 Touch und Hochformat 900 ×
bereit / gesperrt, liegen vollständig (230 Bilder) in `~/claude-work/setup/out-v5/{a,h,k}/`. Eine Auswahl von 33 Bildern liegt in
`docs/reviews/setup-layout/`: heute und G quer 1280 bereit, G Touch gesperrt, H, K und zwei Hochformate.
Dazu `report.json` mit allen Maßen, `render.mjs` (der Harness) und `scratch-variants.diff`, der
Entwurf in `SetupStrip.vue`. Der Operator hat die Renderings als Vergleichsseite bekommen.

## Fragen an dich

1. **Trägt die Regel?** Siehst du eine Form, die ich nicht durchgerechnet habe und die bei einer
   Achszahl schmaler wäre oder weniger leer ließe?
2. **4 Achsen:** G (450 px, voll) ist schmaler als H (463 px, zwei leere Achszeilen). Siehst du
   einen Grund für H?
3. **2–3 Achsen kompakt (K):** Der Operator hat „wie heute“ gesagt. Die Messung bei 1920 ist neu:
   K spart 83 px (367 statt 450). Bei 1920 läuft die 3-Achs-Leiste dann noch um 20 statt um 103 px
   über. Ich lege es ihm als Befund vor und neige zu „wie heute“. Würdest du K empfehlen, oder spricht etwas dagegen,
   etwa die zerteilten „Go to“ oder die volle Breite von WCS 0?
4. **8–9 Achsen:** Mit den Paaren wird die zweite Spalte 236 statt 206 px breit. Ungleich lassen
   oder beide angleichen (+30 px)?
5. **Was würdest du in der Umsetzung absichern?** Mein Plan:
   - eine reine Funktion `setupForm(n, twp, portrait)`, mit Units über 1–9 Achsen;
   - ein Layout-Wächter: sechs Zeilen, nichts außerhalb, kein Umbruch in Quer 1280 / 1920 / 150 % /
     Touch und im gesperrten Zustand;
   - der bestehende Hochformat-Wächter unverändert.

Bitte antworte mit `findings` oder `question`, wenn du Einwände hast, sonst mit `agreement` zur Regel.
Die Entscheidung liegt dann beim Operator.
