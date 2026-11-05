## Claude · Bau P2 und 2c-b · Anfrage R311 · 6. November 2026

Zwei Teile, beide gebaut. **Teil A:** P2 nach R308/R309, Zweig `fix/toolsetter-sync` (von `838c3381`), Stand **`430832be`**. **Teil B:** 2c-b nach R309/R310, Zweig `integ/m600-native`, Stand **`672ba228`** (auf `3e4f7c80`), mit neuem nativem Lauf. Erbeten: `agreement` oder `findings` je Teil.

### Teil A · P2: Die Tasterwerte erreichen den Interpreter bei jedem Programmstart

**Die eine Quelle (FI308-02).** `lcnc-gateway/toolsetter_rules.py` ist die Python-Fassung von `toolsetterSetup.ts`: Parameterkarte, Vorgaben, Pflichtfelder, Auswahlwerte, Grenzen und `canonical()` (die `%.6f`-Zahl, die das MDI sendet). Ein Vertrag: `toolsetterRules.contract.json` (aus `contract()` geschrieben). `test_toolsetter_rules.py` hält das Modul an die Datei, `toolsetterRules.contract.test.ts` die TypeScript-Seite (Tabellen und die Urteile eines Fallrasters: fehlendes Pflichtfeld je Schlüssel, Ganzzahl, Grenzen, Auswahl außerhalb, `true`/`null`/Text, mehr als sechs Nachkommastellen).

**Die Basis je Start (FI308-02).** `_toolsetter_basis()` liest die vom Server gehaltene Sektion `toolsetter` (`SettingsStore.load_section`) **einmal** und bindet sie mit einem Digest über Sektion **und** INI-Pfad, nicht über den globalen Settings-Zähler (Hinweis R309: eine Kamera- oder Anzeigeänderung ist keine neue Tasterbasis). `_basis_refusal(basis)` liest neu und vergleicht den Digest: „Toolsetter settings changed meanwhile — start again“. Das prüft `admit` beim Moduswechsel und vor jedem Block.

**Welche Starts abgleichen (FI308-01).** Cycle Start, der erste Schritt aus Idle (`auto_step`), `auto_run` direkt und Start ab Zeile. Der Abgleich ist eine eigene Bedingung, unabhängig vom Skip-Flag. Ein pausierter Schritt, Resume, MDI und ein Werkzeugwechsel gleichen nie ab; dafür gibt es je einen Test. Ein Makro (`run_macro`) gleicht ebenfalls nicht ab. Einen eigenen Test hat es nicht, aber `_toolsetter_sync` wird nur aus `cycle_start`, `auto_step` und `auto_run` aufgerufen.

**`_toolsetter_sync(armed, basis)`:**
- **Nicht eingerichtet:** kein Abgleich; die Antwort sagt `set_up: false`; der Start läuft.
- **Jeder Schlüssel als `applied` oder `read` gebucht, mit der Zahl der Basis:** nichts geschrieben (keine Buchungsänderung, kein Re-Parse). Das ist die benannte Entscheidung. Ein anderer Schreiber des Interpreters ist nicht sichtbar; diese Grenze ist benannt.
- **Sonst:** geschrieben, zugelassen auf der gewählten Basis und einem bekannt ruhenden Interpreter. Wird ein Block nicht übernommen, wird der Start abgelehnt („Toolsetter values not taken — nothing started“), und es gibt kein AUTO. Die Blöcke sind gebucht, wie sie endeten.

Jede Antwort trägt `toolsetter: {digest, set_up, synced, persisted?, file_error?}`.

**Start ab Zeile (Hinweise R309).** Der Handler vergleicht die `probe_vars` des Dialogs mit der Basis **vor** `_start_guard`, also vor dem Löschen des Skip-Flags. Weichen sie ab: „Toolsetter values changed — confirm Run from line again“, nichts geschrieben (der Test prüft, dass gar kein Befehl hinausging). Die Vormessung schreibt die Basis mit `admit`. `_rfl_sequence(..., basis=)` bindet sie vor seinem eigenen AUTO-Schreiben erneut.

**MDI zuerst, dann die Datei (FI308-03).** `_apply_probe_vars_detail` ergibt `{mdi_set, applied_keys, persisted, file_error}`:
- Die MDI-Blöcke gehen zuerst und werden einzeln gebucht (RCS_DONE `applied`; Fehler, Zeitablauf oder Schnitt `unknown`; ein nie gesendeter Block behält seine Buchung).
- Danach schreibt die Parameterdatei **nur** die übernommenen Schlüssel mit ihren gesendeten Zahlen.
- Nichts übernommen: kein Dateischreiben.
- Ein Dateifehler nach der Übernahme lässt die Übernahme stehen.
- `persisted` bedeutet ausdrücklich: die Datei hält **genau `applied_keys`**. Es ist keine Aussage über den ganzen Wunsch. `mdi_set: false` mit `persisted: true` ist also möglich und heißt: die übernommenen Blöcke sind gespeichert.
- Ein Abbruch läuft als CancelledError durch; keine Antwort behauptet dann eine Persistenz.

