// Die Aufbereitung der Build-Kennung. Die WERTE kommen aus vite.config.ts und
// sind hier nicht prüfbar — die Formatierung schon, und sie darf bei einem
// kaputten Datum nicht „Invalid Date" in die Oberfläche schreiben.

import { describe, expect, it } from 'vitest'
import { buildLabel, buildTitle, type BuildInfo } from './build'

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  commit: '4a5b4ea',
  date: '2026-09-16T23:05:53+02:00',
  dirty: false,
  ...over,
})

describe('buildLabel', () => {
  it('nennt Commit und Datum', () => {
    expect(buildLabel(info())).toBe('4a5b4ea · 16.09.2026')
  })

  // Der Marker muss auffallen: ein solcher Build gehört zu keinem Commit und
  // ist gegen `git log` nicht prüfbar.
  it('markiert einen Build aus geändertem Baum mit +', () => {
    expect(buildLabel(info({ dirty: true }))).toBe('4a5b4ea+ · 16.09.2026')
  })

  // Tarball ohne .git: lieber „unbekannt" als eine erfundene Nummer.
  it('kommt ohne Git-Angaben klar', () => {
    expect(buildLabel(info({ commit: 'unbekannt', date: 'kaputt' }))).toBe('unbekannt · —')
  })
})

describe('buildTitle', () => {
  it('nennt Commit und Zeitpunkt', () => {
    const t = buildTitle(info())
    expect(t).toContain('4a5b4ea')
    expect(t).toContain('UTC')
  })

  it('erklärt das + nur, wenn es gesetzt ist', () => {
    expect(buildTitle(info({ dirty: true }))).toContain('geänderten Arbeitsbaum')
    expect(buildTitle(info())).not.toContain('geänderten Arbeitsbaum')
  })
})
