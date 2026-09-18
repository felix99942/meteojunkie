// Kuratierte Städte für die Kartenpanels — bewusst handgepflegt, nicht aus
// einem Datensatz gefiltert. `domains` steuert die Sichtbarkeit pro Domain,
// `priority` die Ausdünnung bei kleinen Panels (1 = bleibt am längsten;
// Punkte bleiben, Labels fallen zuerst weg).
//
// `domains` trägt die DomainPreset-IDs UND die Pseudo-Domain `'imagery'` für
// die BILDKARTEN — Radar (`components/RadarPanel.tsx`) und Satellit
// (`components/SatellitePanel.tsx`). Die haben keine DomainPreset, ihre Fläche
// gibt der jeweilige Dienst bzw. der gewählte Ausschnitt vor; sie brauchen
// aber genau diese Orientierung: ohne Städte ist ein Echo über
// Nordrhein-Westfalen ein Fleck ohne Ort. Ein zweites Städteverzeichnis
// daneben wäre schlechter als eine gemeinsame Pseudo-Domain in diesem.
// (Hieß bis 2026-09-19 `'radar'` — mit dem Satellitenbereich trägt sie zwei.)

export interface City {
  name: string
  lat: number
  lon: number
  domains: string[] // DomainPreset-IDs
  priority: 1 | 2 | 3 | 4 | 5
}

