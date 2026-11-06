## Claude · Antwort auf R311 · Anfrage R312 · 6. November 2026

Alle fünf Befunde sind behoben. Dazu kommt ein dritter Teil: der positive native P2-Fall mit seinem Lauf. Die Stände:
- **Teil A** (P2): `fix/toolsetter-sync` **`264c5fa6`** (auf `430832be`).
- **Teil B** (2c-b): `integ/m600-native` **`f4197439`** (auf `672ba228`).
- **Teil C** (der native P2-Fall): `integ/p2-native` **`18f3f155`**, ein neuer Zweig. Er ist `672ba228` mit beiden Zweigen zusammengeführt, plus der Fall und die Inventaraussagen.

Erbeten: `agreement` oder `findings` je Teil.

### Teil A · FI-I38 und FI-I39

**FI-I38 · Der AUTO-Wechsel ist zugelassen** (`9a56c110`). `_rfl_sequence` gibt dasselbe gebundene `admit` jetzt auch an `set_mode(MODE_AUTO, admit=admit)`. Der Aufruf liegt im selben `try` wie der Start, also wechselt eine Ablehnung (`_WriteRefused`) nichts, und die Phase nennt den Grund.

Der Wächter `test_a_section_changed_before_the_auto_switch_switches_nothing` läuft mit dem echten `set_mode` und `_cmd_blocking`, wie deine Probe: Die Sektion ändert sich direkt nach der frühen Prüfung. Dann wird weder `CMD.mode(MODE_AUTO)` noch `auto` geschrieben, der Modus bleibt MDI, und die Phase sagt „changed meanwhile“. Am alten Stand war er rot: `[('mode', (2,), {}), …]`.

**FI-I39 · Eine Rundung auf beiden Seiten** (`9a56c110`). `toolsetter_rules.canonical` rundet den exakten Binärwert jetzt wie `toFixed(6)`: nächste Zahl, ein Gleichstand von null weg (ECMA-262 „pick the larger n“ von |x|), also `Decimal(v).quantize(…, ROUND_HALF_UP)`. Für −179,0078125 ergibt das −179,007813 auf beiden Seiten.

Damit stimmen auf beiden Seiten dieselben sechs Stellen überein:
- MDI-Text (`%.6f` der kanonischen Zahl);
- Buchung;
- Datei;
- Formular.

Ich habe die Python-Seite angepasst, weil sie die einzige Quelle der gesendeten Zahl ist. Die Formularprojektion bleibt bei `toFixed(6)`. Einen großzügigen Vergleich gibt es nicht.

Wächter:
- **Vertragsraster** mit exakten Gleichständen: ±, darunter −0,0078125, und −179,0234375, das nach beiden Regeln aufrundet. Am alten Stand war die TypeScript-Seite rot.
- **`test_an_exact_tie_rounds_as_the_form_rounds`:** die kanonische Zahl und ihr MDI-Text. Mit `%.6f` waren 2 Tests rot.
- **`toolsetterState.test.ts`:** Eine Buchung mit genau den Zahlen des Gateways für den Gleichstandsfall ist `confirmed`, für `applied` und `read`. Damit bleibt auch der Komfort-Push aus. Am alten Stand rot.

`docs/decisions.md` nennt beides (`264c5fa6`).

**Prüfungen A:** Rundengate Lauf 4 **PASS** auf `264c5fa6` (Basis `838c3381`, nichts uncommitted): Backend 1795 (+3536 Subtests), Vitest 2627, Browser voll 870/870, Lint, Build, Auswahlwächter. Vom Selektor als Live-Prüfungen vor main benannt: `toolsetter-readback`, `perf-matrix`, `twp-buttons`. `firefox-core` steht aus, weil das Ziel noch nicht gebaut ist.

### Teil B · FI-I40 bis FI-I42

Alle drei liegen in `f4197439`.

**FI-I40 · Der Schritt aus der Routine zählt.** Der Abfall wird ab dem **letzten bekannten Z der Routine** gemessen, nicht ab der ersten Einfahrtsabtastung. Das gilt auch für kleine Schritte über die Grenze, die sich summieren. Ist das Z dort ungelesen, ist der Übergang nicht bewiesen; der Fall ist dann `incomplete`, aber nie über einem FAIL. Ein XY-Auslauf bei konstantem Z bleibt PASS.

**FI-I41 · Ohne Routine keine Grenze.** Ohne Routinenabtastung vor L ist die Grenze nicht bewiesen. Die Regeln, die keine Grenze brauchen, können weiter FAIL ergeben: eine bewegte frühere Programmzeile, der Start von L, die eigenen Achsen von L. Sonst ist der Fall `incomplete`. Abfall und Anker werden nicht bewertet. Ein Index −1 als Ersatzgrenze kommt nicht mehr vor.

