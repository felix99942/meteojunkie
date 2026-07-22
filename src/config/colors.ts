// Serienfarben für Modellvergleichs-Plots (dunkle Fläche #18191b).
// Feste Slot-Reihenfolge, validiert (CVD-Separation, Kontrast ≥ 3:1) —
// Reihenfolge nicht umsortieren, sie ist der Farbfehlsichtigkeits-Schutz.
// Slots werden pro Panel beim Hinzufügen eines Modells vergeben und bleiben
// beim Abwählen anderer Modelle stabil (Farbe folgt dem Modell, nicht dem Rang).
//
// Flächen-Farbskalen für Karten (Phase 2) kommen separat nach
// src/config/colorscales.ts.

export const SERIES_COLORS = [
  '#3987e5', // blau
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // gelb
  '#d55181', // magenta
  '#008300', // grün
  '#9085e9', // violett
  '#e66767', // rot
]

export const MAX_MODELS_PER_PANEL = SERIES_COLORS.length
