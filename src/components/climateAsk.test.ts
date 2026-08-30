// Die Testfragen sind absichtlich schlampig: Kleinschreibung, Tippfehler,
// fehlende Satzzeichen. Fünf davon (mit ✗ markiert) hat ein erster Prototyp
// falsch verstanden — sie stehen hier, damit die Korrekturen nicht wieder
// verlorengehen.

import { describe, expect, it } from 'vitest'
import type { AtStation } from '../api/geosphere'
import {
  answerFromNormals,
  answerFromRecords,
  matchStations,
  normalize,
  parseQuestion,
} from './climateAsk'

const st = (id: number, name: string, isActive = true, validFrom = '1980-01-01'): AtStation =>
  ({ id, name, state: 'X', lat: 47, lon: 15, altitude: 300, isActive, validFrom }) as AtStation

const STATIONS: AtStation[] = [
  // Echte Werte: Flughafen fuehrt die Salzburger Reihe seit 1874 fort,
  // Freisaal misst erst seit 1987, und die Station namens „Salzburg" wurde
  // 1903 stillgelegt.
  st(131, 'Salzburg Flughafen', true, '1874-01-01'),
  st(145, 'Salzburg Freisaal', true, '1987-01-01'),
  st(6306, 'Salzburg', false, '1874-01-01'),
  st(5925, 'Wien Hohe Warte'),
  st(4001, 'Hohe Wand/Hochkogelhaus'),
  st(11035, 'Innsbruck Universität'),
  st(16412, 'Graz Universität'),
  st(17002, 'Obergurgl'),
  st(9001, 'Bregenz'),
  st(20212, 'Klagenfurt Flughafen'),
  st(11803, 'Warth'),
  st(11010, 'Linz Stadt'),
]

const ask = (q: string) => parseQuestion(q, STATIONS)

describe('normalize', () => {
  it('faltet Umlaute und Satzzeichen weg', () => {
    expect(normalize('Wärmster Juli in Grüßau?')).toBe('warmster juli in grussau')
  })
})

describe('parseQuestion — die Beispielfrage', () => {
  it('versteht sie vollständig', () => {
    const q = ask('was war das tagesmaximum im juli seit messbeginn in salzburg?')
    expect(q.station?.name).toBe('Salzburg Flughafen')
    expect(q.param).toBe('tlmax')
    expect(q.month).toBe(7)
    expect(q.extreme).toBe('max')
    expect(q.scope).toBe('record')
  })

  it('übersteht vier Tippfehler in einem Satz', () => {
    const q = ask('was war das tagesmaxiumm im julli seit messbegin in salzbrug?')
    expect(q.station?.name).toBe('Salzburg Flughafen')
    expect(q.param).toBe('tlmax')
    expect(q.month).toBe(7)
  })
})

describe('parseQuestion — die vier Fehler des Prototyps', () => {
  it('✗ hebt generisches „Temperatur" per Superlativ auf Max bzw. Min', () => {
    // Vorher: tl_mittel — „höchste Temperatur" ist aber der Höchstwert.
    expect(ask('wie hoch war die höchste je gemessene temperatur im juni in salzburg?').param)
      .toBe('tlmax')
    expect(ask('kälteste temperatur im jänner in innsbruck').param).toBe('tlmin')
    // Ohne Superlativ bleibt es das Mittel.
    expect(ask('temperatur im juni in salzburg').param).toBe('tl_mittel')
  })

  it('✗ nimmt mehrteilige Stationsnamen als Ganzes', () => {
    // Vorher: „Hohe Wand/Hochkogelhaus", weil „hohe" einzeln verglichen wurde.
    expect(ask('sonnenstunden juli wien hohe warte').station?.name).toBe('Wien Hohe Warte')
  })

  it('✗ liest „Rekord" als Zeitraum, nicht als Richtung', () => {
    // Vorher: extreme = max, obwohl tmin gefragt war.
    const q = ask('tmin dezember klagenfurt rekord')
    expect(q.param).toBe('tlmin')
    expect(q.extreme).toBe('min')
    expect(q.month).toBe(12)
  })

  it('✗ verwechselt kurze Monatskürzel nicht', () => {
    // Vorher: „jui" → Juni. Kurze Tokens gehen über den Präfix, nicht über
    // Ähnlichkeit — „jui" ist zu „jun" und „jul" exakt gleich weit.
    expect(ask('jul salzburg maximum').month).toBe(7)
    expect(ask('jun salzburg maximum').month).toBe(6)
  })
})