**FI-I42 · Nur die geprüften Texte.** `ROUTINE_TEXTS` ist jetzt Pfad → SHA-256:
- die Routine `4990c7b3…`, gleich `MARKED_POS_ROUTINES`;
- der Wrapper `acbaeb68…`.

`servo_cases.routine_sources` liest nur diese Texte. Bei einem geänderten, fehlenden oder unlesbaren Text gibt es keine Zuordnung: `incomplete`, keine Aussage in irgendeine Richtung. Die Zeile nennt die Quellen und den Programmhash.

**Wächter, rot an `672ba228`:**
- der Abstieg direkt nach der Routine;
- kleine Schritte über die Grenze (je 0,0006, zusammen 0,0012, Rückweg ab dem tiefsten Punkt);
- das letzte Routinen-Z ungelesen;
- keine Routinenabtastung;
- deine Probe (modales `X25` nach Zeile 601), ein geänderter Wrapper, ein fehlender Wrapper;
- die Pins sind die ausgelieferten Texte und der Pin der Vorschau (aus dem Quelltext gelesen, ohne Gateway-Import).

**Erhalten:** XY-Auslauf, sowie die frühe Zeile 6 und Zeile 7 mit Z-Bewegung ohne Routine bleiben FAIL. Insgesamt 315 native Tests.

**Lauf 10, neu bewertet:** Der gespeicherte Strom (`20261105T232301`), mit dem korrigierten Auswerter bewertet, ist **PASS**: Anker n=345381, Start (100, 100, 0), Quellen gebunden. Die Gegenprobe X+1 wird abgelehnt. Der Beleg ist in `function-inventory.r312.evidence.json`.

**Prüfungen B:** Rundengate Lauf 3 **PASS** auf `f4197439` (Basis `3e4f7c80`): Backend 1775 (+3536 Subtests), native Stufe 315, Vitest 2614, Lint, Build. Kein Browser-Spec ist ausgewählt.

### Teil C · Der positive native P2-Fall (deine R309-Vorgaben)

**Zweig `integ/p2-native`, wie er entstand:**
- `672ba228`;
- die Zusammenführung von `430832be` (`b434f84e`);
- der Fall (`85286edb`);
- die Inventaraussagen (`194c556a`);
- die Zusammenführungen der R311-Korrekturen: `f978e7eb` mit B und `18f3f155` mit A.

In `f978e7eb` steckt eine Anpassung der Tests: Der FI-I42-Testbaum erhält auch `toolsetter_rules.py`, denn der RFL-Schritt beurteilt seine Sektion mit der Regel des Laufbaums.

**Der Schritt `ts-sync`** (`ts_sync_cases`) läuft nach `m6-hold` und vor `rfl`:
1. Die Interpreterwerte der Kopie mit `#3005 = 20` werden per MDI geschrieben (gebucht als `applied`) und als Sektion gespeichert.
2. Maschine **aus**, Sektion mit `#3102` um 1 mm höher speichern. Das ist der Rot-Fall aus R309; das Formular sendet dann nichts.
3. Maschine an; homen, falls nötig; `#3102` im Interpreter lesen (Vorbedingung: alt).
4. Das Programm `T1 M600` per Cycle Start.

**Bewertung `eval_ts_sync`:**
- **Erwartung:** Tabellenlänge vor dem Versuch + |neu| − |alt| (wie im `#3102`-Gegenfall), ± `M600_TOL` bei 20 mm/min. **Nur die neue Basis** besteht; eine Länge bei L0 ist FAIL mit der Nennung „the old #3102“.
- **Antwort des Starts:** Sie muss `toolsetter.synced: true` sagen, denn die Buchung hielt den alten Wert.
- **Weiter:** G43 = Länge; der Interpreter hält danach den neuen `#3102`. Ein NML-Fehler ist FAIL.
- **Vorbedingung:** Hielt der Interpreter den neuen Wert schon vorher, ist der Fall `incomplete`.
- **Gegenprobe:** dieselbe Messung gegen die alte Basis (`ts-sync-program-m600.counter-old-basis`).

**`eval_ts_booking`:** die Buchung, wie **diese Verbindung** sie empfing (`live_session` hält jetzt `toolsetter_booking` mit Verlauf).
- Vor dem Start steht `#3102` auf dem alten Wert. Danach steht jeder der 23 Schlüssel auf der Zahl der Sektion als `applied` oder `read`, bei höherer Version. Das ist die Grundlage, aus der das Formular „confirmed“ projiziert.
- Eine abweichende Zahl danach ist FAIL; `assumed` oder `unknown` ergibt `incomplete`.

**`eval_ts_stable`:** Ein zweiter Start mit derselben Sektion (ein Programm ohne Bewegung) muss `synced: false` sagen, und die Version bleibt gleich. Das ist die benannte Entscheidung.

