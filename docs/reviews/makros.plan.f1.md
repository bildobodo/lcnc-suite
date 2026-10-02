# Makros: Beispiele, Ausbau, eigener Tab

**Entwurf · 1. Oktober 2026 · Paket 5 der Operator-Liste.** Noch nichts gebaut. Zwei Entscheidungen
liegen beim Operator (unten). Bis dahin entstehen nur Renderings mit Beispielmakros im Mock; die
gespeicherten Makros des Operators bleiben unberührt.

## Anlass

Der Operator, 1. Oktober:

> Kannst du einige Beispielmakros erstellen, damit wir sehen, wie die Makrobar aussieht? Müssten wir
> die Makrofähigkeiten ausbauen? Inklusive Editor, Import, Export, File Browser usw.? Ähnlich wie
> wir das bereits beim Programm laden haben? Vielleicht müsste dann die ausgebaute Makrofunktion
> einen Tab im Sidepanel erhalten anstelle bei den Settings.

## Heute

- **Speicher:** ein Makro ist ein Eintrag in der Settings-Sektion `macros` (Server, JSON): Name,
  eine MDI-Zeile mit Platzhaltern `{name}`, Parameter mit Label und Vorgabe.
- **Bearbeiten:** Settings › Macros, eigener Editor mit Speichern/Abbrechen und Entwurfswache.
- **Ausführen:**
  - Die Makroleiste unter dem Viewer, ein Button je Makro.
  - Ohne Parameter wird gehalten (Hold); mit Parametern öffnet ein Dialog, dessen Execute gehalten
    wird.
  - Gate `probe`, eine MDI-Zeile.
- **Grenze:** Ein Makro ist genau eine MDI-Zeile. Logik (Schleifen, Bedingungen, mehrere Schritte)
  geht nur über ein `o<…> call` auf eine Datei, die der Operator von Hand ins
  Unterprogrammverzeichnis legt.

## Entscheidung 1 — Wo liegt ein Makro?

**A · weiter in den Settings (JSON).** Klein: Beispiele, Import/Export als JSON-Datei,
mehrzeilige Befehle. Kein Dateibrowser, kein G-Code-Editor.

**B · als `.ngc`-Datei** (Empfehlung):
- Ablage in einem Makroordner im `SUBROUTINE_PATH`.
- Ein Makro ist ein LinuxCNC-Unterprogramm `o<name> sub … endsub`.
- Ausgeführt wird es per MDI `o<name> call [p1] [p2] …`, so wie heute schon die Probing-Routinen.
- Die Parameter stehen als Kommentarkopf in der Datei, z. B.
  `(PARAM 1 depth "Depth" mm 5)`; der Dialog liest sie daraus.

Vorteile von B:
- echte Logik (Schleifen, Bedingungen, `#<_…>`-Variablen);
- Bearbeiten im vorhandenen G-Code-Editor mit Hervorhebung;
- Dateibrowser, Upload (= Import) und Download (= Export) wie bei Programmen;
- Dateien lassen sich mit jedem Editor und in Git pflegen;
- die Beispiele liegen als Dateien bei.

Kosten von B:
- ein Makroordner, den das Gateway wie den Programmordner bewacht (nur Dateien darin);
- der Kommentarkopf als kleine, getestete Grammatik;
- die vorhandenen Settings-Makros: Sie bleiben, wie sie sind, und laufen weiter. Die Übernahme in
  Dateien schlägt die UI höchstens vor; sie geschieht nur auf Wunsch.

## Entscheidung 2 — Ein 6. Tab?

**Ja** (Empfehlung bei B): `Program | MDI | Probing | Offsets | Tools | Macros`.
- Kopf nach dem Tab-Muster: Objektzeile, Ausführen, Verwaltung (Neu, Files, Import/Export).
- Darunter die Liste, ein gewähltes Makro im Editor.
- Was auf die Makroleiste kommt, wählt ein Schalter je Makro.
- Platz: Fünf Spalten passen ab 400 px Seitenpanel; sechs brauchen etwa 87 px je Reiter bei
  522 px. Das wird vorher gemessen, wie in WP-DR. Schmal bleibt es die Auswahlliste.
- Settings › Macros entfällt dann oder verweist auf den Tab.

**Nein** (bei A): Die Makros bleiben in Settings, ergänzt um Import/Export.

## Beispielmakros

Sie dienen nur dem Ansehen der Makroleiste. Sie werden **nicht** in die gespeicherten Makros
geschrieben, sondern stehen im Mock und als Dateien im Beispielordner.

| Name | Was | Parameter |
|---|---|---|
| Spindle warm-up | M3 in Stufen, je eine Pause | Drehzahl max, Dauer |
| Park | `G53 G0 Z0`, dann X/Y zur Parkposition | – |
| Face top | eine Planfräsbahn über die Rohteilfläche | Breite, Länge, Tiefe, Vorschub |
| Coolant flush | M8 für n Sekunden | Dauer |
| Probe Z | Z-Antasten ab hier (vorhandene Routine) | – |
| Go to G30 | `G30` mit Z zuerst (die Leisten-Aktion als Makro) | – |

Die Bewegungsmakros halten die Regeln der Suite ein:
- Rückzug nie nach unten (`#<_abs_z>`-Schutz wie in `go_to_zero.ngc`);
- `G53` nur bei Identitätskinematik.

## Ablauf

1. Operator: Entscheidung 1 und 2, anhand der Renderings der Makroleiste mit den Beispielen.
2. Plan ausarbeiten, mit einer Codex-Planrunde: Gateway-Regeln für den Makroordner, die
   Grammatik des Kommentarkopfs, Gate und Hold unverändert.
3. Bauen auf einem eigenen Branch, Wächter jeweils zuerst rot.
4. Live-Abnahme, dann Merge nach `development`.
