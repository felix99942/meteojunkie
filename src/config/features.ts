// Build-Zeit-Feature-Flags.
//
// MAP_ENABLED: Der Karten-Viewer ist noch nicht ausgereift und wird in der
// veröffentlichten Web-Version deaktiviert — dort funktionieren Meteogramm und
// Vertikalprofil (reine Punktabfragen direkt an Open-Meteo, kein Grid-Proxy
// nötig, daher rein statisch hostbar). Die lokale Entwicklung (`npm run dev`)
// behält die Karte. Deaktivieren beim Web-Build über VITE_ENABLE_MAP=false
// (siehe `npm run build:web`).
export const MAP_ENABLED = import.meta.env.VITE_ENABLE_MAP !== 'false'
