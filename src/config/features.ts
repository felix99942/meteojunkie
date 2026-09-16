// Build-Zeit-Feature-Flags.
//
// MAP_ENABLED: Der Karten-Viewer ist noch nicht ausgereift und wird in der
// veröffentlichten Web-Version deaktiviert — dort funktionieren Meteogramm und
// Vertikalprofil (reine Punktabfragen direkt an Open-Meteo, kein Grid-Proxy
// nötig, daher rein statisch hostbar). Die lokale Entwicklung (`npm run dev`)
// behält die Karte. Deaktivieren beim Web-Build über VITE_ENABLE_MAP=false
// (siehe `npm run build:web`).
export const MAP_ENABLED = import.meta.env.VITE_ENABLE_MAP !== 'false'

/**
 * POINT_FORECASTS_ENABLED: Der Bereich „Punktprognosen" (AppView `workbench`
 * — freie Variablen-/Modellwahl über bis zu sechs Panels, plus die Karte) ist
 * in der veröffentlichten Web-Version AUSGEBLENDET. Er hat sich neben dem
 * klassischen Meteogramm, dem Ensemble, dem Vertikalprofil und der
 * Verifikation nicht als eigener Nutzen gezeigt: dieselben Punktabfragen,
 * nur mit mehr Bedienung davor.
 *
 * NICHT gelöscht, sondern abgeschaltet: der Zustand (sechs `PanelConfig`s),
 * die gespeicherten Presets und das Layout je Bereich bleiben unverändert im
 * Speicher — Ensemble und Vertikalprofil teilen sich dieselben Panel-Configs
 * (siehe `state/appView.ts`), das Löschen des Bereichs hätte sie mitgerissen.
 * Auch die Karte hängt daran, sie ist nur von hier aus erreichbar.
 *
 * Anders als bei der Karte wird der Eintrag NICHT ausgegraut, sondern
 * vollständig aus der Navigation entfernt — ein deaktivierter Menüpunkt wirft
 * die Frage auf, was da fehlt.
 *
 * Wiedereinschalten: `VITE_ENABLE_POINT_FORECASTS` aus `npm run build:web`
 * entfernen. Die lokale Entwicklung (`npm run dev`) behält den Bereich.
 */
export const POINT_FORECASTS_ENABLED =
  import.meta.env.VITE_ENABLE_POINT_FORECASTS !== 'false'
