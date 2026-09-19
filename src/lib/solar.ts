// Sonnenstand — gebraucht im Satellitenbereich, um NACHT von „kein Bild" zu
// unterscheiden.
//
// Der hochaufgelöste sichtbare Kanal misst reflektiertes Sonnenlicht und ist
// nachts schwarz. Ohne diese Rechnung sieht das wie ein Fehler aus, und genau
// so wurde es auch gemeldet; mit ihr kann der Bereich sagen, dass da nichts
// ist, WEIL es Nacht ist — und anbieten, zum letzten Tageslicht zu springen.
//
// Näherung nach dem üblichen astronomischen Standardverfahren (mittlere
// Sonnenlänge, Mittelpunktsgleichung, Deklination, Stundenwinkel). Genauigkeit
// rund ein Zehntelgrad; für die Frage „scheint die Sonne auf dieses Gebiet"
// ist das um Größenordnungen mehr als nötig. Gegengerechnet an Sonnenauf- und
// -untergang (siehe solar.test.ts).

const RAD = Math.PI / 180

/**
 * Höhenwinkel der Sonne in Grad über dem Horizont, negativ unter dem Horizont.
 * `ms` ist Epoch-Millisekunden (UTC), wie überall in diesem Projekt.
 */
export function solarElevationDeg(ms: number, lat: number, lon: number): number {
  // Tage seit J2000,0
  const n = ms / 86_400_000 + 2_440_587.5 - 2_451_545.0
  const meanLon = (280.46 + 0.9856474 * n) % 360
  const meanAnom = ((357.528 + 0.9856003 * n) % 360) * RAD
  // Ekliptikale Länge: mittlere Länge plus Mittelpunktsgleichung
  const eclLon =
    (meanLon + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * RAD
  const obliquity = (23.439 - 0.0000004 * n) * RAD
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclLon))
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon))
  // Sternzeit am Ort → Stundenwinkel
  const gmstH = (18.697374558 + 24.06570982441908 * n) % 24
  const localSidereal = (gmstH * 15 + lon) * RAD
  const hourAngle = localSidereal - ra
  const el = Math.asin(
    Math.sin(lat * RAD) * Math.sin(dec) +
      Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hourAngle),
  )
  return el / RAD
}

/**
 * Reicht das Licht für einen sichtbaren Kanal?
 *
 * Die Schwelle ist NICHT der Horizont, sondern **+5°**, und das ist gemessen
 * statt geschätzt: das letzte Bild mit der Sonne knapp über dem Horizont
 * (17:20 UTC, Mitte der Fläche 2°) war praktisch schwarz — als Sprungziel
 * „letztes Tageslicht" also wertlos. Erst ein paar Grad höher trägt ein
 * sichtbares Bild. Die Zahl entscheidet zweierlei: ab wann der Bereich Nacht
 * meldet und wohin er springt.
 */
export const DAYLIGHT_MIN_ELEVATION = 5

export function hasDaylight(ms: number, lat: number, lon: number): boolean {
  return solarElevationDeg(ms, lat, lon) > DAYLIGHT_MIN_ELEVATION
}
