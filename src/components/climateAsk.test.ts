// Die Testfragen sind absichtlich schlampig: Kleinschreibung, Tippfehler,
// fehlende Satzzeichen. Fünf davon (mit ✗ markiert) hat ein erster Prototyp
// falsch verstanden — sie stehen hier, damit die Korrekturen nicht wieder
// verlorengehen.

import { describe, expect, it } from 'vitest'
import type { AtStation } from '../api/geosphere'
import { getAtParameter } from '../config/atParameters'
import {
  answerFromNormals,
  answerFromNormalsRange,
  answerFromRecords,
  matchStations,
  mergeRecords,
  normalize,
  parseQuestion,
  askDayRange,
  superlativeText,
  SUPERLATIVE_CODES,
  formatNightSpan,
  nightNote,
  directionDerivable,
  directionNote,
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


// --- Gebiet: Station oder ganz Österreich ------------------------------------

describe('Gebietserkennung', () => {
  it('„in österreich" macht aus der Frage eine Landesfrage', () => {
    expect(ask('höchste je gemessene temperatur in österreich').area).toBe('austria')
    expect(ask('meiste hitzetage österreichweit').area).toBe('austria')
  })

  it('ohne erkannten Ort ist die Frage eine Landesfrage', () => {
    // „höchste je gemessene temperatur" ohne Ortsangabe ist eine Frage ans
    // Land — vorher blieb sie schlicht unbeantwortet.
    expect(ask('höchste je gemessene temperatur').area).toBe('austria')
  })

  it('ein blosser Ortsname fragt den ORT, nicht eine seiner Stationen', () => {
    // „in Salzburg" meint Salzburg — welche der Salzburger Stationen den
    // Rekord hält, ist die ANTWORT, nicht die Frage.
    const q = ask('höchstes tagesmaximum in salzburg')
    expect(q.area).toBe('place')
    expect(q.place?.label).toBe('Salzburg')
    expect(q.place?.ids.sort()).toEqual([131, 145, 6306])
    // Der beste Einzeltreffer bleibt daneben stehen, für den Umschalter.
    expect(q.station?.name).toBe('Salzburg Flughafen')
  })

  it('der vollständige Stationsname fragt die Station', () => {
    // Wer „Salzburg Flughafen" tippt, meint den Flughafen.
    expect(ask('höchstes tagesmaximum in salzburg flughafen').area).toBe('station')
    expect(ask('höchste temperatur wien hohe warte').area).toBe('station')
  })

  it('Österreich schlägt einen zufälligen Stationstreffer', () => {
    // Sonst gewönne irgendein Namensfragment das Gebiet zurück.
    expect(ask('wärmster juli in österreich').area).toBe('austria')
  })
})

describe('answerFromRecords österreichweit', () => {
  // Nationale Rekorde haben dieselbe Form wie Stationsrekorde, tragen aber
  // zusätzlich die Station (`s`/`n`), die den Rekord hält.
  const nat = {
    abs: {
      max: { v: 41.2, d: '2026-08', s: 6111, n: 'Bad Deutsch-Altenburg' },
      min: { v: -9.3, d: '1901-02', s: 213, n: 'Sonnblick' },
    },
    mon: Array.from({ length: 12 }, (_, i) => ({
      max: { v: 30 + i, y: 2000 + i, s: 5421, n: 'Wieselburg' },
      min: { v: -20 + i, y: 1950 + i, s: 213, n: 'Sonnblick' },
    })),
    sea: {
      DJF: { max: { v: 24, y: 2020, s: 5925, n: 'Wien' }, min: { v: -18, y: 1929, s: 213, n: 'Sonnblick' } },
      MAM: { max: { v: 33, y: 2018, s: 5925, n: 'Wien' }, min: { v: -12, y: 1980, s: 213, n: 'Sonnblick' } },
      JJA: { max: { v: 41.2, y: 2026, s: 6111, n: 'Bad Deutsch-Altenburg' }, min: { v: 6.4, y: 1908, s: 213, n: 'Sonnblick' } },
      SON: { max: { v: 32, y: 2011, s: 5925, n: 'Wien' }, min: { v: -8, y: 1988, s: 213, n: 'Sonnblick' } },
    },
  }

  it('nennt die Station als Teil der Antwort', () => {
    // Beim Landesrekord ist das WO die eigentliche Auskunft — bei einer
    // Stationsfrage stand der Ort schon in der Frage.
    const a = answerFromRecords(ask('höchste je gemessene temperatur in österreich'), nat)
    expect(a?.value).toBe(41.2)
    expect(a?.where).toBe('Bad Deutsch-Altenburg')
    expect(a?.whereId).toBe(6111)
    expect(a?.what).toContain('in Österreich')
  })

  it('beantwortet auch Monats- und Saisonfragen ans Land', () => {
    expect(answerFromRecords(ask('wärmster juli in österreich'), nat)?.value).toBe(36)
    expect(answerFromRecords(ask('heißester sommer in österreich'), nat)?.value).toBe(41.2)
  })

  it('nennt bei der Stationsfrage keine Station in der Antwort', () => {
    const rec = { abs: { max: { v: 35, d: '1983-07' }, min: { v: -22, d: '1929-02' } }, mon: [], sea: {} }
    const a = answerFromRecords(ask('höchstes tagesmaximum in salzburg'), rec as never)
    expect(a?.where).toBeUndefined()
    expect(a?.what).not.toContain('Österreich')
  })
})

describe('answerFromNormalsRange', () => {
  const normals = {
    131: { tl_mittel: { monthly: Array.from({ length: 12 }, () => 19), seasonal: [0, 0, 0, 0], annual: 9.5 } },
    213: { tl_mittel: { monthly: Array.from({ length: 12 }, () => 2), seasonal: [0, 0, 0, 0], annual: -5.5 } },
    5925: { tl_mittel: { monthly: Array.from({ length: 12 }, () => 21), seasonal: [0, 0, 0, 0], annual: 11.5 } },
    999: { rr: { monthly: [], annual: 700 } },
  }
  const name = (id: number) => ({ 131: 'Salzburg', 213: 'Sonnblick', 5925: 'Wien' })[id] ?? String(id)

  it('gibt KEIN Flächenmittel, sondern die Spanne über die Stationen', () => {
    // Ein ungewichtetes Stationsmittel wäre von den Bergstationen dominiert
    // und schlicht falsch — das darf die Box nicht als „Österreich" ausgeben.
    const a = answerFromNormalsRange(
      ask('durchschnittstemperatur in österreich'),
      normals as never,
      'tl_mittel',
      name,
      '1991–2020',
    )
    expect(a?.value).toBe(11.5)
    expect(a?.where).toBe('Wien')
    expect(a?.note).toContain('Sonnblick')
    expect(a?.note).toContain('Flächenmittel')
  })

  it('dreht mit der gefragten Richtung', () => {
    const a = answerFromNormalsRange(
      ask('wo ist es in österreich im schnitt am kältesten'),
      normals as never,
      'tl_mittel',
      name,
      '1991–2020',
    )
    expect(a?.value).toBe(-5.5)
    expect(a?.where).toBe('Sonnblick')
  })

  it('zählt nur Stationen, die den Parameter führen', () => {
    const a = answerFromNormalsRange(
      ask('durchschnittstemperatur in österreich'),
      normals as never,
      'tl_mittel',
      name,
      '1991–2020',
    )
    expect(a?.note).toContain('3 Stationen')
  })

  it('gibt null ohne geladene Normale', () => {
    expect(
      answerFromNormalsRange(ask('durchschnittstemperatur in österreich'), null, 'tl_mittel', name, '1991–2020'),
    ).toBeNull()
  })
})


describe('Komposita', () => {
  // Deutsche Fragen sind zusammengesetzt: „Jahresniederschlag" ist die
  // normale Form, nicht „Niederschlag im Jahr". Unscharf ist der Abstand zu
  // groß (0,67), deshalb zählt ein enthaltenes Wort ab sechs Zeichen.
  it('erkennt die Größe im zusammengesetzten Wort', () => {
    expect(ask('durchschnittlicher jahresniederschlag in österreich').param).toBe('rr')
    expect(ask('mittlere jahrestemperatur in salzburg').param).toBe('tl_mittel')
    expect(ask('monatsniederschlag im juli in wien').param).toBe('rr')
  })

  it('lässt den exakten Treffer vorgehen', () => {
    // „höchsttemperatur" steht selbst in der Liste (tlmax) und darf nicht
    // über das enthaltene „temperatur" beim Mittelwert landen.
    expect(ask('höchsttemperatur in salzburg').param).toBe('tlmax')
  })

  it('greift nicht bei kurzen Fragmenten', () => {
    // Fragmente unter sechs Zeichen stecken zufällig in vielen Wörtern —
    // sonst würde „sonnenaufgang" über „sonne" zur Sonnenscheindauer.
    expect(ask('höchstwert in salzburg').param).toBe('tlmax')
  })
})


describe('Jahreswert statt bestem Einzelmonat', () => {
  // Der gemeldete Fehler: „höchster jahresniederschlag in salzburg" lieferte
  // 404 mm aus dem Juli 1954 — den nassesten MONAT. Richtig ist die höchste
  // Jahressumme (1.835 mm, 1912). Die Assets kannten keine Jahresebene.
  it('erkennt die Vorsilbe „Jahres…"', () => {
    const q = ask('höchster jahresniederschlag in salzburg')
    expect(q.param).toBe('rr')
    expect(q.annual).toBe(true)
  })

  it('erkennt sie auch getrennt geschrieben', () => {
    expect(ask('höchster jahres niederschlag in salzburg').annual).toBe(true)
  })

  it('erkennt „jährlich"', () => {
    expect(ask('jährliche niederschlagsmenge in salzburg').annual).toBe(true)
  })

  it('erkennt das blosse „Jahr" — aber nicht „im Jahr 1954"', () => {
    // „wärmstes Jahr" ist die häufigste Form; „im Jahr 1954" benennt dagegen
    // einen Zeitpunkt und keine Jahressumme.
    expect(ask('wärmstes jahr in salzburg').annual).toBe(true)
    expect(ask('höchste temperatur im jahr 1954 in salzburg').annual).toBe(false)
  })

  it('lässt ohne Jahresbezug den besten Einzelmonat', () => {
    // „nassester monat" und „höchste temperatur" fragen nicht nach Jahren.
    expect(ask('nassester monat in salzburg').annual).toBe(false)
    expect(ask('höchste je gemessene temperatur in salzburg').annual).toBe(false)
  })

  it('ein engerer Zeitraum schlägt den Jahresbezug', () => {
    // „nassester Juli" bleibt eine Monatsfrage, auch mit „Jahres…" im Satz.
    expect(ask('höchster jahresniederschlag im juli in salzburg').annual).toBe(false)
    expect(ask('nassester sommer in salzburg').annual).toBe(false)
  })

  it('greift die richtige Rekordebene ab', () => {
    const rec = {
      abs: { max: { v: 404, d: '1954-07' }, min: { v: 0, d: '1908-10' } },
      mon: Array.from({ length: 12 }, () => ({ max: { v: 300, y: 1950 }, min: { v: 1, y: 1960 } })),
      sea: {
        DJF: { max: { v: 500, y: 2020 }, min: { v: 50, y: 1929 } },
        MAM: { max: { v: 500, y: 2018 }, min: { v: 50, y: 1980 } },
        JJA: { max: { v: 700, y: 1983 }, min: { v: 90, y: 1962 } },
        SON: { max: { v: 600, y: 2011 }, min: { v: 60, y: 1988 } },
      },
      ann: { max: { v: 1835, y: 1912 }, min: { v: 792, y: 1969 } },
    }
    expect(answerFromRecords(ask('höchster jahresniederschlag in salzburg'), rec)?.value).toBe(1835)
    expect(answerFromRecords(ask('höchster jahresniederschlag in salzburg'), rec)?.when).toBe('1912')
    expect(answerFromRecords(ask('nassester monat in salzburg'), rec)?.value).toBe(404)
  })

  it('gibt null, wenn ein altes Asset die Jahresebene nicht führt', () => {
    // Lieber keine Antwort als die Monatszahl unter der Jahresüberschrift.
    const old = {
      abs: { max: { v: 404, d: '1954-07' }, min: { v: 0, d: '1908-10' } },
      mon: [],
      sea: {},
    }
    expect(answerFromRecords(ask('höchster jahresniederschlag in salzburg'), old as never)).toBeNull()
  })
})


describe('Superlativ über einen ganzen Zeitraum meint das Mittel', () => {
  // „Wärmstes Jahr" ist 2024 mit 14,3 °C JAHRESMITTEL — nicht 2013, weil an
  // einem Augusttag 40,5 °C gemessen wurden. Nennt die Frage keine Größe,
  // sondern nur einen Superlativ über Jahr/Saison/Monat, ist das Mittel gemeint.
  it('ohne Größenwort das Mittel', () => {
    expect(ask('wärmstes jahr in salzburg').param).toBe('tl_mittel')
    expect(ask('kältester winter in salzburg').param).toBe('tl_mittel')
    expect(ask('wärmster juli in salzburg').param).toBe('tl_mittel')
  })

  it('eine ausdrücklich genannte Größe bleibt stehen', () => {
    // „höchste TEMPERATUR im Juli" fragt nach dem Extremwert, nicht dem Mittel.
    expect(ask('höchste temperatur im juli in salzburg').param).toBe('tlmax')
    expect(ask('höchstes tagesmaximum im juli in salzburg').param).toBe('tlmax')
    expect(ask('tiefste temperatur im winter in salzburg').param).toBe('tlmin')
    expect(ask('nassester sommer in villach').param).toBe('rr')
  })

  it('ohne Zeitraum bleibt es beim Extremwert', () => {
    // „höchste je gemessene temperatur" fragt nach dem absoluten Höchstwert.
    expect(ask('höchste je gemessene temperatur in salzburg').param).toBe('tlmax')
  })
})


describe('Ort statt Einzelstation', () => {
  // Der gemeldete Fehler: „höchste temperatur in wien" antwortete mit der
  // Hohen Warte (39,8 °C), obwohl Wien zwölf Stationen hat und Stammersdorf
  // 41,0 °C misst. Gefragt ist der Ort.
  const WIEN: AtStation[] = [
    st(105, 'Wien Hohe Warte'),
    st(5925, 'Wien Innere Stadt'),
    st(4115, 'Wien Stammersdorf'),
    st(112, 'Wiener Neustadt Flugplatz'),
    st(5855, 'Wiener Neudorf'),
  ]
  const askW = (q: string) => parseQuestion(q, WIEN)

  it('fasst alle Stationen des Ortes zusammen', () => {
    const q = askW('höchste temperatur in wien')
    expect(q.area).toBe('place')
    expect(q.place?.label).toBe('Wien')
    expect(q.place?.ids.sort()).toEqual([105, 4115, 5925])
  })

  it('zieht NICHT „Wiener Neustadt" zu „Wien"', () => {
    // Eigene Orte, nur ähnlich geschrieben. Der Vergleich läuft deshalb über
    // den Namensanfang PLUS Leerzeichen, nicht über einen blossen Präfix.
    const q = askW('höchste temperatur in wien')
    expect(q.place?.ids).not.toContain(112)
    expect(q.place?.ids).not.toContain(5855)
  })

  it('erkennt einen mehrteiligen Ortsnamen als Ort', () => {
    const q = parseQuestion('höchste temperatur in wiener neustadt', [
      st(112, 'Wiener Neustadt Flugplatz'),
      st(7609, 'Wiener Neustadt Stadt'),
      st(105, 'Wien Hohe Warte'),
    ])
    expect(q.area).toBe('place')
    expect(q.place?.label).toBe('Wiener Neustadt')
    expect(q.place?.ids.sort()).toEqual([112, 7609])
  })

  it('bleibt bei einer Station, wenn der Ort nur eine hat', () => {
    expect(parseQuestion('höchste temperatur in obergurgl', STATIONS).area).toBe('station')
  })
})

describe('mergeRecords', () => {
  const mk = (absMax: number, absMin: number) => ({
    abs: { max: { v: absMax, d: '2026-08' }, min: { v: absMin, d: '1940-01' } },
    mon: Array.from({ length: 12 }, (_, i) => ({
      max: { v: absMax - i, y: 2000 + i },
      min: { v: absMin + i, y: 1990 + i },
    })),
    sea: {
      DJF: { max: { v: absMax - 20, y: 2020 }, min: { v: absMin, y: 1929 } },
      MAM: { max: { v: absMax - 10, y: 2018 }, min: { v: absMin + 5, y: 1980 } },
      JJA: { max: { v: absMax, y: 2026 }, min: { v: absMin + 20, y: 1962 } },
      SON: { max: { v: absMax - 8, y: 2011 }, min: { v: absMin + 8, y: 1988 } },
    },
    ann: { max: { v: absMax - 0.5, y: 2026 }, min: { v: absMin + 1, y: 1940 } },
  })
  const entries = [
    { id: 105, name: 'Wien Hohe Warte', rec: mk(39.8, -22.6) },
    { id: 5925, name: 'Wien Innere Stadt', rec: mk(40.4, -19.6) },
    { id: 4115, name: 'Wien Stammersdorf', rec: mk(41, -20.1) },
  ]

  it('nimmt je Richtung den besten Wert und nennt die Station dazu', () => {
    const m = mergeRecords(entries)!
    expect(m.abs.max.v).toBe(41)
    expect(m.abs.max.n).toBe('Wien Stammersdorf')
    expect(m.abs.min.v).toBe(-22.6)
    expect(m.abs.min.n).toBe('Wien Hohe Warte')
  })

  it('führt auch Monats-, Saison- und Jahresebene zusammen', () => {
    const m = mergeRecords(entries)!
    expect(m.mon[0].max.v).toBe(41)
    expect(m.sea.JJA.max.n).toBe('Wien Stammersdorf')
    expect(m.ann?.max.v).toBe(40.5)
  })

  it('übergeht Stationen ohne Rekorde', () => {
    const m = mergeRecords([...entries, { id: 999, name: 'ohne', rec: undefined }])!
    expect(m.abs.max.v).toBe(41)
  })

  it('gibt null, wenn keine Station Rekorde hat', () => {
    expect(mergeRecords([{ id: 1, name: 'x', rec: undefined }])).toBeNull()
  })

  it('macht aus dem Ortsrekord eine Antwort samt Station', () => {
    const q = parseQuestion('höchste temperatur in wien', [
      st(105, 'Wien Hohe Warte'),
      st(5925, 'Wien Innere Stadt'),
      st(4115, 'Wien Stammersdorf'),
    ])
    const a = answerFromRecords(q, mergeRecords(entries)!)
    expect(a?.value).toBe(41)
    expect(a?.where).toBe('Wien Stammersdorf')
    expect(a?.what).toContain('in Wien')
  })
})

// --- Nacht, Grammatik und exaktes Datum ------------------------------------

describe('Nacht als Größenwort', () => {
  // Der gemeldete Fehler: „kälteste Nacht" fand gar kein Größenwort, fiel auf
  // die Vorgabe tlmax zurück und antwortete mit dem tiefsten Tages-MAXIMUM —
  // also dem kältesten TAG statt der kältesten NACHT.
  it('„kälteste Nacht" fragt nach dem Tagesminimum, Richtung min', () => {
    const q = ask('kälteste nacht in salzburg')
    expect(q.param).toBe('tlmin')
    expect(q.extreme).toBe('min')
  })

  // Die Nacht bestimmt die GRÖSSE, nicht die Richtung: die wärmste Nacht ist
  // das HÖCHSTE Tagesminimum (die Tropennacht), dieselbe Messgröße.
  it('„wärmste Nacht" fragt dieselbe Größe in der anderen Richtung', () => {
    const q = ask('wärmste nacht in salzburg')
    expect(q.param).toBe('tlmin')
    expect(q.extreme).toBe('max')
  })

  it('erkennt Tropen- und Frostnacht mit eigener Richtung', () => {
    expect(ask('tropennacht in wien').param).toBe('tlmin')
    expect(ask('tropennacht in wien').extreme).toBe('max')
    expect(ask('frostnacht in wien').extreme).toBe('min')
  })

  // Gegenprobe: der kälteste TAG bleibt eine andere Frage und darf nicht
  // mitverändert werden.
  it('lässt das Tagesmaximum unberührt', () => {
    expect(ask('tiefstes tagesmaximum in salzburg').param).toBe('tlmax')
  })
})

describe('superlativeText', () => {
  // Der zweite gemeldete Fehler: „tiefster Temperatur Maximum" — maskuliner
  // Superlativ vor einem Registry-Bezeichner.
  it('formuliert grammatisch richtig statt Label und Superlativ zu kleben', () => {
    expect(superlativeText('tlmax', 'min', 'Temperatur Maximum')).toBe('tiefstes Tagesmaximum')
    expect(superlativeText('tlmin', 'min', 'Temperatur Minimum')).toBe('tiefstes Tagesminimum')
    expect(superlativeText('tlmin', 'max', 'Temperatur Minimum')).toBe('höchstes Tagesminimum')
  })

  // Jede Größe hat ihr eigenes Genus UND ihren eigenen passenden Superlativ:
  // „längste" Sonnenscheindauer, nicht „höchste"; „meiste" Frosttage.
  it('nimmt je Größe den passenden Superlativ', () => {
    expect(superlativeText('so_h', 'max', '')).toBe('längste Sonnenscheindauer')
    expect(superlativeText('sh', 'max', '')).toBe('größte Schneehöhe')
    expect(superlativeText('tage_frost', 'max', '')).toBe('meiste Frosttage')
    expect(superlativeText('rr', 'min', '')).toBe('geringste Niederschlagssumme')
  })

  it('bleibt bei unbekanntem Code grammatisch richtig', () => {
    expect(superlativeText('gibtsnicht', 'min', 'Irgendwas')).toBe('Tiefstwert von Irgendwas')
  })

  // Die Tabelle muss jeden Code abdecken, den das Parsen erzeugen kann —
  // sonst rutscht still die Ersatzformulierung durch.
  it('deckt alle Parameter ab, die eine Frage ergeben kann', () => {
    const fragen = [
      'höchste temperatur in wien',
      'kälteste nacht in wien',
      'wärmstes jahr in wien',
      'nassester juli in wien',
      'sonnigster sommer in wien',
      'schneereichster winter in wien',
      'meiste frosttage in wien',
      'meiste sommertage in wien',
      'meiste hitzetage in wien',
      'meiste eistage in wien',
      'höchste luftfeuchte in wien',
    ]
    for (const f of fragen) {
      expect(SUPERLATIVE_CODES, `Parameter aus „${f}"`).toContain(ask(f).param)
    }
  })
})

describe('askDayRange', () => {
  const answer = (year: number, recordMonth?: number) =>
    ({ value: 1, unit: '°C', when: null, what: '', year, ...(recordMonth ? { recordMonth } : {}) })

  it('sucht im genannten Monat', () => {
    const q = { ...ask('kälteste nacht im jänner in salzburg'), month: 1 }
    expect(askDayRange(q, answer(1940) as never)).toEqual({
      start: '1940-01-01',
      end: '1940-01-31',
    })
  })

  // Beim absoluten Rekord liefert das Asset den Monat mit — dann wird auch nur
  // dieser durchsucht und nicht die ganze Reihe.
  it('nutzt den Monat des absoluten Rekords', () => {
    const q = ask('kälteste nacht in salzburg')
    expect(askDayRange(q, answer(1940, 2) as never)).toEqual({
      start: '1940-02-01',
      end: '1940-02-29', // 1940 war ein Schaltjahr
    })
  })

  // Winter beginnt im Dezember des VORJAHRS — mit einer anderen Zuordnung
  // findet der Tagesabruf den Rekordwert schlicht nicht.
  it('legt den Winter über die Jahresgrenze', () => {
    const q = { ...ask('kälteste nacht im winter in salzburg'), season: 'DJF' as const, month: null }
    expect(askDayRange(q, answer(1940) as never)).toEqual({
      start: '1939-12-01',
      end: '1940-02-29',
    })
  })

  it('nimmt sonst das ganze Jahr', () => {
    const q = { ...ask('kälteste nacht in salzburg'), month: null, season: null }
    expect(askDayRange(q, answer(1940) as never)).toEqual({
      start: '1940-01-01',
      end: '1940-12-31',
    })
  })

  // Ein langjähriges Mittel hat kein Jahr und damit keinen Tag.
  it('gibt null ohne Jahr', () => {
    const q = ask('durchschnittliche temperatur in salzburg')
    expect(askDayRange(q, { value: 1, unit: '°C', when: null, what: '' } as never)).toBeNull()
  })
})

describe('Nacht als ZEITRAUM', () => {
  it('markiert Nachtfragen, andere nicht', () => {
    expect(ask('kälteste nacht in salzburg').nightly).toBe(true)
    expect(ask('wärmste nacht in salzburg').nightly).toBe(true)
    expect(ask('tropennacht in wien').nightly).toBe(true)
    expect(ask('tiefstes tagesminimum in salzburg').nightly).toBeUndefined()
    expect(ask('höchste temperatur in wien').nightly).toBeUndefined()
  })

  it('antwortet bei einer Nachtfrage auch sprachlich mit der Nacht', () => {
    expect(superlativeText('tlmin', 'min', '', true)).toBe('kälteste Nacht')
    expect(superlativeText('tlmin', 'max', '', true)).toBe('wärmste Nacht')
    // Ohne Nachtbezug bleibt es die Messgröße.
    expect(superlativeText('tlmin', 'min', '')).toBe('tiefstes Tagesminimum')
  })

  // Der Klimatag läuft 19–19 MEZ (18–18 UTC, in verify.ts gemessen). Das
  // Minimum des Klimatags D gehört damit zur Nacht von D−1 auf D — NICHT zur
  // Nacht von D auf D+1. Eine Verwechslung wäre um 24 h daneben.
  it('spannt die Nacht auf den Vortag zurück', () => {
    expect(formatNightSpan('1940-01-12')).toBe('Nacht vom 11. auf den 12. Jänner 1940')
  })

  // Über die Monatsgrenze muss beidseitig ausgeschrieben werden: „Nacht vom
  // 31. auf den 1. Jänner" läse sich als der 31. Jänner.
  it('schreibt über Monatsgrenzen beide Daten voll aus', () => {
    expect(formatNightSpan('1940-01-01')).toBe(
      'Nacht vom 31. Dezember 1939 auf den 1. Jänner 1940',
    )
  })

  // 1940 war ein Schaltjahr — der Vortag des 1. März ist der 29. Februar, nicht
  // der 28. Und weil es über die Monatsgrenze geht, steht er voll da.
  it('kommt mit dem Schalttag zurecht', () => {
    expect(formatNightSpan('1940-03-01')).toBe('Nacht vom 29. Februar 1940 auf den 1. März 1940')
  })

  // Innerhalb eines Monats bleibt die erste Hälfte kurz — sonst stünde das
  // Datum zweimal fast gleich da.
  it('kürzt innerhalb eines Monats die erste Hälfte', () => {
    expect(formatNightSpan('1940-02-29')).toBe('Nacht vom 28. auf den 29. Februar 1940')
  })

  // Die Richtungen sind NICHT symmetrisch, und das ist der inhaltliche Kern:
  // beim höchsten Tagesminimum ist ein am Tag gefallenes Minimum eine untere
  // SCHRANKE (die Nacht war dann noch wärmer) — die Aussage bleibt richtig.
  // Beim tiefsten Tagesminimum kann der Wert dagegen aus dem Tag stammen und
  // gehört dann gar nicht in die Nacht.
  it('formuliert den Vorbehalt nur für die kälteste Nacht', () => {
    expect(nightNote('max')).toContain('untere Schranke')
    expect(nightNote('max')).not.toContain('nicht in die Nacht')
    expect(nightNote('min')).toContain('nicht in die Nacht')
    expect(nightNote('min')).toContain('18–06 UTC')
  })
})

describe('Gegenrichtung einer Extremgröße', () => {
  const spec = (code: string) => getAtParameter(code)

  // Der gemeldete Fehler: „wärmste Nacht in Salzburg" antwortete mit 13,4 °C
  // (August 2024) — dem höchsten MONATS-Tiefstwert, also dem August, dessen
  // kälteste Nacht die wärmste war. Salzburg hat längst Tropennächte > 20 °C.
  it('erkennt, welche Richtung ein echtes Tagesextrem ist', () => {
    expect(directionDerivable(spec('tlmin'), 'min')).toBe(true) // kälteste Nacht ✓
    expect(directionDerivable(spec('tlmin'), 'max')).toBe(false) // wärmste Nacht ✗
    expect(directionDerivable(spec('tlmax'), 'max')).toBe(true) // heißester Tag ✓
    expect(directionDerivable(spec('tlmax'), 'min')).toBe(false) // kältester Tag ✗
  })

  // Bei Summen, Mitteln und Kenntagen sind BEIDE Richtungen echte Monatswerte —
  // der nasseste und der trockenste Monat sind gleichermaßen sinnvoll.
  it('lässt Summen, Mittel und Kenntage in beiden Richtungen zu', () => {
    for (const code of ['rr', 'so_h', 'tl_mittel', 'tage_frost']) {
      expect(directionDerivable(spec(code), 'max'), code).toBe(true)
      expect(directionDerivable(spec(code), 'min'), code).toBe(true)
    }
  })

  // Lieber keine Zahl als eine, die etwas anderes meint.
  it('gibt in der Gegenrichtung KEINE Antwort statt einer falschen', () => {
    const rec = {
      abs: { max: { v: 13.4, d: '2024-08' }, min: { v: -30.6, d: '1956-02' } },
      ann: { max: { v: -6.8, y: 1916 }, min: { v: -30.6, y: 1956 } },
      mon: [],
      sea: [],
    }
    const warm = { ...ask('wärmste nacht in salzburg'), area: 'station' as const }
    expect(answerFromRecords(warm, rec as never)).toBeNull()
    // Die richtige Richtung antwortet weiter.
    const kalt = { ...ask('kälteste nacht in salzburg'), area: 'station' as const }
    expect(answerFromRecords(kalt, rec as never)?.value).toBe(-30.6)
  })

  it('erklärt im Klartext, warum es keine Zahl gibt', () => {
    const note = directionNote(spec('tlmin'), 'max', true)
    expect(note).toContain('wärmste Nacht')
    expect(note).toContain('Monatsarchiv')
    expect(note).toContain('Tagesreihe')
  })
})
