// Abhängigkeitsschlüssel für geladene Serien.
//
// **Das Problem**: TanStack Query gibt jede Renderrunde NEUE Query-Objekte
// zurück. Ein `useMemo` über sie rechnete deshalb bei jedem Render neu, und
// die Panels dieses Projekts keyen stattdessen auf eine billige Kennung.
// Bisher war das „geladen ja/nein je Serie" (`loadedKey`) — und das ist zu
// wenig:
//
//     Wien anklicken  → Serien laden  → Schlüssel "1111…"
//     Sonnblick       → Serien laden  → Schlüssel "1111…"   (unverändert!)
//     Wien            → AUS DEM CACHE → Schlüssel "1111…"   (unverändert!)
//
// Der dritte Klick rechnete den Memo nicht neu, der Plot wurde nicht neu
// gebaut, und auf dem Schirm stand weiter das Profil vom Sonnblick. Live
// nachgestellt (2026-09-30, Klassisches Meteogramm): 12 Plot-Neuaufbauten
// beim ersten Besuch einer Stadt, **null** bei der Rückkehr — und das Bild
// blieb nachweislich das der vorigen Station. Beim schnellen Durchklicken
// besucht man Städte zwangsläufig erneut, und genau dann sah es aus, als
// reagierten die Knöpfe nicht.
//
// **Die Lösung** ist nicht, den Ort in den Schlüssel zu schreiben (das wäre
// das `dataKey`-Muster aus `VerifyPanel`, und es übersähe einen
// Hintergrund-Refetch mit neuen Werten am selben Ort). Geschrieben wird die
// IDENTITÄT der Datenobjekte: TanStack teilt Strukturen, ein unveränderter
// Abruf liefert also dieselbe Referenz, ein geänderter eine neue. Damit
// ändert sich der Schlüssel GENAU DANN, wenn sich die Daten geändert haben —
// nicht öfter und nicht seltener.
//
// Referenzen selbst kann man nicht in einen Schlüssel schreiben, wohl aber
// eine laufende Nummer je Objekt. Die hält eine `WeakMap`, die nichts am
// Leben erhält: fällt eine Serie aus dem Query-Cache, verschwindet auch ihr
// Eintrag hier.

const ids = new WeakMap<object, number>()
let next = 0

/**
 * Stabile Kennung EINES Werts. Gleiche Referenz → gleiche Zahl, für immer;
 * `undefined`/`null` (noch nicht geladen) → `-`.
 */
export function refId(value: unknown): string {
  if (value == null || typeof value !== 'object') return '-'
  let id = ids.get(value as object)
  if (id === undefined) {
    id = ++next
    ids.set(value as object, id)
  }
  return String(id)
}

/**
 * Schlüssel über eine LISTE von Serien — für `useMemo`-Abhängigkeiten.
 *
 * Funktioniert auch bei wechselnder Länge (die Modellauswahl eines Panels
 * ändert sich), anders als ein Abhängigkeits-Array, dessen Länge konstant
 * bleiben muss.
 */
export function seriesKey(values: readonly unknown[]): string {
  return values.map(refId).join(',')
}