**Zurückgesetzt und zurückgelesen:** T1-Länge (die physische der Sim), Sektion, `#3102`, angewandter Offset.

**Der RFL-Schritt** speichert seine Sektion jetzt vor dem `auto_run`, weil P2 verlangt, dass die Dialogwerte die Serversektion sind. Eine Kopie, deren Werte die Regel des Laufbaums ungültig nennt, beendet den Schritt, bevor etwas startet (Test).

**Wächter:**
- die Tabellen der drei Auswerter;
- die Gegenprobe;
- der ganze Schritt gegen ein gescriptetes Gateway mit der Physik der Sim. Physische Länge = Tabellenlänge; M600 misst sie + |#3102| − |Platte|. Vier Varianten:

| Gateway-Variante | Ergebnis |
|---|---|
| P2 | vier PASS |
| altes Gateway (keine Notiz, nichts geschrieben; der R309-Rot-Fall) | FAIL |
| behauptet einen Abgleich, schreibt aber nicht | FAIL, „old #3102“ genannt |
| schreibt beim zweiten Start wieder | `ts-sync-stable` FAIL |

Außerdem: die Speicherreihenfolge im RFL-Schritt und die ungültige Kopie.

**Mutationen, je rot:**
- Erwartung aus der alten Basis: 10 Tests;
- ohne Prüfung von `synced`: 1 Test;
- ohne Ausschalten der Maschine: 4 Tests.

Insgesamt 345 native Tests.

**Inventar:**
- `F-TOOLSETTER.S2`: der Abgleich an jedem Programmstart aus Idle; Gateway-Tests.
- `F-TOOLSETTER.S2b`: die RFL-Ablehnung vor jeder Wirkung.
- `F-TOOLSETTER.S2c`: der native Fall, noch mit der Lücke „der native Lauf steht aus (gebaut)“.
- `F-TOOLSETTER.S3`: die Maschinenzeile des Formulars; Browser- und Unit-Tests.
- Die Lücke von `F-TOOLMEASURE.S7` ist entfernt, weil R308 den nativen Fall abgenommen hat.

Die Lücken von `F-TOOLSETTER.S2c` und `F-RFL.S3` („2c-b“) nehme ich erst nach deiner Zustimmung heraus.

**Nativer Lauf 11** (`20261106T003055`, `18f3f155`, 3-Achs-Kopie). **Urteil PASS: 36 PASS**; die 6 Jog-Zeilen aus Statusframes sind informativ wie zuvor. Wiederherstellung `complete`, Isolation leer.
- **`ts-sync-program-m600` PASS:**
  - L0 50, `#3102` −180 → −179, Erwartung 49.
  - Länge **48,99955** (−0,00045), G43 gleich.
  - Antwort `{synced: true, persisted: true, file_error: null}`.
  - Interpreter vorher −180, nachher −179; keine Fehler.
- **Gegenprobe alte Basis:** abgelehnt („expected 50“).
- **`ts-sync-booking` PASS:** `#3102` vorher −180; danach jeder Schlüssel bestätigt; Version 25 → 30, mehrere Buchungsschritte der Blöcke.
- **`ts-sync-stable` PASS:** `synced: false`, Version 30 → 30.
- **`rfl-start-point` PASS** mit gebundenen Quellen (beide Hashes und der Programmhash), Anker n=400214, Start (100, 100, 0). Die Gegenprobe wird abgelehnt.

Beleg: [`function-inventory.r312.evidence.json`](function-inventory.r312.evidence.json) mit Lauf 11 (Zeilen, Wiederherstellung) und der Neubewertung von Lauf 10; ohne Token geprüft. Die Servo-Aufzeichnung von Lauf 11 liegt unter `~/claude-work/live-tier/20261106T003055/servo-rfl.jsonl`.

**Prüfungen C:** Rundengate **PASS** auf `18f3f155` (Basis `264c5fa6`, also Teil A; der Unterschied ist die native Stufe, das Inventar und der Hilfetext der M600-Rückfahrt aus `fix/m600-return-top`): Backend 1800 (+3536 Subtests), native Stufe 345, Vitest 2627, 10 ausgewählte Browser-Specs mit 273/273, Lint, Build. Vom Selektor benannte Live-Prüfungen: `live-twp`, `probe-live`, `toolsetter-readback`.

**Erbeten:**
- `agreement` zu A, B und C;
- damit die Bestätigung, dass die Lücken `F-TOOLSETTER.S2c` (P2 nativ) und `F-RFL.S3` (2c-b) geschlossen werden dürfen.

Danach folgt Stufe 3 der nativen Stufe. Die Merges nach `development` warten auf den Blick des Operators.
