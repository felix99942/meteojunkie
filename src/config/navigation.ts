// Bereiche der Seite und ihre Gliederung — EINE Quelle für die Navigation
// (`AppNav`) und die Kacheln der Startseite (`LandingPage`), sonst liefen
// zwei Fassungen derselben Liste auseinander.
//
// GEGLIEDERT NACH DER FRAGE, mit der man kommt (seit 2026-11-02, auf Wunsch;
// vorher „Vorhersage + Klima" mit sechs Bereichen und „Analyse" mit zweien):
//
//   Vorhersage   was kommt — Modellausgabe am Punkt, als Karte, als Ensemble,
//                als Profil, Föhn und die statistisch korrigierte MOS
//   Beobachtung  was ist bzw. war — Radar, Satellit, Klima der Stationen,
//                Luftqualität (Modell UND Messung)
//   Auswertung   wie gut war es — die Verifikation, der einzige Bereich, der
//                die übrigen bewertet
//
// Die Farbe trägt die Gruppe (CSS-Klassen `is-forecast` / `is-imagery` /
// `is-verify` — die Schlüssel sind historisch, die Beschriftung nicht).

import type { AppView } from '../state/appView'

export type NavGroup = 'forecast' | 'imagery' | 'verify'

export const NAV_GROUPS: { key: NavGroup; label: string; blurb: string }[] = [
  { key: 'forecast', label: 'Vorhersage', blurb: 'Was kommt — aus den Modellen, roh und nebeneinander' },
  { key: 'imagery', label: 'Beobachtung', blurb: 'Was ist und was war — gemessen, nicht gerechnet' },
  { key: 'verify', label: 'Auswertung', blurb: 'Wie gut war die Vorhersage?' },
]

export interface NavTab {
  id: AppView
  label: string
  /** Tooltip in der Navigation */
  title: string
  group: NavGroup
  /** Kurztext auf der Kachel der Startseite */
  blurb: string
}

export const NAV_TABS: NavTab[] = [
  {
    id: 'classic',
    label: 'Meteogramm',
    title: 'Klassisches Meteogramm — Temperatur, Niederschlag, Wolken, Wind auf einen Blick',
    group: 'forecast',
    blurb: 'Ein Ort, ein Modell: Temperatur, Niederschlag, Wolken in Achteln, Wind mit Fiedern, Luftdruck.',
  },
  {
    id: 'globe',
    label: 'Modellkarten',
    title: 'ECMWF IFS, ICON-EU, ICON-D2 und Varda als Globus, Karte oder 4/6 Panels nebeneinander',
    group: 'forecast',
    blurb: 'IFS, ICON und das KI-Modell Varda als Globus oder im 4er/6er-Vergleich — Wind, Regen, Wolken, Höhenwetter.',
  },
  {
    id: 'ensemble',
    label: 'Ensemble',
    title: 'Plume-Diagramme am Punkt — Streuung der Mitglieder',
    group: 'forecast',
    blurb: 'Wie sicher ist die Vorhersage? Alle Mitglieder als Plume, Niederschlag als Quantil-Säulen.',
  },
  {
    id: 'profile',
    label: 'Soundings',
    title: 'Skew-T am Punkt — Schichtung der Atmosphäre',
    group: 'forecast',
    blurb: 'Skew-T am frei gewählten Punkt, mehrere Modelle übereinander, dazu gemessene Radiosonden.',
  },
  {
    id: 'foehn',
    label: 'Föhn',
    title: 'Föhn-Diagnose: Druckdifferenz über die Alpen, Kammwind und Lee-Station — Modelle und Ensemble',
    group: 'forecast',
    blurb: 'Druckdifferenz über den Alpenhauptkamm, Kammwind und Lee-Station — Modelle und Ensemble.',
  },
  {
    id: 'mos',
    label: 'MOS',
    title: 'MOS-Punktvorhersage für den DACH-Raum (DWD MOSMIX, 3.000 Stationen)',
    group: 'forecast',
    blurb: 'Statistisch korrigierte Punktvorhersage (DWD MOSMIX) für 3.000 Stationen in D-A-CH.',
  },
  {
    id: 'radar',
    label: 'Radar',
    title: 'Niederschlagsradar: DWD-Komposit im 5-Minuten-Takt — Deutschland, Schweiz und Westösterreich',
    group: 'imagery',
    blurb: 'Radarkomposit des DWD alle 5 Minuten, Blitze, Säulenmaximum und VIL.',
  },
  {
    id: 'satellite',
    label: 'Satellit',
    title:
      'Satellitenbilder von EUMETSAT: Meteosat Third Generation alle 10 Minuten (Geocolour, sichtbar hochaufgelöst, Infrarot), MSG alle 15 (Luftmassen, Konvektion)',
    group: 'imagery',
    blurb: 'Meteosat der dritten Generation alle 10 Minuten — Geocolour, Infrarot, Wasserdampf, Nebel.',
  },
  {
    id: 'at-klima',
    label: 'Klima',
    title: 'Klimakarte Österreich und Deutschland (GeoSphere- und DWD-Stationsdaten), Rekorde und Klimaarchiv',
    group: 'imagery',
    blurb: 'Stationswerte, Normale und Rekorde für Österreich und Deutschland — mit Fragen ans Klimaarchiv.',
  },
  {
    id: 'air',
    label: 'Luftqualität',
    title: 'Luftqualität am Punkt — Europäischer Luftqualitätsindex, Feinstaub, Stickstoffdioxid, Ozon, Saharastaub (CAMS)',
    group: 'imagery',
    blurb: 'Luftqualitätsindex, Feinstaub, NO₂ und Ozon — CAMS-Modell und Messstationen nebeneinander.',
  },
  {
    id: 'verify',
    label: 'Verifikation',
    title: 'Wie gut war die Vorhersage? Vergangene Modellläufe gegen die gemessenen Stationswerte',
    group: 'verify',
    blurb: 'Vergangene Modellläufe gegen die gemessenen Stationswerte — Tag für Tag und als Rangliste.',
  },
  // Steht in der veröffentlichten Version nicht in der Reihe
  // (`POINT_FORECASTS_ENABLED`) und deshalb am Ende
  {
    id: 'workbench',
    label: 'Punktprognosen',
    title: 'Modellvergleich als Zeitreihe und Karte, frei wählbare Variablen',
    group: 'forecast',
    blurb: 'Modellvergleich als Zeitreihe und Karte, frei wählbare Variablen.',
  },
]
