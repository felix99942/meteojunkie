import { describe, expect, it } from 'vitest'
import { extremes, rankAll, searchRanked, summarize, type RankStation } from './atRank'

describe('rankAll', () => {
  it('reiht absteigend und vergibt Ränge ab 1', () => {
    expect(rankAll([5, 1, 9, 3])).toEqual([
      { idx: 2, value: 9, rank: 1 },
      { idx: 0, value: 5, rank: 2 },
      { idx: 3, value: 3, rank: 3 },
      { idx: 1, value: 1, rank: 4 },
    ])
  })

  it('überspringt fehlende und ungültige Werte', () => {
    expect(rankAll([null, 4, Number.NaN, 2]).map((e) => e.idx)).toEqual([1, 3])
  })

  it('reiht auch negative Werte (Anomalien)', () => {
    expect(rankAll([-2.5, 1.5, -0.5]).map((e) => e.value)).toEqual([1.5, -0.5, -2.5])
  })

  it('kommt mit leerer Auswahl zurecht', () => {
    expect(rankAll([])).toEqual([])
    expect(rankAll([null, null])).toEqual([])
  })
})

describe('extremes', () => {
  it('liefert oberes Ende absteigend, unteres aufsteigend', () => {
    const { top, bottom } = extremes(rankAll([5, 1, 9, 3]), 2)
    expect(top.map((e) => e.value)).toEqual([9, 5])
    expect(bottom.map((e) => e.value)).toEqual([1, 3])
  })

  it('lässt die Enden nicht überlappen', () => {
    const { top, bottom } = extremes(rankAll([1, 2, 3]), 2)
    expect(top.map((e) => e.value)).toEqual([3, 2])
    expect(bottom.map((e) => e.value)).toEqual([1])
    expect(top.filter((t) => bottom.some((b) => b.idx === t.idx))).toEqual([])
  })

  it('lässt das untere Ende leer, wenn schon alles oben steht', () => {
    const { top, bottom } = extremes(rankAll([7, 8]), 5)
    expect(top.map((e) => e.value)).toEqual([8, 7])
    expect(bottom).toEqual([])
  })
})

describe('summarize', () => {
  it('rechnet Kennzahlen bei ungerader Anzahl', () => {
    expect(summarize(rankAll([1, 5, 3]))).toEqual({ n: 3, min: 1, max: 5, mean: 3, median: 3 })
  })

  it('mittelt den Median bei gerader Anzahl', () => {
    expect(summarize(rankAll([1, 2, 3, 4]))).toEqual({ n: 4, min: 1, max: 4, mean: 2.5, median: 2.5 })
  })

  it('liefert null ohne Werte', () => {
    expect(summarize([])).toBeNull()
  })
})

describe('searchRanked', () => {
  // Rang: Sonnblick 1, Wien 2, Graz 3, Bregenz 4 — Innsbruck ohne Wert
  const stations: RankStation[] = [
    { name: 'Wien Hohe Warte', state: 'Wien' },
    { name: 'Graz Universität', state: 'Steiermark' },
    { name: 'Innsbruck Flughafen', state: 'Tirol' },
    { name: 'Sonnblick', state: 'Salzburg' },
    { name: 'Bregenz', state: 'Vorarlberg' },
  ]
  const values = [20, 18, null, 25, 15]
  const ranked = rankAll(values)

  it('findet eine Station auch weit außerhalb der Extreme', () => {
    // Genau der Fall, für den die Suche da ist: Graz steht weder oben noch
    // unten in einer Zehnerliste, muss aber auffindbar sein
    const r = searchRanked(stations, ranked, 'graz')
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].idx).toBe(1)
    expect(r.hits[0].value).toBe(18)
  })

  it('behält den GLOBALEN Rang im Treffer', () => {
    const r = searchRanked(stations, ranked, 'bregenz')
    expect(r.hits[0].rank).toBe(4) // nicht 1, obwohl es der einzige Treffer ist
  })

  it('sucht auch im Bundesland und liefert Rangreihenfolge', () => {
    const r = searchRanked(stations, ranked, 'Steiermark')
    expect(r.hits.map((e) => e.idx)).toEqual([1])
  })

  it('meldet Treffer OHNE Wert getrennt statt sie zu verschlucken', () => {
    // „gibt es nicht" und „hat hier keinen Wert" sind verschiedene Aussagen
    const r = searchRanked(stations, ranked, 'innsbruck')
    expect(r.hits).toHaveLength(0)
    expect(r.withoutValue).toEqual([2])
  })

  it('gibt ohne Suchbegriff die unveränderte Reihung zurück', () => {
    const r = searchRanked(stations, ranked, '   ')
    expect(r.hits).toBe(ranked)
    expect(r.withoutValue).toEqual([])
  })

  it('ignoriert Groß-/Kleinschreibung und Teilwörter', () => {
    expect(searchRanked(stations, ranked, 'HOHE').hits[0].idx).toBe(0)
  })
})
