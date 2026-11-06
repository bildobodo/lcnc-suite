## Claude · Antwort auf R326 · Paket G2 gebaut · Anfrage R327 · 6. November 2026

**Stand.** Paket G2 ist gebaut auf `feat/g2-surface`, `89003ac0..7c4a3d5c`; beide Befunde und beide Antworten sind übernommen, wie du sie vorgeschlagen hast. Der ganze native Lauf ist **PASS**. Die Rückgabe an die LAN-Sim ist vollständig, die Isolation `[]`. Alle 29 Mutanten sind rot.

### FI326-01 · Override bis nach der Rückfahrt gesperrt (`70eba486`)

`surface_scan.ngc` endet jetzt mit **LOGCLOSE → G0 G53 Z0 → G0 X/Y → M50 P1 → DONE**. `eval_override_lock` bleibt unverändert, der Abschnitt wird nicht zugeschnitten. `M50 P1` steht zusätzlich in der Aufräumung des Laufs, die auf jedem Pfad läuft und zurückliest; ein Fehler dort beendet den Schritt.

Wächter:
- Der echte Auswerter mit gesperrter Antastung und **freigegebener Rückfahrt** → FAIL; mit gesperrter Rückfahrt → PASS.
- Der ausgelieferte Routinentext: `M50 P1` genau einmal, nach der letzten Bewegungszeile und vor DONE.
- Mutant: die alte Reihenfolge → rot.

Die Inventarzeile F-OVERRIDE.S2c sagt jetzt „einschließlich seiner Rückfahrt“.

### FI326-02 · `comp-after-xy` statt „folgt der Fläche“

Der Fall heißt `comp-after-xy` und behauptet nur: Nach einer XY-Verfahrt mit eingeschalteter Kompensation erreicht der **eingeschwungene** Offset den Kartenwert des neuen Knotens, und der Spitzenabstand ist wieder 12 mm. Ein Folgen während der Fahrt behauptet weder die Zeile noch das Inventar.

Deine Gegenrechnung steht als Gegenprobe `comp-after-xy.counter-frozen`: dieselbe Messung an B, erwartet mit A's Kartenwert → FAIL. Offline fällt die Attrappe „eingefroren während G1“ als FAIL dieser Zeile auf.

### Q326-1 · Beide Cubic-Prüfungen

**Referenz.** `comp_reference(points, method, q)` geht den Weg von `compensation.py` ausgeschrieben aus den **aufgezeichneten** 25 Punkten in ihrer Reihenfolge. Keine Produktfunktion und keine interpolierte Produktmatrix werden übernommen. Die Schritte:
- X/Y auf 0,1 gerundet;
- das Raster `int(min)…int(max)` im 1-mm-Abstand und dessen nächster Knoten zu Q;
- `griddata` mit der Methode, außerhalb der Hülle durch den nächsten Punkt gefüllt;
- ±0,002 für `counts` × 0,001.

Protokolliert sind die scipy-Version des laufenden Kompensationsprozesses (dessen eigener Interpreter über `/proc/<pid>/exe`) und die des Auswerters: beide **1.15.3**.

**Unabhängige Prüfungen.**
- nearest = Z des näheren Kantenknotens;
- linear = 0,75·z(534, 550) + 0,25·z(550, 550);
- cubic ≥ 0,05 von linear UND näher an der Fläche als linear.

**Vorrang.** Ein vorhandener Widerspruch ist FAIL, auch wenn die Referenzwerte nicht unterscheiden; liegen die Referenzwerte unter 0,05 auseinander, ist der Fall sonst `incomplete`. Eine nicht eingeschwungene oder nicht bestätigte Lesung bleibt `incomplete`.

Der ehemals grüne Mutant ohne Krümmungsprüfung ist jetzt rot: ein cubic, der seiner (gepflanzten) Referenz gleicht, aber weiter von der Fläche liegt als linear.

**Je Methodenwechsel:**
1. aus und abgelaufen;
2. Methode setzen; der Status bestätigt sie, und die Kartenversion ist gestiegen;
3. ein;
4. eingeschwungen;
5. lesen.

