// Kuratierte Städte für die Kartenpanels — bewusst handgepflegt, nicht aus
// einem Datensatz gefiltert. `domains` steuert die Sichtbarkeit pro Domain,
// `priority` die Ausdünnung bei kleinen Panels (1 = bleibt am längsten;
// Punkte bleiben, Labels fallen zuerst weg).
//
// `domains` trägt die DomainPreset-IDs UND die Pseudo-Domain `'radar'` für die
// Radarkarte (`components/RadarPanel.tsx`). Die hat keine DomainPreset — ihre
// Fläche gibt der DWD-Dienst vor —, braucht aber genau diese Orientierung:
// ohne deutsche Städte ist ein Echo über Nordrhein-Westfalen ein Fleck ohne
// Ort. Ein zweites Städteverzeichnis daneben wäre schlechter als eine
// Pseudo-Domain in diesem.

export interface City {
  name: string
  lat: number
  lon: number
  domains: string[] // DomainPreset-IDs
  priority: 1 | 2 | 3
}

export const CITIES: City[] = [
  // --- Österreich-Domain: Landeshauptstädte …
  { name: 'Wien', lat: 48.21, lon: 16.37, domains: ['austria', 'europe', 'radar'], priority: 1 },
  { name: 'Graz', lat: 47.07, lon: 15.44, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Linz', lat: 48.31, lon: 14.29, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Salzburg', lat: 47.8, lon: 13.04, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Innsbruck', lat: 47.27, lon: 11.39, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Klagenfurt', lat: 46.62, lon: 14.31, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Bregenz', lat: 47.5, lon: 9.75, domains: ['austria', 'radar'], priority: 3 },
  { name: 'St. Pölten', lat: 48.2, lon: 15.62, domains: ['austria', 'radar'], priority: 3 },
  { name: 'Eisenstadt', lat: 47.85, lon: 16.52, domains: ['austria', 'radar'], priority: 3 },
  { name: 'Villach', lat: 46.61, lon: 13.85, domains: ['austria', 'radar'], priority: 3 },
  // … und Orientierung über die Grenze
  { name: 'München', lat: 48.14, lon: 11.58, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Zürich', lat: 47.37, lon: 8.54, domains: ['austria', 'radar'], priority: 2 },
  { name: 'Ljubljana', lat: 46.06, lon: 14.51, domains: ['austria', 'radar'], priority: 3 },
  { name: 'Bratislava', lat: 48.15, lon: 17.11, domains: ['austria', 'radar'], priority: 3 },
  { name: 'Bozen', lat: 46.5, lon: 11.35, domains: ['austria', 'radar'], priority: 3 },

  // --- Radarkarte: deutsche Städte als Orientierung. Berlin/München/Zürich
  // stehen schon oben, hier kommt der Rest des Abdeckungsgebiets dazu.
  { name: 'Hamburg', lat: 53.55, lon: 9.99, domains: ['radar'], priority: 1 },
  { name: 'Köln', lat: 50.94, lon: 6.96, domains: ['radar'], priority: 1 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68, domains: ['radar'], priority: 2 },
  { name: 'Stuttgart', lat: 48.78, lon: 9.18, domains: ['radar'], priority: 2 },
  { name: 'Leipzig', lat: 51.34, lon: 12.37, domains: ['radar'], priority: 2 },
  { name: 'Hannover', lat: 52.37, lon: 9.73, domains: ['radar'], priority: 2 },
  { name: 'Nürnberg', lat: 49.45, lon: 11.08, domains: ['radar'], priority: 2 },
  { name: 'Dresden', lat: 51.05, lon: 13.74, domains: ['radar'], priority: 3 },
  { name: 'Bremen', lat: 53.08, lon: 8.8, domains: ['radar'], priority: 3 },
  { name: 'Dortmund', lat: 51.51, lon: 7.47, domains: ['radar'], priority: 3 },
  { name: 'Kiel', lat: 54.32, lon: 10.14, domains: ['radar'], priority: 3 },
  { name: 'Rostock', lat: 54.09, lon: 12.13, domains: ['radar'], priority: 3 },
  { name: 'Erfurt', lat: 50.98, lon: 11.03, domains: ['radar'], priority: 3 },
  { name: 'Saarbrücken', lat: 49.24, lon: 6.99, domains: ['radar'], priority: 3 },
  { name: 'Freiburg', lat: 47.99, lon: 7.85, domains: ['radar'], priority: 3 },
  { name: 'Regensburg', lat: 49.02, lon: 12.1, domains: ['radar'], priority: 3 },
  { name: 'Basel', lat: 47.56, lon: 7.59, domains: ['radar'], priority: 3 },
  { name: 'Straßburg', lat: 48.58, lon: 7.75, domains: ['radar'], priority: 3 },

  // --- Europa-Domain: Hauptstädte der größeren Länder in der BBox
  { name: 'Madrid', lat: 40.42, lon: -3.7, domains: ['europe'], priority: 1 },
  { name: 'Paris', lat: 48.86, lon: 2.35, domains: ['europe'], priority: 1 },
  { name: 'London', lat: 51.51, lon: -0.13, domains: ['europe'], priority: 1 },
  { name: 'Berlin', lat: 52.52, lon: 13.4, domains: ['europe', 'radar'], priority: 1 },
  { name: 'Rom', lat: 41.9, lon: 12.5, domains: ['europe'], priority: 1 },
  { name: 'Warschau', lat: 52.23, lon: 21.01, domains: ['europe'], priority: 1 },
  { name: 'Kiew', lat: 50.45, lon: 30.52, domains: ['europe'], priority: 1 },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, domains: ['europe'], priority: 1 },
  { name: 'Moskau', lat: 55.75, lon: 37.62, domains: ['europe'], priority: 1 },
  { name: 'Lissabon', lat: 38.72, lon: -9.14, domains: ['europe'], priority: 2 },
  { name: 'Prag', lat: 50.08, lon: 14.44, domains: ['europe', 'radar'], priority: 2 },
  { name: 'Budapest', lat: 47.5, lon: 19.04, domains: ['europe'], priority: 2 },
  { name: 'Bukarest', lat: 44.43, lon: 26.1, domains: ['europe'], priority: 2 },
  { name: 'Athen', lat: 37.98, lon: 23.73, domains: ['europe'], priority: 2 },
  { name: 'Oslo', lat: 59.91, lon: 10.75, domains: ['europe'], priority: 2 },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, domains: ['europe'], priority: 2 },
  { name: 'Kopenhagen', lat: 55.68, lon: 12.57, domains: ['europe', 'radar'], priority: 2 },
  { name: 'Ankara', lat: 39.93, lon: 32.86, domains: ['europe'], priority: 2 },
  { name: 'Dublin', lat: 53.35, lon: -6.26, domains: ['europe'], priority: 3 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.9, domains: ['europe', 'radar'], priority: 3 },
  { name: 'Brüssel', lat: 50.85, lon: 4.35, domains: ['europe', 'radar'], priority: 3 },
  { name: 'Bern', lat: 46.95, lon: 7.45, domains: ['europe', 'radar'], priority: 3 },
  { name: 'Belgrad', lat: 44.79, lon: 20.45, domains: ['europe'], priority: 3 },
  { name: 'Minsk', lat: 53.9, lon: 27.57, domains: ['europe'], priority: 3 },
  { name: 'Sofia', lat: 42.7, lon: 23.32, domains: ['europe'], priority: 3 },
]
