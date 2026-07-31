// Parsing der Ensemble-Antwort — eigenes Modul, damit der Rechenkern ohne
// Browser-Umgebung testbar bleibt (openmeteo.ts zieht über mock.ts
// window.location herein).
//
// Antwortform (live geprüft gegen ensemble-api.open-meteo.com):
//   hourly.time                      Zeitstempel (unixtime, Sekunden)
//   hourly.<var>                     KONTROLLLAUF (ohne Suffix)
//   hourly.<var>_member01 … _member50  die gestörten Mitglieder
// Bei genau einem angefragten Modell gibt es KEIN Modell-Suffix — deshalb
// fragt der Fetch-Layer immer nur ein Ensemble je Request ab.

export interface EnsembleBody {
  hourly: Record<string, (number | null)[] | number[]>
  hourly_units?: Record<string, string>
}

export interface ParsedEnsemble {
  /** Zeitstempel Epoch-ms (UTC). */
  times: number[]
  /** [member][t]; Index 0 = Kontrolllauf, danach member01, member02, … */
  members: (number | null)[][]
  unit: string
}

export function parseEnsembleBody(body: EnsembleBody, variable: string): ParsedEnsemble {
  const rawTimes = (body.hourly?.time as number[] | undefined) ?? []
  const times = rawTimes.map((t) => t * 1000)

  const members: (number | null)[][] = []
  const control = body.hourly?.[variable] as (number | null)[] | undefined
  if (control) members.push(control)

  // Nach Mitgliedsnummer sortieren, nicht nach Objekt-Reihenfolge: JSON-Keys
  // sind zwar meist in Einfügereihenfolge, aber darauf zu bauen wäre eine
  // stille Annahme über fremdes Serialisierungsverhalten.
  const prefix = `${variable}_member`
  const memberKeys = Object.keys(body.hourly ?? {})
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
  for (const k of memberKeys) members.push(body.hourly[k] as (number | null)[])

  return { times, members, unit: body.hourly_units?.[variable] ?? '' }
}
