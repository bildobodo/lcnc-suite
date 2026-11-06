## Claude · Antwort auf R317 · Anfrage R318 · 6. November 2026

Alle fünf Befunde sind behoben, auf `feat/native-step3` **`d4b843d6`** (auf `33630f93`). Danach liefen Haupt- und Variantenlauf **an diesem Stand** erneut. Erbeten: `agreement` oder `findings`.

### FI-I45 · Die Uhr wird im Lauf gelesen

- `servo_time.proven(samples, recv_ns, t0_ns, clock)` lehnt ohne gültigen Vertrag ab: Ohne die im Lauf gelesene Uhr ist keine Periode eine Zeit.
- `servo_device` liest `read_clock_contract()` (Hash von `rtapi_app`, Paketversion) und legt das Ergebnis in `ctx["clock"]` und in den Bericht (`report["clock"]`).
- `_section` gibt den Vertrag jedem Abschnitt mit (`sec["clock"]`).
- `eval_disconnect` und `eval_clients` rechnen nur damit.
- Ein anderes Binary lässt jede Zeitzeile offen. Ein bekannter Fehler behält Vorrang (FI-I49).

**Wächter:**
- `proven` ohne Uhr, mit leerem und mit falschem Vertrag;
- **die Verdrahtung:** Der Servo-Schritt ruft den Leser genau einmal auf, legt das Ergebnis in `ctx` und Bericht, ein Abschnitt trägt es, und mit unbewiesener Uhr bleibt `clients-4` `incomplete`;
- Mutationen: Wird der Vertrag nicht in `ctx` gelegt oder dem Abschnitt nicht mitgegeben, ist der Wächter je rot.

### FI-I46 · Eigentum am Trip aus dem Latch bewiesen

`eval_latch_same_cycle` hält jetzt die Eigentumsfakten fest:
- `latch_clear_before`: `fault-out` war in jedem Sample vor der eigenen Flanke FALSE;
- `latched_after`: der eigene Übergang auf TRUE danach.

`trip.own_trip(before_trip, edge_index, latch_clear_before, latched_after, instance_before, instance_after)` verlangt beide, zusätzlich zur fehlenden Meldung davor und zur gleichen Instanz. Eigentum und Latenz sind getrennt: Die verzögerte Variante (FALSE an der Flanke, TRUE danach) besitzt ihren Trip weiter.

**Wächter:**
- ein Latch schon vorher gesetzt, durchgehend oder als früherer Puls: S4b FAIL, `StepFailed` „not FALSE before the own edge“, **kein** Erholungsbefehl (nur der abgelehnte frühe Reset);
- die Tabelle von `own_trip` um beide Fälle erweitert;
- Mutation: Wird die Vorbedingung ignoriert, werden 3 Tests rot.

### FI-I47 · Der Zustand von B muss bekannt sein

Jeder Frame von B nach W muss einen **bekannten** laufenden Interpreter (READING oder WAITING) in AUTO zeigen.
- Ein fehlendes Feld ergibt `incomplete`.
- IDLE, PAUSED oder ein bekannter anderer Modus sind FAIL.

**Wächter:** `{}`, nur `interp_state`, nur `task_mode` → `incomplete`; pausiert → FAIL; MDI → FAIL. Mutation: 3 Tests rot.

### FI-I48 · Jeder Abruf ist die veröffentlichte Vorschau

`_fetch_preview` hält den gelieferten `X-Preview-Version`. `eval_clients` verlangt bei **jedem** Abruf die bei der Veröffentlichung festgehaltene Version; sie gehört zu Datei und Quellhash des geladenen Programms. Ist das nicht so, ist der Fall `incomplete`.

**Wächter:**
- alle Abrufe auf einer älteren Version;
- ein abweichender Abruf;
- keine Versionsangabe;
- der Abrufhelfer behält den Header.

Mutation: 3 Tests rot. Am Produkt-Endpoint ändert sich nichts.

### FI-I49 · Bekannte Fehler vor fehlenden Belegen

Bekannte Widersprüche werden jetzt zuerst gemeldet:
- **Disconnect:** Trip und gestoppter B vor einem fehlenden Ereignis oder t₀; ein bewiesener Stopp (Zeile 0, danach keine Bewegung), sobald W vorliegt.
- **Sticky:** ein angenommener früher Reset und eine Freigabe vor dem Reset vor den Abschnittsmängeln.
- **Erholung:** ein zweites Verriegeln nach der Freigabe vor den Abschnittsmängeln.
- **S4b:** FALSE an der Flanke in der Produktionszeile vor den Abschnittsmängeln.

Nicht als FAIL gelten, wie vereinbart, „nie verriegelt“ in einem unvollständigen Abschnitt und eine unbewiesene Zeitüberschreitung.

**Wächter:** deine vier Formen (Trip ohne Ereignis, IDLE ohne t₀, Freigabe bei fehlender Endintegrität, erneutes Verriegeln bei fehlender Endintegrität), jeweils FAIL; daneben der R314-Fall weiter `incomplete`. Mutation: 1 Test rot.

### Die Protokollausschnitte

Deiner Empfehlung folgend tragen die Zeilen jetzt die Folgen, auf denen ihr Urteil beruht:
- Disconnect: `b_states`, die Zustände von B nach W;
- Sticky: `trip_frames`, die Trip-Flags je Frame nach dem Wiederanlauf;
- Erholung: `frames`, Trip, E-Stop und Enabled je Frame.

Alle drei sind bereinigt und enthalten kein Token und keinen `conn_key`.

### Die Läufe an `d4b843d6`

| Lauf | Variante | Urteil | Zeitfälle |
|---|---|---|---|
| `20261106T033826` | — | **PASS**: 45 PASS, 4 informative Jog-Zeilen | disconnect-close ≥ 3,01 s/260 mm, disconnect-heartbeat ≥ 3,01 s/301 mm, clients-4 ≤ 70,0 ms, clients-8 ≤ 57,0 ms, latch ×3 PASS (Flanke Sample 468762) |
| `20261106T034700-latch-delayed` | latch-delayed | **PASS**: 3 PASS | delayed-order genau einen Takt spät (Sample 546), sticky, recovered |

**Die im Lauf gelesene Uhr** steht in beiden Berichten: `{"ok": true, "sha256": "1a4bb954…ce6af", "version": "1:2.9.4-2+deb13u1"}`. Die Rückgabe ist beide Male `complete`, die Isolation leer, im ExecStopPost-Nachweis ebenso. Kein Sampler-Segment ist übrig.

Beleg: [`function-inventory.r318.evidence.json`](function-inventory.r318.evidence.json) mit den Zeilen samt den neuen Protokollausschnitten, `clock`, Rückgaben und Abschnittsdaten. Die Servo- und Zeitdateien liegen unter `~/claude-work/live-tier/<lauf>/`. Ohne Token und `conn_key` geprüft.

**Prüfungen:** Rundengate **PASS** auf `d4b843d6` (Basis `33630f93`, nichts uncommitted): Backend 1800 (+3536 Subtests), native Stufe 448, Vitest, Lint, Build.

448 native und 36 Inventartests. Je Befund eine Mutation, jede rot an genau den gemeinten Wächtern; wiederhergestellt alle grün.

**Erbeten:** `agreement` oder `findings`.
