## Claude · Antwort auf R315 · Anfrage R316 · 6. November 2026

**Stufe 3, Planfassung 8: nur der Urteilsrest von FI313-01.** Nichts gebaut. Alles andere aus Planfassung 7 gilt, mit deinen Präzisierungen.

### Die dreistufige Regel, ausdrücklich

| Befund | Urteil |
|---|---|
| Zeitbeleg fehlt oder ist ungültig (Uhr nicht bewiesen, Überlauf nicht ausgeschlossen, negativer Rest, eine Periode außerhalb des bewiesenen Bereichs) | `incomplete` |
| obere Grenze ≤ 250 ms | PASS |
| untere Grenze > 250 ms | FAIL |
| sonst | `incomplete` |

Ein bekannter anderer Fehler, etwa ein Trip oder `fault-out` TRUE, bleibt FAIL und wird nicht herabgestuft.

**Der Gegenfall aus R314 ist berichtigt:** 100 ms Verzögerung zwischen Controller und Sampler bei der zweiten Flanke ergibt Grenzen 198…302 ms, also **`incomplete`**. Dasselbe gilt für den gleich beobachteten Verlauf 200/200 ms. Mein Satz „obere Grenze ≥ 300 ms: FAIL“ in Planfassung 7 war falsch. Weiter gilt: 260 ms ergibt 258…262 ms und FAIL; 100 ms ergibt 98…102 ms und PASS.

### Die Präzisierungen für den Bau, übernommen

- **Gültigkeitsbereich:** Jede verwendete Periode, auch an den Rändern (i−1 … j+1 und a+2 … b), liegt im bewiesenen Bereich first+2 … b eines Abschnitts. Keine Summe greift über eine unbelegte Abschnittsgrenze. Bei aneinander grenzenden Abschnitten (A → B → C → D) gilt der Nachweis über den ganzen, lückenlos nummerierten Bereich mit dem t₀ der ersten Marke.
- **Rest:** Für den Rest gilt `0 ≤ Rest < 2³²`. Ein negativer Rest ist ein widersprüchlicher Zeitbeleg und ergibt `incomplete`. Genau 2³² ergibt ebenfalls `incomplete`.
- **Ganzzahlig:** Markenzeit und Empfangszeit kommen aus `time.monotonic_ns()`; die Rechnung ist durchgehend ganzzahlig in ns. Die `last-period` ist u32 und wird so gelesen.
- **Die Uhr wird nur über den geprüften Binary-Hash bewiesen:** `1a4bb954a645cc86a4109b363f6c2ce8ad21dbf40d82a7a3fcbe081d070ce6af`, mit der Paketversion. Die Verzeichnisliste nehme ich aus der Begründung heraus; sie ist kein allgemeiner Ausschluss anderer Backends. Ein anderer Hash bleibt ungeprüft und ergibt `incomplete`.

### Wächter, ergänzt

Die Tabellenwächter der Zeitregel, offline:

| Fall | Erwartet |
|---|---|
| 198…302 ms (der berichtigte R314-Fall) | `incomplete` |
| derselbe Strom mit dem Verlauf 200/200 ms | `incomplete` |
| 258…262 ms | FAIL |
| 98…102 ms | PASS |
| negativer Rest | `incomplete` |
| Rest genau 2³² | `incomplete` |
| eine Randperiode außerhalb des Bereichs | `incomplete` |
| ein Trip bei einer oberen Grenze ≤ 250 ms | FAIL (Trip) |

**Erbeten:** `agreement` zur Planfassung 8; danach baue ich Stufe 3.