Der Lebendfall aus Lauf 5 (die Synchronisation des Moduswechsels speicherte den alten Interpreterwert über die vorher geschriebene Datei) ist der Grund für die Reihenfolge.

**Die Buchung auf der Leitung, je Verbindung.** `ClientState.ts_booking_sent` (`ws_fanout.py`), `_ts_booking_for(client)`: das erste Frame einer Verbindung trägt `status_msg.toolsetter_booking`, danach nur eine Änderung (Version oder Inhalt). `statusStore.ts` hält sie und setzt sie in `resetOnClose` zurück. Eine neue Verbindung zeigt deshalb nichts, bis ihre eigene Buchung kommt; alte Verbindungsdaten bestätigen keine neue Instanz (Test „belongs to its connection“).

**Die Projektion im Formular (FI308-04, deine Tabelle).** `toolsetterState.ts`, `toolsetterMachineState(setup, booking)` über **genau die 23** synchronisierten Schlüssel (`#3014` der Vorschau-Buchung zählt nicht):

| Befund | Zustand | Zeile |
|---|---|---|
| alle gleich, jeder `applied` oder `read` (auch gemischt) | `confirmed` | „In the machine — confirmed“ (ok) |
| alle bestätigt, mindestens einer abweichend | `pending` | „Saved — not yet in the machine“ |
| einer fehlt, `unknown` oder nur `assumed` | `unconfirmed` | „Machine values not confirmed (n of 23)“ |
| keine Buchung auf dieser Verbindung | `unknown` | „Machine values not known yet“ |
| Sektion nicht eingerichtet | `not_set_up` | keine Maschinenzeile; die Einrichtungsnotiz sagt „nothing is synced with the machine“, nicht „nothing is applied“ |

Der Komfort-Push nach einem bestätigten Speichern bleibt. Er geht nur, wenn eingerichtet, `ready` und nicht `confirmed`. Er ist eine Bequemlichkeit, denn der nächste Start gleicht ohnehin ab.

**Wächter zu deiner Liste:**
- vollständig `read` und gleich, gemischt `read`/`applied`, vollständig `assumed` und gleich, ein `unknown` neben übernommenen (`toolsetterState.test.ts`);
- Sektion entfernt bei vorhandener Buchung: `not_set_up`, unabhängig von der Buchung (Unit und e2e);
- neue Verbindung vor ihrer Buchung (`statusStore.test.ts`);
- **neu in dieser Runde, beide rot an einer Mutation:**
  - Gateway: eine bestätigte Rücklesung (`read`) mit den Zahlen der Sektion schreibt beim Start nichts. Rot, wenn die Bedingung nur `applied` gelten lässt.
  - Formular: ein Speichern, das die Rücklesung schon bestätigt, sendet keinen Push; das folgende Speichern, das sie nicht bestätigt, sendet ihn. Am Ende steht genau ein Push (−298). Rot, wenn das Formular ohne die Bedingung `confirmed` pusht (ein Push zu viel, der für −299).

**Protokolländerung.** `get_probe_vars` ist entfernt: Handler, `READ_ONLY_COMMANDS`, `lcnc.ts`, die Vertragstests, README und Inventar. Ein alter Aufruf bekommt die einfache Ablehnung und keine Werte. Der Test nutzt eine echte INI und Parameterdatei; am alten Stand antwortete er `{3102: -180}`.

**Benannte Folge.** Ändert ein Start die Buchung, steigt die Taster-Version. Ein Programm, das die Routine aufruft, startet dann einmal mit offener Tasterbasis: Die Vorschau sagte das M600 mit den alten Werten voraus, und die Laufprüfung benennt das. Eine stabile Maschine schreibt nichts und bleibt geprüft.

**Folgearbeit, nicht gebaut:** Die M600-Vorhersage der Vorschau nutzt weiter die Buchung, nicht die gespeicherte Sektion.

**Doku.** `docs/decisions.md` (Vertrag, Protokolländerung, Folge), CLAUDE.md (Kurzregel), `docs/architecture/ui-patterns.md` (voller Eintrag), README.

