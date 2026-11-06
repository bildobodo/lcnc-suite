## Claude · Inventar nach R319 · Anfrage R320 · 6. November 2026

Nur die Inventardaten ändern sich, auf `feat/native-step3` **`41d0d1ab`** (auf `e4cb0c82`). Neun Aussagen trugen noch die Lücke „der native Lauf steht aus“. Ihre nativen Belege sind im abgenommenen Schlusslauf `20261106T040338` an **`e4cb0c82`** alle PASS. Gelesen ist das nach der eigenen Regel des Inventars (`functions.native_status`: gleicher Commit, gleiches Profil, gleicher Fall, gleiche Variante):

| Aussage | Belege → Status |
|---|---|
| F-HOME.S2c | home-all, home-joint-0/1/2 → PASS at e4cb0c82 |
| F-JOG.S5 | jog-x±.servo, jog-y±.servo, jog-z±.servo → PASS at e4cb0c82 (die Statusframe-Zeilen sind nicht gebunden; informativ nach R302) |
| F-GOTO.S1c | goto-zero, goto-home, goto-g30, goto-zero.counter-xy-first → PASS at e4cb0c82 |
| F-OVERRIDE.S2 | override-plateau-100/-50, override-plateau.counter-75 → PASS at e4cb0c82 |
| F-OVERRIDE.S2b | m600-t1-override-lock → PASS at e4cb0c82 |
| F-TOOLCHANGE.S2 | m6-hold → PASS at e4cb0c82 |
| F-TOOLMEASURE.S5 | m600-t1, m600-t1.counter-3102 → PASS at e4cb0c82 |
| F-TOOLMEASURE.S6b | m600-unload → PASS at e4cb0c82 |
| F-PROBE.S3 | probe-z, probe-z.counter-plate-1, probe-z-miss → PASS at e4cb0c82 |

**Änderungen:**
- Bei acht Aussagen fällt die Lücke weg.
- F-GOTO.S1c behält ihre tatsächliche Grenze: „→ G30 ohne Abstieg: #5183 = 0 in der Kopie, der Abstieg auf #5183 nach X/Y nicht ausgeübt“.

Inventartests: 36 PASS.

Die übrigen 16 Lücken sind eigene Pakete:
- Browser- und Gateway-Wächter: F-ARM.S3b, F-TRIP.S1b, F-SIMTRIP.S2, F-HOME.S2b, F-JOG.S5b, F-LOAD.S3, F-TOOLEDIT.S4, F-TOOLMEASURE.S4b, F-MACROFILES.S3, SYS-CONN.S5;
- native Fälle: F-COOLANT.S2, F-TOUCHOFF.S3b, F-TWP.S3, F-SURFACE.S2, F-COMP.S4, F-OVERRIDE.S2c.

Diese ändert diese Runde nicht.

**Erbeten:** `agreement` oder `findings` zu diesen neun Inventaränderungen.
