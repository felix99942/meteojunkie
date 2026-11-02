// Zeitbeschriftung der Modellkarten — Einzelkarte und Panel-Ansicht teilen sie.

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const pad = (n: number) => String(n).padStart(2, '0')

/** „Mo 05.10. 12 UTC" — von Hand statt über Intl: de-DE schreibt eine reine Stunde als „12 Uhr". */
export function validLabel(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCHours())} UTC`
}

export function runLabel(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}. ${pad(d.getUTCHours())} UTC`
}