describe('parseQuestion — kurze Woerter sind die Fehlerquelle', () => {
  // Beide Faelle traten gegen die ECHTE Stationsliste auf und sind hier
  // festgehalten: unscharfe Vergleiche kurzer Woerter treffen fast immer
  // irgendetwas.
  it('laesst ein einzelnes Funktionswort keine Station treffen', () => {
    // „was WAR das …" landete ueber den Namensanfang bei der Station „Warth".
    expect(ask('was war das tagesmaximum im juli in salzburg').station?.name)
      .toBe('Salzburg Flughafen')
  })

  it('verwechselt die Stadt Linz nicht mit dem Fruehling', () => {
    // „Lenz" stand als Jahreszeit in der Liste und liegt einen Tippfehler von
    // „Linz" entfernt — die Frage wurde dadurch zur Fruehlingsfrage.
    const q = ask('trockenster märz in linz')
    expect(q.station?.name).toBe('Linz Stadt')
    expect(q.season).toBeNull()
    expect(q.month).toBe(3)
  })

  it('liest „seit" nicht als September', () => {
    expect(ask('höchste temperatur seit messbeginn in bregenz').month).toBeNull()
  })
})

describe('parseQuestion — weitere Formen', () => {
  it('erkennt Jahreszeiten', () => {
    const q = ask('nassester sommer in bregenz')
    expect(q.season).toBe('JJA')
    expect(q.param).toBe('rr')
    expect(q.extreme).toBe('max')
  })

  it('unterscheidet Rekord- von Normalfrage', () => {
    expect(ask('wieviel regen fällt im juli in graz normalerweise').scope).toBe('normal')
    expect(ask('nassester juli in graz').scope).toBe('record')
    // „Rekord" schlägt „durchschnittlich" — es ist die konkretere Angabe.
    expect(ask('durchschnittlicher rekord juli graz').scope).toBe('record')
  })

  it('merkt sich eine Jahreszahl', () => {
    expect(ask('wieviel regen fiel im august 2024 in graz').year).toBe(2024)
    expect(ask('wieviel regen fiel im august in graz').year).toBeNull()
  })

  it('kennt Kenntage', () => {
    expect(ask('meiste sommertage in graz').param).toBe('tage_sommer')
    expect(ask('meiste frosttage in obergurgl').param).toBe('tage_frost')
  })

  it('liefert die übrigen Salzburgs als Alternativen mit', () => {
    const q = ask('höchste temperatur juli salzburg')
    expect(q.station?.name).toContain('Salzburg')
    expect(q.alternatives.map((a) => a.name)).toEqual(
      expect.arrayContaining(['Salzburg Freisaal', 'Salzburg']),
    )
  })

  it('gibt ohne erkennbare Station null zurück, statt zu raten', () => {
    expect(ask('höchste temperatur im juli').station).toBeNull()
  })
})

describe('matchStations', () => {
  it('zieht die aktive Station dem exakten Namen einer toten Reihe vor', () => {
    // Die Station namens „Salzburg" mass 1874–1903; ihr Allzeitmaximum sind
    // 34,8 °C von 1900, waehrend die richtige Antwort 37,7 °C lautet. Ein
    // exakter Namenstreffer auf eine tote Reihe liefert also eine falsche Zahl.
    const [first] = matchStations('salzburg', STATIONS)
    expect(first.name).toBe('Salzburg Flughafen')
    expect(matchStations('salzburg', STATIONS).map((m) => m.name)).toContain('Salzburg')
  })

  it('findet nichts bei zu kurzer Eingabe', () => {
    expect(matchStations('sa', STATIONS)).toEqual([])
  })
})