**Prüfungen:** Rundengate Lauf 3 **PASS** auf `430832be` (Basis `838c3381`, nichts uncommitted): Backend 1793 (+3536 Subtests), Vitest 2626 in 164 Dateien, Browser voll 870/870, Lint, Build, Auswahlwächter. Lauf 1 und 2 waren FAIL und sind aufbewahrt: Lauf 1 an fehlenden Auswahlregeln für die neuen Dateien. Lauf 2, weil die strikten Locators der G30-Notiz in `g30.spec` die neue Maschinenzeile mitfanden; sie ist ebenfalls eine `.statusNote` mit der Klasse `.tsMachine`. Diese Locators und der ok-Locator in `toolsetter.viewer.spec` schließen sie jetzt aus. Vom Selektor als Live-Prüfungen vor main benannt: `toolsetter-readback`, `perf-matrix`, `twp-buttons`.

**Noch offen in Teil A:** der feste positive native Fall nach deinen R309-Vorgaben. Er braucht `fix/toolsetter-sync` in `integ/m600-native`; ich baue ihn nach dieser Runde:
- `#3005 = 20` (die begründete `M600_TOL`);
- Erwartung = Tabellenlänge vor dem Versuch − 1 mm aus dem bewussten `#3102`-Delta;
- NML-Fehler gehen ins Urteil;
- nur die **neue** Basis gilt als PASS.

Bis dahin bleibt die Aussage über den Lebendfall auf den Rot-Beleg aus R309 und die Unit-/e2e-Wächter begrenzt.

### Teil B · 2c-b: Der Startpunkt bei Start ab Zeile aus dem Servo-Strom

**Gebaut nach Planfassung 2 mit den R310-Korrekturen** (`672ba228`).

`servo_cases.eval_rfl_start_servo(case, sec, line, entry_xy, safe_z, routine_lines, program_lines)` ordnet jede Abtastung über `motion.program-line` den **Zeilenmengen der Texte** zu. Empfangszeiten werden dafür nicht benutzt.
- `servo_cases.motion_lines(text)` liest die Fahrsatzzeilen aus dem Text: die gebündelte Routine des Laufbaums ergibt 28 Zeilen, 211…601, der Wrapper keine.
- Das Programm hat die Zeilen 1…N.
- Beide Mengen werden auf Disjunktheit geprüft; treffen sie sich, ist das Ergebnis `incomplete` ohne Zuordnung.

**FAIL bei bekanntem Widerspruch:**
1. Eine Programmzeile 1…L−1 bewegt sich **irgendwo im Versuch**. Eine spätere Routinenzeile schneidet das nicht ab (R310, Punkt 1).
2. Ein Abstieg in der Einfahrt, gemessen am **höchsten** vorher bekannten Z. Viele kleine Schritte summieren sich (R310, Präzisierung).
3. L beginnt neben der Einfahrt in X/Y oder unter der sicheren Höhe.
4. Eine Bewegung nach dem **ersten** bestätigten Ruheblock an der Einfahrt (der Anker: 10 Abtastungen, vollständig vor der ersten Abtastung von L).
5. L bewegt Y oder Z.

**`incomplete`, nie über einem FAIL:**
- die Zeilenmengen treffen sich;
- keine Abtastung von L, oder ihr Start ist ungelesen;
- kein Anker;
- eine Bewegung auf einer Zeile, die kein Text nennt;
- **eine Routinenzeile, nachdem das Programm begonnen hat** (die Phasenreihenfolge, R310, Punkt 2);
- ein Mangel im Abschnitt;
- die Selbstprüfung (L+1 bewegt nur Y, L+2 nur Z) schlägt fehl.

Der Nullbereich zwischen der letzten Routinenabtastung und L wird **nicht** als exaktes Ende der Routine beschrieben. Er schließt deren Auslauf ein (R310, Präzisierung 1).

**Testprogramm.** Zeile 7 ist `G61.1 G1 X200 F3000`. Die Zeilennummern bleiben gleich, der Programmhash ist neu, und der Wächter der Programmkonstanten ist angepasst.

**Lauf.** Der RFL-Schritt bewertet den Servo-Abschnitt des Versuchs und eine Gegenprobe mit einer Einfahrt, die 1 mm in X versetzt ist (`rfl-start-point.counter-entry-x+1`). F-RFL.S3 bindet beide Zeilen; sein Text sagt die Reichweite (beobachtete Bewegungsabtastungen; übersprungene Sätze ohne Bewegung sieht dieser Kanal nicht). `docs/decisions.md` hat einen Eintrag.

