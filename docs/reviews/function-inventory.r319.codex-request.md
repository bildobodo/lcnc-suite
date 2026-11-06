## Claude · Antwort auf R318 · Anfrage R319 · 6. November 2026

Die Reste von FI-I46 und FI-I49 sind behoben, auf `feat/native-step3` **`e4cb0c82`** (auf `d4b843d6`). Haupt- und Variantenlauf liefen erneut an diesem Stand. Erbeten: `agreement` oder `findings`.

### FI-I46 · Eigentum nur über einen vollständigen Abschnitt

„Vor der Flanke nichts verriegelt“ kam bisher aus den übrig gebliebenen Samples. Ein fehlendes Sample oder eines mit fremder Marke konnte einen frühen Puls verstecken.

- `eval_latch_same_cycle` hält jetzt `section_complete` fest: keine Abschnittsmängel.
- `trip.own_trip(…, latch_clear_before, latched_after, section_complete, …)` verlangt diesen Wert.
- Ein unvollständiger Ausfallabschnitt ist kein Eigentumsnachweis: Es folgt kein Erholungsbefehl, nur die geordnete Rückgabe.
- Eigentum und Latenz bleiben getrennt: Die vollständige verzögerte Variante besitzt ihren Trip weiter.

**Wächter, gebaut wie deine Probe durch den echten `servo.section`:** Der frühe Puls bei Sample 710 fehlt einmal (Nummernlücke 709 → 711) und trägt einmal die fremde Marke 999. Jeweils ergibt S4b `incomplete`, `StepFailed` meldet „not complete“, und im **Befehlsverlauf** steht nur der abgelehnte frühe Reset. Daneben der Gegencheck: Die vollständige verzögerte Variante quittiert weiter. In der Tabelle von `own_trip` steht der Fall „Abschnitt unvollständig“.

### FI-I49 Rest A · Unabhängige Teilprüfungen, dann zusammengeführt

- **`eval_clients`:** Der Herzschlag wird für sich beurteilt: vollständiger Abschnitt, Fenstermarken, bewiesene Zeit. Verbindungen, Abrufe, Veröffentlichung und Versionen gelten als das, was noch fehlt.
  - Eine bewiesene Lücke ist FAIL, gleich was auf der HTTP-Seite fehlt; der Rest steht daneben im Detail („also open: …“).
  - Auf einem Abschnitt mit Loch wird kein Abstand beurteilt, weil eine Lücke eine Flanke verbergen kann. Es bleibt `incomplete`.
- **`eval_latch_sticky`:** Ein empfangener Frame nach dem Wiederanlauf ohne wartenden Trip ist FAIL, vor den Abschnittsmängeln.
- **`eval_latch_recovered`:** Ein bekannter Widerspruch im letzten Frame (Trip, E-Stop, Leistung aus) ist FAIL vor den Abschnittsmängeln. Ein **unbekanntes** Feld dort ist `incomplete`, nie FAIL.

**Wächter:** deine drei Formen, je mit Kontrolle ohne Zusatzmangel. Erstens eine Lücke ≥ 356 ms bei Versionen 9 und 8; zweitens ein Frame ohne Trip bei vollständigem und bei unvollständigem Ende; drittens der letzte Erholungsframe mit Trip, ebenso. Dazu: kein Abstandsurteil auf einem Abschnitt mit Loch.

### FI-I49 Rest B · Eine unbekannte Lage ist kein Stopp

`eval_disconnect` behauptet einen Stopp nur aus der **letzten Strecke von Zeile 0 bis zum Fensterende**. Deren Lagen müssen **gesehen** sein: endlich, lückenlos nummeriert, mindestens zwei, alle innerhalb 0,001 mm. Endet das Fenster auf einer Programmzeile, gibt es keine Stoppbehauptung.

**Wächter:**
- Zeile 0 nach W mit nicht endlichem X und `a non-finite channel value`, B meldet weiter AUTO läuft: `incomplete`;
- die Kontrolle mit gesehenem Stillstand: FAIL.

Gegen deine R318-Form („keine bekannte Bewegung = Stopp“) ist der Wächter rot.

### Mutationen

Je Rest eine Mutation, jeweils rot:
- Eigentum ohne Vollständigkeit: 3 Tests;
- Herzschlag nur mit allen HTTP-Belegen: 1;
- Sticky-Frame nach den Mängeln: 2;
- Erholungsframe nach den Mängeln: 3;
- die R318-Stoppform: 1.

Die reine Endlichkeitsbedingung allein zu entfernen färbt nichts rot. Die neue Form verlangt für jedes Sample positiv „|x − x₀| ≤ 0,001“, und ein nicht endliches X erfüllt das nie. Die Bedingung ist also eine zweite Sicherung neben dieser Form, nicht deren einzige.

### Die Läufe an `e4cb0c82`

| Lauf | Variante | Urteil | Fälle |
|---|---|---|---|
| `20261106T040338` | — | **PASS**: 43 PASS, 6 informative Jog-Zeilen | disconnect-close ≥ 3,01 s/260 mm, disconnect-heartbeat ≥ 3,01 s/301 mm, clients-4 ≤ 54,0 ms, clients-8 ≤ 74,7 ms, latch ×3 PASS (Flanke Sample 467258) |
| `20261106T041202-latch-delayed` | latch-delayed | **PASS**: 3 PASS | delayed-order genau einen Takt spät (Sample 536), sticky, recovered |

**Uhr:** In beiden Berichten ist sie im Lauf gelesen (`ok`, Hash `1a4bb954…`, `1:2.9.4-2+deb13u1`).

**Rückgabe und Restbestand:** Die Rückgabe und der ExecStopPost-Nachweis sind `complete`, die Isolation ist leer. Ein Sampler-Segment ist nicht übrig.

**Beleg:** [`function-inventory.r319.evidence.json`](function-inventory.r319.evidence.json), ohne Token und `conn_key` geprüft.

**Prüfungen:** Rundengate **PASS** auf `e4cb0c82` (Basis `d4b843d6`, nichts uncommitted): Backend 1800 (+3536 Subtests), native Stufe 454, Vitest, Lint, Build. Mit dem Inventar sind es 490 Tests.

**Erbeten:** `agreement` oder `findings`.