export const CITIES: City[] = [
  // --- Österreich-Domain: Landeshauptstädte …
  { name: 'Wien', lat: 48.21, lon: 16.37, domains: ['austria', 'europe', 'imagery'], priority: 1 },
  { name: 'Graz', lat: 47.07, lon: 15.44, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Linz', lat: 48.31, lon: 14.29, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Salzburg', lat: 47.8, lon: 13.04, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Innsbruck', lat: 47.27, lon: 11.39, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Klagenfurt', lat: 46.62, lon: 14.31, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Bregenz', lat: 47.5, lon: 9.75, domains: ['austria', 'imagery'], priority: 3 },
  { name: 'St. Pölten', lat: 48.2, lon: 15.62, domains: ['austria', 'imagery'], priority: 3 },
  { name: 'Eisenstadt', lat: 47.85, lon: 16.52, domains: ['austria', 'imagery'], priority: 3 },
  { name: 'Villach', lat: 46.61, lon: 13.85, domains: ['austria', 'imagery'], priority: 3 },
  // … und Orientierung über die Grenze
  { name: 'München', lat: 48.14, lon: 11.58, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Zürich', lat: 47.37, lon: 8.54, domains: ['austria', 'imagery'], priority: 2 },
  { name: 'Ljubljana', lat: 46.06, lon: 14.51, domains: ['austria', 'imagery'], priority: 3 },
  { name: 'Bratislava', lat: 48.15, lon: 17.11, domains: ['austria', 'imagery'], priority: 3 },
  { name: 'Bozen', lat: 46.5, lon: 11.35, domains: ['austria', 'imagery'], priority: 3 },

  // --- Bildkarten: deutsche Städte als Orientierung. Berlin/München/Zürich
  // stehen schon oben, hier kommt der Rest des Abdeckungsgebiets dazu.
  { name: 'Hamburg', lat: 53.55, lon: 9.99, domains: ['imagery'], priority: 1 },
  { name: 'Köln', lat: 50.94, lon: 6.96, domains: ['imagery'], priority: 1 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68, domains: ['imagery'], priority: 2 },
  { name: 'Stuttgart', lat: 48.78, lon: 9.18, domains: ['imagery'], priority: 2 },
  { name: 'Leipzig', lat: 51.34, lon: 12.37, domains: ['imagery'], priority: 2 },
  { name: 'Hannover', lat: 52.37, lon: 9.73, domains: ['imagery'], priority: 2 },
  { name: 'Nürnberg', lat: 49.45, lon: 11.08, domains: ['imagery'], priority: 2 },
  { name: 'Dresden', lat: 51.05, lon: 13.74, domains: ['imagery'], priority: 3 },
  { name: 'Bremen', lat: 53.08, lon: 8.8, domains: ['imagery'], priority: 3 },
  { name: 'Dortmund', lat: 51.51, lon: 7.47, domains: ['imagery'], priority: 3 },
  { name: 'Kiel', lat: 54.32, lon: 10.14, domains: ['imagery'], priority: 3 },
  { name: 'Rostock', lat: 54.09, lon: 12.13, domains: ['imagery'], priority: 3 },
  { name: 'Erfurt', lat: 50.98, lon: 11.03, domains: ['imagery'], priority: 3 },
  { name: 'Saarbrücken', lat: 49.24, lon: 6.99, domains: ['imagery'], priority: 3 },
  { name: 'Freiburg', lat: 47.99, lon: 7.85, domains: ['imagery'], priority: 3 },
  { name: 'Regensburg', lat: 49.02, lon: 12.1, domains: ['imagery'], priority: 3 },
  { name: 'Basel', lat: 47.56, lon: 7.59, domains: ['imagery'], priority: 3 },
  { name: 'Straßburg', lat: 48.58, lon: 7.75, domains: ['imagery'], priority: 3 },

  // --- Bildkarten (Radar + Satellit), ab Zoomstufe 7 bzw. 8 ---------------
  //
  // Koordinaten NICHT aus dem Kopf, sondern über das Open-Meteo-Geocoding
  // geholt und gegen die Einwohnerzahl plausibilisiert (2026-09-19). Der
  // Umweg lohnt sich: die erste Abfrage lieferte für „Milano" und „Venezia"
  // gleichnamige Kleinorte in Mittelitalien — 300 km daneben, und in der
  // Karte sähe das aus wie ein Versatz der Projektion.
  //
  // Priorität 4 = Regionalzentren, ab Zoom 7. Ein paar liegen außerhalb der
  // Radarfläche; dort sind sie reine Geografie und stören nicht, auf der
  // Satellitenkarte tragen sie.
  { name: 'Aachen', lat: 50.78, lon: 6.08, domains: ['imagery'], priority: 4 },
  { name: 'Antwerpen', lat: 51.22, lon: 4.4, domains: ['imagery'], priority: 4 },
  { name: 'Augsburg', lat: 48.37, lon: 10.9, domains: ['imagery'], priority: 4 },
  { name: 'Bielefeld', lat: 52.03, lon: 8.53, domains: ['imagery'], priority: 4 },
  { name: 'Bonn', lat: 50.73, lon: 7.1, domains: ['imagery'], priority: 4 },
  { name: 'Braunschweig', lat: 52.27, lon: 10.53, domains: ['imagery'], priority: 4 },
  { name: 'Breslau', lat: 51.1, lon: 17.03, domains: ['imagery'], priority: 4 },
  { name: 'Brünn', lat: 49.2, lon: 16.61, domains: ['imagery'], priority: 4 },
  { name: 'Chemnitz', lat: 50.84, lon: 12.93, domains: ['imagery'], priority: 4 },
  { name: 'Chur', lat: 46.85, lon: 9.53, domains: ['imagery'], priority: 4 },
  { name: 'Cottbus', lat: 51.76, lon: 14.33, domains: ['imagery'], priority: 4 },
  { name: 'Dornbirn', lat: 47.41, lon: 9.74, domains: ['imagery'], priority: 4 },
  { name: 'Düsseldorf', lat: 51.22, lon: 6.78, domains: ['imagery'], priority: 4 },
  { name: 'Essen', lat: 51.46, lon: 7.01, domains: ['imagery'], priority: 4 },
  { name: 'Flensburg', lat: 54.79, lon: 9.44, domains: ['imagery'], priority: 4 },
  { name: 'Genf', lat: 46.2, lon: 6.15, domains: ['imagery'], priority: 4 },
  { name: 'Göttingen', lat: 51.53, lon: 9.93, domains: ['imagery'], priority: 4 },
  { name: 'Halle (Saale)', lat: 51.48, lon: 11.98, domains: ['imagery'], priority: 4 },
  { name: 'Heilbronn', lat: 49.14, lon: 9.22, domains: ['imagery'], priority: 4 },
  { name: 'Jena', lat: 50.93, lon: 11.59, domains: ['imagery'], priority: 4 },
  { name: 'Karlsruhe', lat: 49.01, lon: 8.4, domains: ['imagery'], priority: 4 },
  { name: 'Kassel', lat: 51.32, lon: 9.5, domains: ['imagery'], priority: 4 },
  { name: 'Kempten', lat: 47.73, lon: 10.31, domains: ['imagery'], priority: 4 },
  { name: 'Koblenz', lat: 50.35, lon: 7.58, domains: ['imagery'], priority: 4 },
  { name: 'Konstanz', lat: 47.66, lon: 9.18, domains: ['imagery'], priority: 4 },
  { name: 'Krems', lat: 48.41, lon: 15.61, domains: ['imagery'], priority: 4 },
  { name: 'Kufstein', lat: 47.58, lon: 12.17, domains: ['imagery'], priority: 4 },
  { name: 'Lausanne', lat: 46.52, lon: 6.63, domains: ['imagery'], priority: 4 },
  { name: 'Leoben', lat: 47.38, lon: 15.09, domains: ['imagery'], priority: 4 },
  { name: 'Luxemburg', lat: 49.61, lon: 6.13, domains: ['imagery'], priority: 4 },
  { name: 'Luzern', lat: 47.05, lon: 8.31, domains: ['imagery'], priority: 4 },
  { name: 'Lyon', lat: 45.75, lon: 4.85, domains: ['imagery'], priority: 4 },
  { name: 'Lübeck', lat: 53.87, lon: 10.69, domains: ['imagery'], priority: 4 },
  { name: 'Magdeburg', lat: 52.13, lon: 11.63, domains: ['imagery'], priority: 4 },
  { name: 'Mailand', lat: 45.46, lon: 9.19, domains: ['imagery'], priority: 4 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Mainz', lat: 49.98, lon: 8.28, domains: ['imagery'], priority: 4 },
  { name: 'Mannheim', lat: 49.49, lon: 8.47, domains: ['imagery'], priority: 4 },
  { name: 'Münster', lat: 51.96, lon: 7.63, domains: ['imagery'], priority: 4 },
  { name: 'Nancy', lat: 48.68, lon: 6.18, domains: ['imagery'], priority: 4 },
  { name: 'Oldenburg', lat: 53.14, lon: 8.21, domains: ['imagery'], priority: 4 },
  { name: 'Osnabrück', lat: 52.27, lon: 8.05, domains: ['imagery'], priority: 4 },
  { name: 'Passau', lat: 48.57, lon: 13.43, domains: ['imagery'], priority: 4 },
  { name: 'Pilsen', lat: 49.68, lon: 13.27, domains: ['imagery'], priority: 4 },
  { name: 'Posen', lat: 52.41, lon: 16.93, domains: ['imagery'], priority: 4 },
  { name: 'Potsdam', lat: 52.4, lon: 13.07, domains: ['imagery'], priority: 4 },
  { name: 'Rosenheim', lat: 47.86, lon: 12.12, domains: ['imagery'], priority: 4 },
  { name: 'Rotterdam', lat: 51.92, lon: 4.48, domains: ['imagery'], priority: 4 },
  { name: 'Schwerin', lat: 53.63, lon: 11.41, domains: ['imagery'], priority: 4 },
  { name: 'St. Gallen', lat: 47.42, lon: 9.37, domains: ['imagery'], priority: 4 },
  { name: 'Stettin', lat: 53.43, lon: 14.55, domains: ['imagery'], priority: 4 },
  { name: 'Trient', lat: 46.07, lon: 11.12, domains: ['imagery'], priority: 4 },
  { name: 'Trier', lat: 49.76, lon: 6.64, domains: ['imagery'], priority: 4 },
  { name: 'Triest', lat: 45.65, lon: 13.78, domains: ['imagery'], priority: 4 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Udine', lat: 46.07, lon: 13.24, domains: ['imagery'], priority: 4 },
  { name: 'Ulm', lat: 48.4, lon: 9.99, domains: ['imagery'], priority: 4 },
  { name: 'Venedig', lat: 45.44, lon: 12.33, domains: ['imagery'], priority: 4 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Verona', lat: 45.44, lon: 10.99, domains: ['imagery'], priority: 4 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Wels', lat: 48.17, lon: 14.03, domains: ['imagery'], priority: 4 },
  { name: 'Wiener Neustadt', lat: 47.8, lon: 16.23, domains: ['imagery'], priority: 4 },
  { name: 'Winterthur', lat: 47.51, lon: 8.72, domains: ['imagery'], priority: 4 },
  { name: 'Würzburg', lat: 49.79, lon: 9.95, domains: ['imagery'], priority: 4 },
  { name: 'Zagreb', lat: 45.81, lon: 15.98, domains: ['imagery'], priority: 4 },

  // Priorität 5 = Alpenorte, Grenzstädte und kleinere Zentren, ab Zoom 8.
  // Die Alpenorte stehen hier, weil bei Föhn, Stau und Gewitterlagen genau
  // sie die Orientierung geben (Zell am See, Kitzbühel, Davos, Zermatt).
  { name: 'Bad Ischl', lat: 47.71, lon: 13.62, domains: ['imagery'], priority: 5 },
  { name: 'Berchtesgaden', lat: 47.63, lon: 13.0, domains: ['imagery'], priority: 5 },
  { name: 'Bologna', lat: 44.49, lon: 11.34, domains: ['imagery'], priority: 5 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Davos', lat: 46.8, lon: 9.84, domains: ['imagery'], priority: 5 },
  { name: 'Dijon', lat: 47.31, lon: 5.01, domains: ['imagery'], priority: 5 },
  { name: 'Emden', lat: 53.37, lon: 7.21, domains: ['imagery'], priority: 5 },
  { name: 'Feldkirch', lat: 47.24, lon: 9.6, domains: ['imagery'], priority: 5 },
  { name: 'Garmisch-Partenkirchen', lat: 47.49, lon: 11.1, domains: ['imagery'], priority: 5 },
  { name: 'Groningen', lat: 53.22, lon: 6.57, domains: ['imagery'], priority: 5 },
  { name: 'Győr', lat: 47.68, lon: 17.64, domains: ['imagery'], priority: 5 },
  { name: 'Görlitz', lat: 51.16, lon: 14.99, domains: ['imagery'], priority: 5 },
  { name: 'Interlaken', lat: 46.68, lon: 7.87, domains: ['imagery'], priority: 5 },
  { name: 'Kitzbühel', lat: 47.45, lon: 12.39, domains: ['imagery'], priority: 5 },
  { name: 'Krakau', lat: 50.06, lon: 19.94, domains: ['imagery'], priority: 5 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Lienz', lat: 46.83, lon: 12.77, domains: ['imagery'], priority: 5 },
  { name: 'Lille', lat: 50.63, lon: 3.06, domains: ['imagery'], priority: 5 },
  { name: 'Locarno', lat: 46.17, lon: 8.8, domains: ['imagery'], priority: 5 },
  { name: 'Lüttich', lat: 50.63, lon: 5.57, domains: ['imagery'], priority: 5 },
  { name: 'Maastricht', lat: 50.85, lon: 5.69, domains: ['imagery'], priority: 5 },
  { name: 'Mariazell', lat: 47.77, lon: 15.32, domains: ['imagery'], priority: 5 },
  { name: 'Maribor', lat: 46.56, lon: 15.65, domains: ['imagery'], priority: 5 },
  { name: 'Meran', lat: 46.67, lon: 11.16, domains: ['imagery'], priority: 5 },
  { name: 'Metz', lat: 49.12, lon: 6.17, domains: ['imagery'], priority: 5 },
  { name: 'Oberstdorf', lat: 47.41, lon: 10.28, domains: ['imagery'], priority: 5 },
  { name: 'Ostrau', lat: 49.83, lon: 18.28, domains: ['imagery'], priority: 5 },
  { name: 'Sion', lat: 46.23, lon: 7.36, domains: ['imagery'], priority: 5 },
  { name: 'Sopron', lat: 47.69, lon: 16.59, domains: ['imagery'], priority: 5 },
  { name: 'Spittal', lat: 46.8, lon: 13.5, domains: ['imagery'], priority: 5 },
  { name: 'Turin', lat: 45.07, lon: 7.69, domains: ['imagery'], priority: 5 },  // außerhalb der Radarfläche — nur auf der Satellitenkarte
  { name: 'Vaduz', lat: 47.14, lon: 9.52, domains: ['imagery'], priority: 5 },
  { name: 'Westerland', lat: 54.91, lon: 8.3, domains: ['imagery'], priority: 5 },
  { name: 'Zell am See', lat: 47.32, lon: 12.8, domains: ['imagery'], priority: 5 },
  { name: 'Zermatt', lat: 46.02, lon: 7.75, domains: ['imagery'], priority: 5 },

  // --- Europa-Domain: Hauptstädte der größeren Länder in der BBox
  { name: 'Madrid', lat: 40.42, lon: -3.7, domains: ['europe'], priority: 1 },
  { name: 'Paris', lat: 48.86, lon: 2.35, domains: ['europe'], priority: 1 },
  { name: 'London', lat: 51.51, lon: -0.13, domains: ['europe'], priority: 1 },
  { name: 'Berlin', lat: 52.52, lon: 13.4, domains: ['europe', 'imagery'], priority: 1 },
  { name: 'Rom', lat: 41.9, lon: 12.5, domains: ['europe'], priority: 1 },
  { name: 'Warschau', lat: 52.23, lon: 21.01, domains: ['europe'], priority: 1 },
  { name: 'Kiew', lat: 50.45, lon: 30.52, domains: ['europe'], priority: 1 },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, domains: ['europe'], priority: 1 },
  { name: 'Moskau', lat: 55.75, lon: 37.62, domains: ['europe'], priority: 1 },
  { name: 'Lissabon', lat: 38.72, lon: -9.14, domains: ['europe'], priority: 2 },
  { name: 'Prag', lat: 50.08, lon: 14.44, domains: ['europe', 'imagery'], priority: 2 },
  { name: 'Budapest', lat: 47.5, lon: 19.04, domains: ['europe'], priority: 2 },
  { name: 'Bukarest', lat: 44.43, lon: 26.1, domains: ['europe'], priority: 2 },
  { name: 'Athen', lat: 37.98, lon: 23.73, domains: ['europe'], priority: 2 },
  { name: 'Oslo', lat: 59.91, lon: 10.75, domains: ['europe'], priority: 2 },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, domains: ['europe'], priority: 2 },
  { name: 'Kopenhagen', lat: 55.68, lon: 12.57, domains: ['europe', 'imagery'], priority: 2 },
  { name: 'Ankara', lat: 39.93, lon: 32.86, domains: ['europe'], priority: 2 },
  { name: 'Dublin', lat: 53.35, lon: -6.26, domains: ['europe'], priority: 3 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.9, domains: ['europe', 'imagery'], priority: 3 },
  { name: 'Brüssel', lat: 50.85, lon: 4.35, domains: ['europe', 'imagery'], priority: 3 },
  { name: 'Bern', lat: 46.95, lon: 7.45, domains: ['europe', 'imagery'], priority: 3 },
  { name: 'Belgrad', lat: 44.79, lon: 20.45, domains: ['europe'], priority: 3 },
  { name: 'Minsk', lat: 53.9, lon: 27.57, domains: ['europe'], priority: 3 },
  { name: 'Sofia', lat: 42.7, lon: 23.32, domains: ['europe'], priority: 3 },
]