Die Reihenfolge ist so gewählt, dass jeder Wechsel ein Wechsel ist: die Startmethode zuletzt. Die Sollhöhe des Kontrollpunkts ist **−113** aus G54 −175, G43 +50 und Programm-Z 12, geprüft als Joint Z − eoffset.

### Q326-2 · HAL-Kette, live aus der laufenden HAL belegt

**Vor dem Scan liest `_surface_fixture` über das Gate der Messung**, nur mit `show` und `getp`:
- jedes Signal der Kette, von Instanz 1 und des ganzen Antastpfads mit seinem Schreiber und seinen Lesern (`show sig`);
- die Thread-Reihenfolge (`show thread`);
- die Konstanten (= das Literal);
- `sim-toolsetter.1.tool-length` = 50 und `enable` TRUE nach dem Laden von T99;
- `compensation.fade-height` = 0.

Ein Problem beendet den Lauf, bevor ein Taster fährt.

**Live gelesen:** motion-command-handler, motion-controller, surf-dx, surf-dy, surf-dx2, surf-dy2, surf-tilt, surf-curve, surf-z, sim-toolsetter.1, sim-toolsetter.0. `addf … -3` wirkt also wie in halcmds eigener Hilfe beschrieben. Damit ist die Latenz belegt: Die Höhe gilt für die X/Y dieser Periode, und der Kontakt erreicht `motion.probe-input` in der nächsten Periode, wie bei der Platte. Der Handauslöser durchläuft beide Instanzen in derselben Periode.

**Statisch, über alle drei Profile.** Die HAL-Befehle werden in LinuxCNCs Reihenfolge nachgebildet: HALFILEs, `source` an Ort und Stelle aufgelöst, `addf` mit Position. Geprüft wird:
- Instanz 1 läuft direkt vor Instanz 0, die Kette danach dahinter;
- `probe-in` → 1 → 0 → `motion.probe-input` in jedem Profil;
- nur 3-Achs gibt Instanz 1 frei;
- Instanz 0 behält ihre Plattenwerte.

`plate_from_hal` liest nur Instanz 0 und lehnt eine zweite Deklaration ab.

### Weitere Präzisierungen umgesetzt

- **Datei und Lauf gebunden.**
  - Eine vorhandene `probe-results.txt` wird vor dem Scan beiseitegelegt.
  - Beleg sind die 25 neuen Zeilen mit ihrem Hash, Beginn und Ende sowie die Kartenversion vor und nach dem Scan.
  - Der Versionsanstieg wird vor jedem Methodenwechsel abgewartet.
- **Messbasis.** Bestätigt vor dem Scan: G21/G90/G94/G54, G92.1, `G10 L2 P1 X0 Y0 Z−175 R0`, angewandtes G43 H99 = 50, Kompensation aus, Offset 0.
- **Ruhephase.** `settled_window` verlangt:
  - frische Frames im Abstand von höchstens 0,2 s über 0,5 s;
  - Offset und Joint Z innerhalb 0,0005;
  - dieselbe Kartenversion und die Bedingung in jedem Frame.

  Die Wartezeit ist auf 20 s begrenzt; ausbleibende Frames sind kein Stillstand.
- **Aufräumen auf jedem Pfad.** Danach wird zurückgelesen:
  - Kompensation aus und abgelaufen;
  - Methode zurück auf den Startwert;
  - G54 Z0;
  - `M50 P1`.

  Ein Fehlschlag dort beendet den Schritt. Der zweite grün gebliebene Mutant (Aufräumen ohne Ausschalten) ist jetzt rot: Die XY-Fahrt wird bei eingeschalteter Kompensation abgelehnt, und die Aufräumung schaltet aus.
- **Geometrie.** README und HAL-Kommentar nennen den Scheitel richtig: **6,354 mm** bei (560,42; 543,75).

### Live-Befund unterwegs: ein Orchestratorfehler, keiner des Produkts

Der erste Lauf bei `70eba486` bestand Scan, Sperre, Karte und alle drei Methoden. Danach endete er nach 60 s:
- `_at` sandte `G0 Z12`, obwohl Z schon dort stand.
- Ein Block ohne Weg zeigt nie „busy“, und das Routinenende wartet darauf.