**Wächter, rot an der fehlenden Schnittstelle auf `3e4f7c80`:**
- die saubere Einfahrt;
- die Gegenmodelle aus R309 und R310:
  - Zeile 6 zuerst;
  - eine sinkende Einfahrt;
  - kleine Schritte, die sich summieren;
  - ein Start neben der Einfahrt;
  - ein Ausflug nach dem Anker;
  - Zeile 7 bewegt Z;
  - Zeile 6 vor einer späteren Routinenzeile;
  - Zeile 6 vor der ersten Routinenzeile;
- die `incomplete`-Fälle;
- eine fehlgeschlagene Selbstprüfung stuft einen FAIL nie herab;
- verschobene Empfangszeiten ergeben dasselbe Urteil;
- ein Abschnittsmangel;
- eine untergeschobene Einfahrt;
- `motion_lines` an einem Text;
- der ganze Schritt (PASS mit Gegenprobe, FAIL).

Der gespeicherte G64-Strom aus Lauf 9 ergibt: Start korrekt, Selbstprüfung `incomplete` am Überschleifen von Zeile 8. Das hatte R309 vorhergesagt. Insgesamt laufen 304 native und 36 Inventartests.

**Nativer Lauf 10** (`20261105T232301`, `672ba228`, 3-Achs-Kopie). **Urteil PASS: 32 PASS.** Die 6 Jog-Zeilen aus Statusframes sind `incomplete` und nach R302 informativ; ihre Servo-Zeilen sind PASS. Die Wiederherstellung ist `complete`, Isolation leer. Es ist der erste vollständige PASS der nativen Stufe; die Läufe 8 und 9 waren allein an `rfl-start-point` unvollständig.
- `rfl-start-point` **PASS**: 50 170 Abtastungen, Einfahrt (100, 100), sichere Höhe 0, Start von L bei (100, 100, 0), Anker bei n=345381. Die Gegenprobe X+1 wird abgelehnt („line 7 started at X 100.0 Y 100.0, not the entry X 101 Y 100“).
- **Phasenfolge im Strom (Ende):** Routine (16 967 Abtastungen), Nullbereich (6 012), Zeile 7 (2 067), Zeile 8 (2 067), Zeile 9 (576), 0 (51). Nach Programmbeginn kommt keine Routinenzeile.
- **Nullbereich:**
  - Die erste Nullabtastung n=339561 trägt noch X/Y −0,017555 mm/s, denselben Auslauf wie in R310.
  - Danach folgt die X/Y-Positionierung auf 100/100 bis n=345380.
  - Z bleibt im ganzen Nullbereich bei 0.
  - Ab n=345381 steht der Anker; L beginnt bei n=345573.
- **Achsentrennung unter G61.1:**
  - Zeile 7: Y und Z bewegen sich 0.
  - Zeile 8: X weicht höchstens **0,000286 mm** ab (|v| ≤ 0,084 mm/s, am Anfang der Zeile); Z 0.
  - Zeile 9: Y analog 0,000286 mm; X 0.
  - Der genaue Halt lässt also beim Zeilenwechsel noch einen Rest unter 0,3 µm laufen. Er liegt unter `STILL_POS` (0,001), und die Selbstprüfung besteht. Die Zahlen nenne ich, weil „die Achsen einer Zeile sind ihre eigenen“ unter G61.1 bis auf diesen Rest gilt, nicht exakt.

Beleg: [`function-inventory.r311.live-runs.json`](function-inventory.r311.live-runs.json) (Zeilen, Wiederherstellung, Phasenfolge, Achsentrennung; ohne Token geprüft). Die Servo-Aufzeichnung selbst liegt unter `~/claude-work/live-tier/20261105T232301/servo-rfl.jsonl` (50 170 Abtastungen; je Zeile Empfangszeit, Abtastnummer und `pos-fb` der Gelenke 0–2, `vel-cmd` der Gelenke 0–2, `motion.program-line`, `in-position`, die Marke `natv-mark`).

**Prüfungen Teil B:** Rundengate Lauf 2 **PASS** auf `672ba228` (Basis `3e4f7c80`): Backend 1775 (+3536 Subtests), native Stufe 304, Vitest 2614, Lint, Build. Kein Browser-Spec ist ausgewählt, weil keine Frontend-Datei geändert ist.

**Damit erbeten:** die Lücke „2c-b“ in F-RFL.S3 als geschlossen zu bestätigen: positiver nativer Beleg **und** negative Wächter, mit der benannten Reichweite.

### Danach

- Den positiven nativen P2-Fall baue ich auf `integ/m600-native` nach dem Merge von `fix/toolsetter-sync`.
- Dann folgt Stufe 3 der nativen Stufe: Latch-Varianten, Trip, Trennung, mehrere Clients.
- `fix/m600-return-top` (R307 abgenommen) wartet auf den Blick des Operators vor dem Merge nach `development`.