describe('answerFromRecords', () => {
  const rec = {
    abs: { max: { v: 35, d: '1983-07' }, min: { v: -22, d: '1929-02' } },
    mon: Array.from({ length: 12 }, (_, i) => ({
      max: { v: 20 + i, y: 2000 + i },
      min: { v: -10 + i, y: 1990 + i },
    })),
    sea: {
      DJF: { max: { v: 18, y: 2020 }, min: { v: -22, y: 1929 } },
      MAM: { max: { v: 30, y: 2018 }, min: { v: -12, y: 1980 } },
      JJA: { max: { v: 35, y: 1983 }, min: { v: 2, y: 1962 } },
      SON: { max: { v: 29, y: 2011 }, min: { v: -8, y: 1988 } },
    },
  }

  it('zieht den Monatsrekord samt Jahr', () => {
    const q = ask('höchstes tagesmaximum im juli seit messbeginn in salzburg')
    const a = answerFromRecords(q, rec)
    expect(a?.value).toBe(26) // Juli = Index 6 → 20 + 6
    expect(a?.when).toBe('2006')
    expect(a?.unit).toBe('°C')
  })

  it('zieht ohne Monat den absoluten Rekord und formatiert seinen Monat', () => {
    const q = ask('höchstes tagesmaximum seit messbeginn in salzburg')
    const a = answerFromRecords(q, rec)
    expect(a?.value).toBe(35)
    expect(a?.when).toBe('Juli 1983')
  })

  it('gibt Jahr und Monat des Rekords maschinenlesbar mit', () => {
    // „In der Karte zeigen" braucht beides — mit dem laufenden Jahr zeigte die
    // Karte den richtigen Monat im falschen Jahr.
    const abs = answerFromRecords(ask('höchstes tagesmaximum seit messbeginn in salzburg'), rec)
    expect(abs?.year).toBe(1983)
    expect(abs?.recordMonth).toBe(7)
    // Nennt die Frage den Monat schon, braucht es keinen Rekordmonat.
    const jul = answerFromRecords(ask('höchstes tagesmaximum im juli in salzburg'), rec)
    expect(jul?.year).toBe(2006)
    expect(jul?.recordMonth).toBeUndefined()
  })

  it('zieht den Saisonrekord', () => {
    const a = answerFromRecords(ask('kältester winter in salzburg tiefstwert'), rec)
    expect(a?.value).toBe(-22)
  })

  it('gibt null zurück, wenn die Station den Parameter nicht führt', () => {
    expect(answerFromRecords(ask('höchste temperatur juli salzburg'), undefined)).toBeNull()
  })
})

describe('answerFromNormals', () => {
  const entry = {
    monthly: [-2, 0, 4, 9, 14, 17, 19, 18, 13, 8, 3, -1],
    seasonal: [-1, 9, 18, 8],
    annual: 8.5,
    ny: 30,
  }

  it('zieht das Monatsnormal', () => {
    const a = answerFromNormals(ask('wie warm ist es im juli in salzburg normalerweise'), entry, '1991–2020')
    expect(a?.value).toBe(19)
    expect(a?.when).toBe('1991–2020')
  })

  it('zieht das Saisonnormal in der Asset-Reihenfolge DJF/MAM/JJA/SON', () => {
    const a = answerFromNormals(ask('wie warm ist der sommer in salzburg im schnitt'), entry, '1991–2020')
    expect(a?.value).toBe(18)
  })

  it('zieht ohne Zeitraum das Jahresnormal', () => {
    const a = answerFromNormals(ask('durchschnittstemperatur in salzburg'), entry, '1991–2020')
    expect(a?.value).toBe(8.5)
  })

  it('gibt null zurueck, wenn die Station kein Normal hat', () => {
    expect(answerFromNormals(ask('temperatur juli salzburg im schnitt'), undefined, '1991–2020')).toBeNull()
  })

  it('gibt null zurueck, wenn dem Asset die Saisonnormale fehlen', () => {
    // Aeltere Assets kennen `seasonal` nicht — dann gibt es fuer diesen
    // Zeitbezug keinen Wert, statt einen aus den Monaten zu erfinden.
    const old = { monthly: entry.monthly, annual: entry.annual }
    expect(answerFromNormals(ask('wie warm ist der sommer in salzburg im schnitt'), old, '1991–2020')).toBeNull()
  })
})