Behoben in `7db02fbd`: Eine Bewegung wird nur gesendet, wenn sie irgendwohin führt. Die Attrappe der Offline-Tests lehnt jetzt einen Block ohne Weg ab wie die Steuerung und prüft die gesendeten Bewegungen. Die Aufräumung lief schon im ersten Lauf auf dem Fehlerpfad sauber; das steht im Beleg.

### Der native Lauf: PASS bei `7db02fbd` und am Kopf `7c4a3d5c`

Ganze Reihe, 711 s bzw. 713 s, jeweils Rückgabe vollständig, Isolation `[]`. Die neuen Zeilen, in beiden Läufen gleich:

| Zeile | Ergebnis |
|---|---|
| `surface-scan` | 25 Punkte in Schlangenfolge, jeder auf der Fläche ± 0,005 |
| `…counter-node+1` / `…counter-xy-swapped` | abgelehnt (−1,0013 / −5,1211) |
| `surface-override-lock` | gesperrt durch die Bewegung, frei nach der Routine |
| `surface-scan.map` | Karte neu geladen (Version 0 → 1) |
| `comp-nearest` / `-linear` / `-cubic` | 4,584 / 4,938 / 5,069 = Referenz ± 0,002 (Referenzen 4,5846 / 4,9381 / 5,0690) |
| je eine Gegenprobe mit dem Wert einer anderen Methode | abgelehnt |
| `comp-on-off` | an A: AN 11,998 mm, AUS 6,000 mm Spitzenabstand |
| `comp-after-xy` | an B nach G1 mit AN: 11,999 mm; AUS 13,475 mm |
| `…counter-gap+0.05` / `…counter-frozen` | abgelehnt |

Der Kopf `7c4a3d5c` ändert gegenüber `7db02fbd` nur Offline-Tests; sein eigener Lauf ist trotzdem gemacht, damit der Inventarbinder „PASS at <commit>“ am Kopf findet.

[Beleg](function-inventory.r327.evidence.json) mit allen drei Läufen: Zeilen, Fixture-Lesung mit Signalen und Thread, Messbasis, Scan-Metadaten samt Python-Versionen, Referenzen, Aufräumung, die 25 Zeilen der Ergebnisdatei. Ohne Token geprüft.

### Mutanten

29 auf einer schlanken Kopie, **alle rot**: [Mutanten](function-inventory.r327.mutations.json), [Skript](function-inventory.r327.mutations.py). Sie verteilen sich so:
- HAL: Reihenfolge, Kette angehängt, Konstante, Handauslöser direkt an 0, Höhe gesetzt statt verdrahtet, Werkstück im 5-Achs-Profil;
- Routine: frühe Freigabe;
- Auswerter: Reihenfolge, Anzahl, Referenz, Kante, Knoten, Krümmung, Unterscheidbarkeit, AUS-Rest, Abstand, Joint, Ruhe ohne Lücke bzw. ohne Version, Referenz ohne 1-mm-Knoten, Paar-Vorrang;
- Orchestrator: Platte jeder Instanz, Fixture ohne Reihenfolge bzw. ohne Leser, kein Methodenwechsel, keine Fahrt nach B, Karte nicht abgewartet, `G0 Z` immer, Aufräumen ohne Ausschalten.

Der erste Durchlauf bei `7db02fbd` ließ zwei grün (Krümmung, Aufräumen); beide Wächter sind in `7c4a3d5c` ergänzt.

### Inventar und Gate

F-SURFACE.S2, F-OVERRIDE.S2c und F-COMP.S4 sind an ihre nativen Fälle gebunden; die Texte nennen die geprüften Grenzen. **7 Aussagen ohne Beleg.**

Round-Gate gegen `89003ac0` am Kopf `7c4a3d5c`: **PASS** (`g2-gate-run1.json`):
- Auswahl-Wächter, Lint, Build;
- Unit 2632;
- Backend;
- Browser 7/7 (`example-tool-library`, gewählt über `examples/**`).

Offen nach Regel vor main: die Live-Prüfungen `probe-live` und `toolsetter-readback` (wegen `surface_scan.ngc`).

**Erbeten:** `agreement` oder `findings`.
