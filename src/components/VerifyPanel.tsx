// Verifikation: was WURDE vorhergesagt, und was ist eingetroffen.
//
// Der einzige Bereich, der beide Welten der Seite zusammenbringt — die
// Modellläufe von Open-Meteo und die GEMESSENEN Stationswerte von GeoSphere —
// und der einzige, der rückwärts schaut. Verglichen wird das Tagesmaximum bzw.
// -minimum: es ist die Größe, die der Klimatagesdatensatz direkt führt, also
// braucht es auf der Messseite keine Näherung.
//
// LEITIDEE: Tag für Tag, nicht Modellranking. Die naheliegende Darstellung
// wäre eine Matrix Modell × Vorlauf mit Fehlermaßen — die braucht aber lange
// Zeiträume, um überhaupt etwas zu sagen (über 14 Tage sank der IFS-Fehler mit
// LÄNGEREM Vorlauf, reines Rauschen; erst über 90 Tage wächst er monoton).
// Wer wissen will „wie gut war die Vorhersage diese Woche", bekommt deshalb
// die konkreten Tage nebeneinander: gemessen, vorhergesagt, Differenz. Die
// Fehlermaße stehen als eine Zeile darunter, mit Warnung bei kurzer Reihe.
//
// Kein eigenes Archiv nötig: die Historical-Forecast-API liefert zu einem
// vergangenen Zeitpunkt über `_previous_dayN` das, was N Tage FRÜHER für
// diesen Zeitpunkt vorhergesagt worden war (siehe fetchPastRuns). Alles andere
// hieße, jede Modellausgabe selbst wegzuschreiben und für immer zu halten.
//
// Der Tag ist der KLIMATAG 18–18 UTC (19–19 MEZ) auf BEIDEN Seiten — so
// definiert GeoSphere seine Tagesextreme, und die Vorhersagereihe wird über
// dasselbe Fenster reduziert (siehe verify.ts, dort ist es gemessen). Mit
// 00–24 UTC auf der Vorhersageseite stand nach jedem heißen Tag mit
// Frontdurchgang ein „Fehler" in der Tabelle, den kein Modell gemacht hat.

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPastRuns, MAX_LEAD_DAYS, type PastRunSeries } from '../api/openmeteo'
import { activeStations, DATASET_DAILY, fetchStationSeries, loadStations, type AtStation } from '../api/geosphere'
import { clean } from '../api/atValues'
import { getAtParameter } from '../config/atParameters'
import {
  groupModelsByScale,
  isInCoverage,
  MODELS,
  resolutionLabel,
  SCALE_HINTS,
  SCALE_LABELS,
  SELECTABLE_MODELS,
  type ModelInfo,
} from '../config/models'
import { OpenMeteoAttribution } from './Attribution'
import {
  climatologyForecast,
  contingency,
  dailyValues,
  dayRange,
  ets,
  events,
  EXTREME_DAY_OFFSET_H,
  far,
  distinguishable,
  frequencyBias,
  leadsFor,
  PAIRED_Z,
  pairedMae,
  persistenceForecast,
  pod,
  PRECIP_DAY_OFFSET_H,
  score,
  skillScore,
  type Contingency,
  type DailyMode,
  type Paired,
  type Scores,
  type Skill,
} from './verify'

/**
 * Voreingestellte Modelle: je ein Vertreter der interessanten Klassen, dazu
 * „Best Match" — Open-Meteos eigene Mischung ist der natürliche Bezug, gegen
 * den sich die Einzelmodelle behaupten müssen. (Am Testpunkt lag sie NICHT
 * vorn: über 20 Tage 1,33 K gegen 1,16 K von GFS.)
 */
const DEFAULT_MODELS = [
  'best_match',
  'ecmwf_ifs025',
  'icon_eu',
  'gfs_seamless',
  'geosphere_arome_austria',
]
/** Voreingestellte Station: lange Reihe, zentral, jedem ein Begriff. */
const DEFAULT_STATION = 105 // Wien Hohe Warte

/**
 * Drei Zeiträume, aufsteigend vergleichbar. 5 Tage beantworten „wie lief es
 * diese Woche", 20 Tage lassen die Modelle grob gegeneinander antreten.
 *
 * Nach oben bewusst gedeckelt: ein belastbarer Modellvergleich bräuchte
 * Monate. Live gemessen — über 14 Tage SANK der IFS-Fehler mit LÄNGEREM
 * Vorlauf (2,01 K bei +1 d, 1,84 K bei +5 d), reines Rauschen; erst über 90
 * Tage wächst er bei jedem Modell monoton. 20 Tage sind also ein Kompromiss
 * und kein Urteil, und die Fehlerzeile sagt das je nach Länge auch.
 */
const SPANS: { days: number; label: string; hint: string }[] = [
  { days: 5, label: '5 Tage', hint: 'Blick auf die vergangenen Tage — zu kurz für einen Modellvergleich' },
  { days: 10, label: '10 Tage', hint: 'erste Tendenz, welches Modell hier näher liegt — noch stark vom Zufall geprägt' },
  { days: 20, label: '20 Tage', hint: 'grober Modellvergleich; belastbar würde er erst über Monate' },
  {
    days: 60,
    label: '60 Tage',
    hint:
      'für die kategorische Bewertung des Niederschlags — erst hier kommen genug Regentage ' +
      'zusammen, dass ETS und Trefferquote etwas heißen (rund 25 statt 8)',
  },
  // Die langen Zeiträume sind die Voraussetzung dafür, dass die Rangliste
  // überhaupt Modelle TRENNEN kann: bei 20 Tagen liegt der gepaarte
  // Unterschied zweier Globalmodelle regelmäßig innerhalb der Unsicherheit.
  // Kosten: ein Request je Modell für ALLE Vorlaufzeiten, danach für immer im
  // IndexedDB-Cache — ein einmal geholter größerer Zeitraum wird beim
  // Zurückschalten zugeschnitten (`sliceRuns`), kostet also nichts mehr.
  {
    days: 90,
    label: '90 Tage',
    hint:
      'ab hier wächst der Fehler bei jedem Modell monoton mit dem Vorlauf (gemessen) — die ' +
      'erste Länge, bei der die Rangliste mehr als eine Momentaufnahme ist',
  },
  {
    days: 180,
    label: '180 Tage',
    hint:
      'halbes Jahr: genug, dass gepaarte Unterschiede zwischen ähnlichen Modellen aus der ' +
      'Unsicherheit herauskommen — und die Grundlage für einen Vergleich nach Wetterlagen',
  },
]
/** Ab hier taugt die Fehlerzeile wenigstens als grobe Reihung. */
const ROUGH_DAYS = 10
/**
 * So viele eingetretene Ereignisse braucht die kategorische Bewertung
 * mindestens, bevor sie überhaupt angezeigt wird.
 *
 * Zehn ist keine statistische Schranke, sondern eine Anstandsgrenze: bei drei
 * Regentagen springt der ETS zwischen 0 und 1, je nachdem wie EIN Tag ausgeht,
 * und eine Zahl, die so wackelt, sollte gar nicht erst dastehen. Bei 20 Tagen
 * kommen im österreichischen Sommer rund 8 Regentage zusammen, bei 60 rund 25
 * (gemessen an 5 Stationen über 60 Tage: 126 nasse von 300 Stationstagen).
 */
const MIN_EVENTS = 10

/** Fehlerstufen der Temperatur, in Kelvin. */
const TEMP_ERR_STEPS = [0.7, 1.2, 1.8, 2.6, 3.6]

/**
 * Was verglichen wird: Messgröße ↔ Vorhersagevariable ↔ Tagesreduktion ↔
 * TAGESFENSTER.
 *
 * Das Fenster gehört zwingend hierher und nicht in eine Konstante daneben:
 * Extremwerte und Niederschlag haben bei GeoSphere VERSCHIEDENE Tagesbegriffe,
 * und zwar in verschiedene Richtungen (18–18 UTC rückwärts gegen 06–06 UTC
 * vorwärts, beides gemessen — siehe verify.ts). Eine gemeinsame Konstante
 * wäre für eine der beiden Größen still falsch.
 *
 * `unit` ist die Einheit des Werts, `errUnit` die der Differenz: bei der
 * Temperatur ist eine Differenz von 2 °C eine von 2 K, und das gehört auch so
 * beschriftet.
 */
interface Target {
  label: string
  obsCode: string
  mode: DailyMode
  offsetH: number
  windowLabel: string
  unit: string
  errUnit: string
  /** Schwellen für die kategorische Bewertung; leer = keine (stetige Größe). */
  thresholds: number[]
  /**
   * Stufen der Zelleinfärbung, in der Einheit der GRÖSSE. Sie müssen mitwandern:
   * 2,6 K sind ein grober Fehlgriff, 2,6 mm Tagesniederschlag sind Alltag —
   * mit einer gemeinsamen Skala stünde die halbe Niederschlagstabelle rot da.
   */
  errSteps: number[]
}

const TARGETS: Record<string, Target> = {
  tlmax: {
    label: 'Tageshöchsttemperatur',
    obsCode: 'tlmax',
    mode: 'max',
    offsetH: EXTREME_DAY_OFFSET_H,
    windowLabel: '18–18 UTC',
    unit: '°C',
    errUnit: 'K',
    thresholds: [],
    errSteps: TEMP_ERR_STEPS,
  },
  tlmin: {
    label: 'Tagestiefsttemperatur',
    obsCode: 'tlmin',
    mode: 'min',
    offsetH: EXTREME_DAY_OFFSET_H,
    windowLabel: '18–18 UTC',
    unit: '°C',
    errUnit: 'K',
    thresholds: [],
    errSteps: TEMP_ERR_STEPS,
  },
  rr: {
    label: 'Niederschlagssumme',
    obsCode: 'rr',
    mode: 'sum',
    offsetH: PRECIP_DAY_OFFSET_H,
    windowLabel: '06–06 UTC',
    unit: 'mm',
    errUnit: 'mm',
    // Die vier üblichen Stufen der Niederschlagsverifikation: „hat es
    // überhaupt geregnet" (0,1), der Niederschlagstag der Klimatologie (1,0),
    // ergiebiger Regen (5) und die Warnschwelle (10). Voreingestellt ist
    // 1,0 mm — dieselbe Schwelle, mit der die Kenntage in der Klimakarte
    // rechnen, und die einzige, die auch bei 20 Tagen genug Fälle hat.
    thresholds: [0.1, 1, 5, 10],
    // Ein Tagesniederschlag streut ganz anders als eine Temperatur: 1 mm
    // daneben ist gut, 10 mm daneben ist ein verpasstes Ereignis.
    errSteps: [0.5, 1, 2, 5, 10],
  },
}
type TargetId = keyof typeof TARGETS

/** Vorhersagevariable je Zielgröße. */
const FORECAST_VAR: Record<string, string> = {
  tlmax: 'temperature_2m',
  tlmin: 'temperature_2m',
  rr: 'precipitation',
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const dayOffset = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}
const fmt1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '—')
const fmt2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '—')
const fmtSigned = (v: number) =>
  Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1).replace('.', ',')}` : '—'
/** Skill Score und ETS: zwei Nachkommastellen, Vorzeichen zeigen. */
const fmtScore = (v: number) =>
  Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2).replace('.', ',')}` : '—'
/** Anteil als Prozentzahl — Trefferquote und Fehlalarmanteil lesen sich so. */
const fmtPct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '—')
/** Schwelle in der Beschriftung: „1 mm", nicht „1,0 mm"; aber „0,1 mm". */
const fmtThreshold = (v: number) => `${v.toString().replace('.', ',')} mm`

const fmtDayLabel = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
/**
 * „Mi, 27.08.2026" — Wochentag dazu, weil man Wetter in Wochentagen erinnert;
 * das Jahr dazu, weil eine Tabelle ohne Jahresangabe nicht sagt, WANN gemessen
 * wurde.
 */
const fmtDay = (day: string) => fmtDayLabel.format(new Date(`${day}T12:00:00Z`))
/** Kurzform für Achsenticks und Fließtext. */
const fmtShort = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
})

/**
 * Beschriftung einer Vorlaufzeit.
 *
 * `previous_dayN` ist der Stand, den die Vorhersage `n·24` Stunden VOR dem
 * jeweiligen Zeitpunkt hatte — ein GLEITENDER Vorlauf, kein fester Lauf.
 * Zweimal live gemessen: die Reihe macht an der Tagesgrenze keinen Sprung
 * (Stundenänderung über 00 UTC 0,69 K gegenüber 0,92 K sonst — genau wie die
 * durchgehende Reihe), und der Fehler ist über den Tagesverlauf flach
 * (0,82/0,83/0,81/0,90 K je Sechs-Stunden-Block). Bei einem festen 00-UTC-Lauf
 * müsste beides anders aussehen: ein Sprung um Mitternacht und ein Fehler, der
 * über den Tag wächst.
 *
 * Aus welchem konkreten Lauf (00/06/12/18 UTC) der Stand jeweils stammt, gibt
 * die API nicht preis; dafür bräuchte es die Single-Runs-API.
 */
const leadLabel = (n: number) => `Stand ${n * 24} h vorher`
const leadDays = (n: number) => (n === 1 ? '1 Tag' : `${n} Tage`)

/** Fünf Stufen von ruhig nach warnend, dazu die Farbe jenseits der letzten. */
const ERR_COLORS = ['#1d4b3a', '#37613a', '#6b6033', '#7c4a24', '#7a3020']
const ERR_COLOR_OVER = '#5c1f1a'

/**
 * Einfärbung nach Fehlerbetrag: klein = ruhig, groß = warnend. Die Stufen
 * kommen aus der Zielgröße — sie sind in deren Einheit angegeben und dürfen
 * nicht geteilt werden (siehe `Target.errSteps`).
 */
function errColor(err: number, steps: number[]): string {
  if (!Number.isFinite(err)) return 'transparent'
  for (let i = 0; i < steps.length; i++) if (err < steps[i]) return ERR_COLORS[i]
  return ERR_COLOR_OVER
}

interface RankRow {
  model: ModelInfo
  scores: Scores
  skill: Skill
  climSkill: Skill
  /** Gepaarter Unterschied zum besten Modell; null beim Besten selbst. */
  paired: Paired | null
  /** Unterschied zum Besten größer als zwei Standardfehler? */
  distinct: boolean
}

/**
 * RANGLISTE über den ganzen Zeitraum — der „auf einen Blick"-Teil, über der
 * Tag-für-Tag-Tabelle.
 *
 * Bewusst KEINE Rangliste nach MAE allein. Der mittlere Fehler sagt, wie weit
 * ein Modell daneben lag, aber nicht, ob der Unterschied zum Nachbarn etwas
 * bedeutet und woran er liegt. Fünf Spalten beantworten drei verschiedene
 * Fragen:
 *
 *   MAE, Bias          wie groß, und systematisch oder streuend
 *   σf/σo, r           WORAN es liegt: gedämpfte Amplitude ↔ falscher Verlauf
 *   Skill Pers./Klim.  war die Aufgabe leicht oder schwer
 *   Δ zum Besten       ist die Reihenfolge überhaupt belastbar
 *
 * Die letzte Spalte ist die wichtigste und der Grund, warum es diesen Block
 * gibt: über 14 Tage SANK der IFS-Fehler mit längerem Vorlauf (gemessen,
 * reines Rauschen). Eine Reihung ohne Unsicherheit hätte das als Befund
 * ausgewiesen. Liegt der gepaarte Unterschied innerhalb von zwei
 * Standardfehlern, steht „~" statt eines Vorsprungs und die Rangfolge
 * dahinter ist Zufall.
 */
function RankingBlock({
  rows,
  spec,
  lead,
  leadIsClear,
}: {
  rows: RankRow[]
  spec: Target
  lead: number
  leadIsClear: boolean
}) {
  if (rows.length === 0) return null
  const unit = spec.unit
  return (
    <div className="verify-rank">
      <div className="verify-rank-head">
        <strong>Rangliste bei {leadLabel(lead)}</strong>
        <span className="label-muted">
          {rows[0].scores.n} Tage · gereiht nach mittlerem Fehler
        </span>
        {/* Ob die Führung belastbar ist, gehört in die Kopfzeile — nicht in
            eine Fußnote, die niemand liest. */}
        <span className={leadIsClear ? 'verify-rank-clear' : 'verify-rank-tie'}>
          {leadIsClear
            ? `${rows[0].model.label} führt mit belastbarem Abstand`
            : 'Spitze nicht unterscheidbar — die Reihenfolge oben ist Zufall'}
        </span>
      </div>
      <table className="verify-table verify-rank-table">
        <thead>
          <tr>
            <th>Modell</th>
            <th title="Mittlerer absoluter Fehler über den ganzen Zeitraum.">MAE</th>
            <th
              title={
                'Mittlerer Fehler MIT Vorzeichen. Derselbe MAE bedeutet bei großem Bias etwas ' +
                'anderes (systematisch, nachträglich korrigierbar) als bei Bias nahe null ' +
                '(streut nur). Darin steckt auch der Unterschied zwischen Modellgitterzelle und ' +
                'Messplatz.'
              }
            >
              Bias
            </th>
            <th
              title={
                'Amplitude: σ(Vorhersage) / σ(Messung). Unter 1 heißt, das Modell schwankt ' +
                'weniger als die Wirklichkeit — es dämpft den Tagesgang. Genau das ist der ' +
                'AIFS-Befund dieser Seite (Tagesgang auf zwei Drittel gestaucht); hier fällt es ' +
                'bei jedem Modell und jeder Station von selbst auf. Über 1 = übertriebene ' +
                'Schwankung.'
              }
            >
              σf/σo
            </th>
            <th
              title={
                'Korrelation Vorhersage ↔ Messung. Trennt „richtiger Verlauf, falsches Niveau" ' +
                '(hohe Korrelation bei großem Bias — korrigierbar) von „falscher Verlauf" ' +
                '(niedrige Korrelation — das eigentliche Modellversagen).'
              }
            >
              r
            </th>
            <th
              title={
                'Skill gegen PERSISTENZ („morgen wie heute"): 1 = perfekt, 0 = wie Persistenz, ' +
                'negativ = schlechter als nichts tun. Sagt, wie schwer die Aufgabe war. GRENZE: ' +
                'bei langem Vorlauf ist Persistenz trivial zu schlagen, ein hoher Wert heißt ' +
                'dort nur „besser als raten".'
              }
            >
              SS Pers.
            </th>
            <th
              title={
                'Skill gegen KLIMATOLOGIE („jeden Tag der Durchschnitt", leave-one-out aus dem ' +
                'gezeigten Zeitraum): die härtere und bei langem Vorlauf die aussagekräftigere ' +
                'Referenz — dort, wo der Persistenz-Score sättigt. Unter 0 heißt: das Modell ' +
                'trägt weniger bei als der Mittelwert der Periode.'
              }
            >
              SS Klim.
            </th>
            <th
              title={
                'GEPAARTER Unterschied zum besten Modell: Mittel der täglichen ' +
                'Fehlerdifferenzen ± Standardfehler. Alle Modelle werden an denselben Tagen ' +
                'geprüft, also kürzt sich heraus, was allen gemeinsam schwerfiel — das macht ' +
                'den Vergleich trennscharf. Der Standardfehler ist für Autokorrelation ' +
                'korrigiert (Wetter hält an, aufeinander folgende Tagesfehler sind nicht ' +
                'unabhängig). „~" = innerhalb von zwei Standardfehlern, also nicht ' +
                'unterscheidbar.'
              }
            >
              Δ zum Besten
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.model.id} className={i === 0 ? 'is-best' : undefined}>
              <td className="verify-rank-model" title={r.model.label}>
                {r.model.label}
                <span className="label-muted"> {resolutionLabel(r.model)}</span>
              </td>
              <td>
                {fmt1(r.scores.mae)} {unit}
              </td>
              <td>
                {fmtSigned(r.scores.bias)} {unit}
              </td>
              {/* Auffällig markieren, wo die Amplitude deutlich daneben liegt —
                  das ist der Befund, nicht die Zahl. */}
              <td
                className={
                  Number.isFinite(r.scores.sdRatio) &&
                  (r.scores.sdRatio < 0.85 || r.scores.sdRatio > 1.15)
                    ? 'verify-flag'
                    : undefined
                }
              >
                {fmt2(r.scores.sdRatio)}
              </td>
              <td>{fmt2(r.scores.corr)}</td>
              <td>{fmtScore(r.skill.ss)}</td>
              <td>{fmtScore(r.climSkill.ss)}</td>
              <td>
                {r.paired == null ? (
                  <span className="label-muted">Referenz</span>
                ) : r.distinct ? (
                  // Vorzeichen zeigen statt „+" anzunehmen: die Reihung nutzt
                  // den MAE über ALLE Tage, der gepaarte Vergleich nur die
                  // GEMEINSAMEN — bei ungleicher Abdeckung kann die Differenz
                  // der Reihenfolge widersprechen, und dann ist das die
                  // interessante Information, nicht ein Darstellungsfehler.
                  <>
                    {fmtSigned(r.paired.diff)} ± {fmt1(PAIRED_Z * r.paired.se)} {unit}
                  </>
                ) : (
                  <span
                    className="label-muted"
                    title={`Unterschied ${fmt1(Math.abs(r.paired.diff))} ${unit} bei ± ${fmt1(
                      PAIRED_Z * r.paired.se,
                    )} ${unit} Unsicherheit (${Math.round(r.paired.nEff)} von ${
                      r.paired.n
                    } Tagen effektiv unabhängig)`}
                  >
                    ~ nicht unterscheidbar
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * KATEGORISCHE BEWERTUNG — die eigentliche Antwort auf „was taugt die
 * Niederschlagsvorhersage".
 *
 * Der mittlere Fehler in mm ist dort fast wertlos: an fünf österreichischen
 * Stationen über 60 Tage waren 174 von 300 Tagen trocken (gemessen). Ein
 * Modell, das NIE Regen ansagt, bekommt damit einen glänzenden MAE — es hat
 * nur nichts geleistet. Dazu die doppelte Bestrafung: ein Schauer zwölf
 * Stunden zu früh zählt einmal als verpasst und einmal als Fehlalarm, obwohl
 * die Lage im Kern getroffen war.
 *
 * Gefragt ist deshalb nicht „wie viele mm daneben", sondern „hat es Regen
 * angesagt, und kam welcher". Die Vierfeldertafel beantwortet genau das, und
 * die vier Kennzahlen darunter sind die Standardwährung der
 * Niederschlagsverifikation.
 *
 * Die ZÄHLUNGEN stehen bewusst mit in der Tabelle und nicht nur im Tooltip:
 * ein ETS von 0,6 aus vier Regentagen ist eine andere Aussage als einer aus
 * vierzig, und ohne die Zahl daneben sehen beide gleich aus.
 */
function CategoricalBlock({
  table,
  lead,
  threshold,
  span,
}: {
  table: { model: ModelInfo; cells: Map<number, { cont: Contingency }> }[]
  lead: number
  threshold: number
  span: number
}) {
  const rows = table
    .map((r) => ({ model: r.model, cont: r.cells.get(lead)?.cont }))
    .filter((r): r is { model: ModelInfo; cont: Contingency } => r.cont != null && r.cont.n > 0)
  if (rows.length === 0) return null

  const nEvents = Math.max(...rows.map((r) => events(r.cont)))
  const thin = nEvents < MIN_EVENTS
  // Bestes Modell nach ETS — dieselbe Regel wie oben: über den ZEITRAUM, nicht
  // je Tag.
  const scores = rows.map((r) => ets(r.cont)).filter(Number.isFinite)
  const bestEts = scores.length ? Math.max(...scores) : null

  return (
    <div className="verify-cat">
      <div className="verify-cat-head">
        <strong>Kategorisch: Regentag ab ≥ {fmtThreshold(threshold)}</strong>
        <span className="label-muted">
          {nEvents} {nEvents === 1 ? 'Regentag' : 'Regentage'} gemessen
        </span>
        {thin && (
          <span
            className="atclima-hint"
            title={
              `Unter ${MIN_EVENTS} eingetretenen Ereignissen sind diese Kennzahlen nicht ` +
              'lesbar: der ETS springt dann zwischen 0 und 1, je nachdem wie EIN Tag ausgeht. ' +
              (span < 60
                ? 'Auf 60 Tage stellen — im österreichischen Sommer kommen dort rund 25 ' +
                  'Regentage zusammen.'
                : 'Auch 60 Tage reichen bei dieser Schwelle nicht; eine niedrigere wählen.')
            }
          >
            ⚠ zu wenige Ereignisse
          </span>
        )}
      </div>
      <table className="verify-table verify-cat-table">
        <thead>
          <tr>
            <th>Modell</th>
            <th title="Regen angesagt UND eingetreten.">Treffer</th>
            <th title="Regen eingetreten, aber nicht angesagt.">verpasst</th>
            <th title="Regen angesagt, aber ausgeblieben.">Fehlalarm</th>
            <th title={'Anteil der eingetretenen Regentage, die angesagt waren (POD). Allein wertlos — „immer Regen" ergibt ebenfalls 100 %; nur zusammen mit dem Fehlalarmanteil zu lesen.'}>
              Trefferquote
            </th>
            <th title="Anteil der ANGESAGTEN Regentage, an denen nichts kam (FAR). 0 % ist perfekt. Das Gegengewicht zur Trefferquote.">
              Fehlalarm­anteil
            </th>
            <th title="Wie oft das Modell Regen ansagt, geteilt durch wie oft er eintritt. Über 1 = zu nass, unter 1 = zu trocken. Sagt nichts über die Trefferlage: ein Modell kann die richtige ZAHL Regentage treffen und dabei jeden einzelnen am falschen Tag.">
              Häufigkeit
            </th>
            <th title={'Equitable Threat Score (Gilbert). Anteil richtig getroffener Regentage, ABZÜGLICH der Treffer, die bei gleicher Ansagehäufigkeit schon durch Zufall zustande kämen — genau das unterscheidet ihn vom einfachen Threat Score und ist der Grund, warum er hier steht: in einem trockenen Zeitraum trifft „selten Regen" oft genug zufällig. 1 = perfekt, 0 = nicht besser als Zufall, Untergrenze −1/3.'}>
              ETS
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model, cont }) => {
            const e = ets(cont)
            const isBest = bestEts != null && Number.isFinite(e) && e === bestEts
            const fb = frequencyBias(cont)
            return (
              <tr key={model.id}>
                <th
                  title={
                    `${model.label} — ${model.provider}\n` +
                    `Gitterweite ${resolutionLabel(model)}\n` +
                    `Vorhersagehorizont ${model.forecastHours} h`
                  }
                >
                  {model.label}
                  <span className="verify-res">{resolutionLabel(model)}</span>
                </th>
                <td>{cont.hits}</td>
                <td>{cont.misses}</td>
                <td>{cont.falseAlarms}</td>
                <td>{fmtPct(pod(cont))}</td>
                <td>{fmtPct(far(cont))}</td>
                <td
                  title={
                    Number.isFinite(fb)
                      ? fb > 1
                        ? `Sagt Regen ${fmt2(fb)}-mal so oft an, wie er eintritt — zu nass.`
                        : fb < 1
                          ? `Sagt Regen nur ${fmt2(fb)}-mal so oft an, wie er eintritt — zu trocken.`
                          : 'Sagt Regen genau so oft an, wie er eintritt.'
                      : 'Kein eingetretenes Ereignis im Zeitraum.'
                  }
                >
                  {fmt2(fb)}
                </td>
                <td className={isBest ? 'verify-best' : undefined}>{fmtScore(e)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function VerifyPanel() {
  const [stations, setStations] = useState<AtStation[] | null>(null)
  const [stationId, setStationId] = useState(DEFAULT_STATION)
  /** Text im Suchfeld; die gültige Auswahl steckt in `stationId`. */
  const [stationQuery, setStationQuery] = useState('')
  const [target, setTarget] = useState<TargetId>('tlmax')
  const [span, setSpan] = useState(5)
  const [modelIds, setModelIds] = useState<string[]>(DEFAULT_MODELS)
  const [lead, setLead] = useState(1)
  /** Schwelle der kategorischen Bewertung (nur bei Schwellen-Zielgrößen). */
  const [threshold, setThreshold] = useState(1)

  /*
   * MESSUNG UND LÄUFE TRAGEN MIT SICH, WOZU SIE GEHÖREN — sonst deutet die
   * Tabelle nach einem Wechsel für die Dauer des Nachladens die alten Daten
   * nach der neuen Regel.
   *
   * Beim Sprung Temperatur → Niederschlag war das nicht subtil: `mode: 'sum'`
   * summierte die noch geladenen 24 STUNDENWERTE VON ~20 °C zu „480 mm"
   * Tagesniederschlag, aufgetragen gegen eine Messung von 3 mm. Beim
   * Stationswechsel ist derselbe Fehler heimtückischer, weil das Ergebnis
   * plausibel aussieht: die Werte von Wien stünden kurz unter dem Namen
   * Innsbruck. Deshalb hängt der Schlüssel an BEIDEM, und alles Abgeleitete
   * verwirft den Zustand, solange er nicht passt — lieber „—" als eine Zahl,
   * die zu etwas anderem gehört.
   */
  const [observed, setObserved] = useState<{ key: string; days: Map<string, number> } | null>(null)
  const [runs, setRuns] = useState<{ key: string; byModel: Record<string, PastRunSeries> }>({
    key: '',
    byModel: {},
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadStations()
      .then((s) => !cancelled && setStations(s))
      .catch((err) => !cancelled && setError(err?.message ?? 'Stationen nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = useMemo(() => (stations ? activeStations(stations) : []), [stations])
  const station = shown.find((s) => s.id === stationId) ?? null
  // Das Suchfeld EINMAL mit der Startstation vorbelegen, sobald die Liste da
  // ist — und danach nie wieder hineinregieren. Ein Effekt, der bei leerem
  // Feld nachfüllt, kämpft gegen jedes Löschen an: die Rücktaste stellte
  // sofort wieder „Wien Hohe Warte" her, und man kam nie dazu, „Graz" zu
  // tippen. Beim Verlassen des Feldes schnappt es zurück (siehe onBlur) —
  // das ist der richtige Zeitpunkt, nicht jeder Tastendruck.
  /**
   * Freien Text auf eine Station auflösen. Der exakte Name gewinnt (so wählt
   * die Vorschlagsliste aus), danach Namensanfang, danach Teiltreffer: wer
   * „graz" tippt und wegklickt, meint eine Grazer Station und nicht die
   * zuletzt eingestellte. Ohne diese Stufen fühlte sich das Feld an wie der
   * Fehler, den es gerade behoben hat.
   */
  const resolveStation = (text: string): AtStation | null => {
    const q = text.trim().toLowerCase()
    if (!q) return null
    return (
      shown.find((s) => s.name.toLowerCase() === q) ??
      shown.find((s) => s.name.toLowerCase().startsWith(q)) ??
      shown.find((s) => s.name.toLowerCase().includes(q)) ??
      null
    )
  }
  /** Text übernehmen, wenn er eine Station trifft; sonst zurückschnappen. */
  const commitStation = () => {
    const hit = resolveStation(stationQuery)
    if (hit) {
      setStationId(hit.id)
      setStationQuery(hit.name)
    } else if (station) {
      setStationQuery(station.name)
    }
  }

  const queryInit = useRef(false)
  useEffect(() => {
    if (queryInit.current || !station) return
    queryInit.current = true
    setStationQuery(station.name)
  }, [station])

  /** Woran geladene Daten hängen: Zielgröße UND Station. */
  const dataKey = `${target}|${station?.id ?? ''}`

  // Bis GESTERN: der laufende Tag hat noch kein geprüftes Tagesextrem, und ein
  // halber Tag als „Messung" würde jedes Modell schlecht aussehen lassen.
  const end = dayOffset(-1)
  const start = dayOffset(-span)
  const spec = TARGETS[target]

  // Das Tagesfenster ragt über den Zeitraum hinaus, und je nach Größe an einem
  // ANDEREN Ende: der Extremtag beginnt um 18 UTC des Vortags, der
  // Niederschlagstag endet um 06 UTC des Folgetags. Ohne diesen Überhang
  // fehlten dem Randtag sechs Stunden, er fiele unter die Mindeststundenzahl
  // und die Zeile bliebe leer. Betrifft nur die VORHERSAGE — die Messung
  // liefert GeoSphere fertig je Tag.
  const fcStart = spec.offsetH > 0 ? dayOffset(-span - 1) : start
  const fcEnd = spec.offsetH < 0 ? dayOffset(0) : end
  // Die Messung wird einen Tag früher geholt als gezeigt: die Persistenz als
  // Vergleichsvorhersage braucht den Vortag des ersten Tages, sonst verlöre
  // der Skill Score genau die erste Zeile.
  const obsStart = dayOffset(-span - 1)

  const models = useMemo(
    () =>
      modelIds
        .map((id) => MODELS.find((m) => m.id === id))
        .filter((m): m is ModelInfo => m != null && (!station || isInCoverage(m, station.lat, station.lon))),
    [modelIds, station],
  )
  const modelKey = models.map((m) => m.id).join(',')

  // Messung: EIN Bulk-Request, für immer gecacht (historische Tage sind statisch).
  useEffect(() => {
    if (!station) return
    let cancelled = false
    const obsSpec = getAtParameter(TARGETS[target].obsCode)
    fetchStationSeries(obsSpec.code, obsStart, end, [station.id], DATASET_DAILY)
      .then((s) => {
        if (cancelled) return
        const map = new Map<string, number>()
        const data = s.byStation[station.id] ?? []
        for (let i = 0; i < s.timestamps.length; i++) {
          const v = clean(obsSpec, data[i] ?? null)
          if (v != null) map.set(s.timestamps[i].slice(0, 10), v)
        }
        setObserved({ key: dataKey, days: map })
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Messwerte nicht ladbar'))
    return () => {
      cancelled = true
    }
  }, [station, target, dataKey, obsStart, end])

  // Vergangene Läufe je Modell — ein Request pro Modell, alle Vorlaufzeiten in
  // einem. Die Vorlaufzeiten sind am Modellhorizont gedeckelt, sonst holt man
  // Spalten, die die API garantiert leer zurückgibt.
  useEffect(() => {
    if (!station || models.length === 0) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all(
      models.map(async (m) => {
        const leads = leadsFor(m.forecastHours, MAX_LEAD_DAYS)
        if (leads.length === 0) return [m.id, null] as const
        // Stationshöhe mitgeben: sonst rechnet die API auf die Höhe ihres
        // Geländemodells und der Höhenunterschied landete als „Bias" in der
        // Verifikation (Sonnblick: 2962 statt 3109 m, rund 1 K).
        const r = await fetchPastRuns(
          station.lat,
          station.lon,
          m.id,
          FORECAST_VAR[target],
          fcStart,
          fcEnd,
          leads,
          station.altitude,
        )
        return [m.id, r] as const
      }),
    )
      .then((all) => {
        if (cancelled) return
        const next: Record<string, PastRunSeries> = {}
        for (const [id, r] of all) if (r) next[id] = r
        setRuns({ key: dataKey, byModel: next })
      })
      .catch((err) => !cancelled && setError(err?.message ?? 'Vorhersagen nicht ladbar'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // models über modelKey gekeyed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, modelKey, target, dataKey, fcStart, fcEnd])

  const days = useMemo(() => dayRange(start, end), [start, end])

  /**
   * Die Messreihe auf die GEZEIGTEN Tage beschränkt. Geholt wird ein Tag mehr
   * (für die Persistenz), gewertet werden darf er nicht — sonst stünde in der
   * Fehlerzeile ein Tag mehr, als die Tabelle darüber zeigt.
   */
  const obsShown = useMemo(() => {
    if (!observed || observed.key !== dataKey) return null
    const out = new Map<string, number>()
    for (const d of days) {
      const v = observed.days.get(d)
      if (v != null) out.set(d, v)
    }
    return out
  }, [observed, dataKey, days])

  /**
   * Persistenz als Vergleichsvorhersage: der Wert von gestern gilt für heute.
   * Sie wird aus der UNGEKÜRZTEN Messreihe gebildet, damit auch der erste
   * gezeigte Tag einen Vorgänger hat.
   */
  const reference = useMemo(
    () => (observed && observed.key === dataKey ? persistenceForecast(observed.days) : null),
    [observed, dataKey],
  )

  /**
   * ZWEITE Referenz: Klimatologie („jeden Tag der Durchschnitt"), gebildet aus
   * den GEZEIGTEN Tagen im Leave-one-out-Verfahren (siehe
   * `climatologyForecast`). Sie wird gebraucht, weil Persistenz bei +5 bis
   * +7 Tagen trivial zu schlagen ist: dort sättigt ihr Skill Score und trennt
   * die Modelle nicht mehr — genau da, wo der Vergleich interessant wird.
   */
  const climate = useMemo(() => (obsShown ? climatologyForecast(obsShown) : null), [obsShown])

  /** Je Modell und Vorlauf: Tageswerte der damaligen Vorhersage + Bewertung. */
  const table = useMemo(() => {
    // Läufe der vorigen Zielgröße oder Station nicht anfassen — siehe oben,
    // das ergab Niederschlagssummen von mehreren hundert Millimetern.
    const fresh = runs.key === dataKey ? runs.byModel : {}
    return models.map((m) => {
      const r = fresh[m.id]
      const cells = new Map<
        number,
        {
          daily: Map<string, number>
          scores: Scores
          skill: Skill
          climSkill: Skill
          cont: Contingency
        }
      >()
      if (r && obsShown && reference && climate) {
        for (const [n, series] of r.byLead) {
          const daily = dailyValues(r.timeMs, series, spec.mode, spec.offsetH)
          cells.set(n, {
            daily,
            scores: score(daily, obsShown),
            skill: skillScore(daily, obsShown, reference),
            climSkill: skillScore(daily, obsShown, climate),
            cont: contingency(daily, obsShown, threshold),
          })
        }
      }
      return { model: m, cells }
    })
  }, [models, runs, dataKey, obsShown, reference, climate, spec, threshold])

  /**
   * RANGLISTE über den ganzen Zeitraum — der „auf einen Blick"-Teil.
   *
   * Gereiht nach MAE, aber die Reihung allein ist die schwächste Aussage
   * darin. Entscheidend ist die letzte Spalte: der GEPAARTE Unterschied zum
   * besten Modell samt Standardfehler. Alle Modelle werden an denselben Tagen
   * verifiziert, also ist die Differenz der Tagesfehler die richtige Größe —
   * was allen gemeinsam schwerfiel, kürzt sich heraus. Liegt der Unterschied
   * innerhalb von zwei Standardfehlern, heißt das Ergebnis „nicht
   * unterscheidbar", und die Rangfolge dahinter ist Zufall.
   */
  const ranking = useMemo(() => {
    if (!obsShown) return []
    const rows = table
      .map((r) => ({ model: r.model, cell: r.cells.get(lead) }))
      .filter((r): r is { model: ModelInfo; cell: NonNullable<typeof r.cell> } =>
        r.cell != null && r.cell.scores.n > 0,
      )
      .sort((a, b) => a.cell.scores.mae - b.cell.scores.mae)
    if (rows.length === 0) return []
    const best = rows[0]
    return rows.map((r, i) => {
      const paired: Paired | null =
        i === 0 ? null : pairedMae(r.cell.daily, best.cell.daily, obsShown)
      return {
        model: r.model,
        scores: r.cell.scores,
        skill: r.cell.skill,
        climSkill: r.cell.climSkill,
        paired,
        // Das BESTE Modell gilt nur dann als abgesetzt, wenn es sich vom
        // ZWEITEN unterscheidet — sonst führt es die Liste zwar an, aber die
        // Führung ist nicht belastbar.
        distinct: i === 0 ? false : distinguishable(paired!),
      }
    })
  }, [table, lead, obsShown])

  /** Führt das beste Modell mit belastbarem Abstand zum Zweiten? */
  const leadIsClear = ranking.length > 1 && ranking[1].distinct

  const availableLeads = useMemo(() => {
    const s = new Set<number>()
    for (const row of table) for (const n of row.cells.keys()) s.add(n)
    return [...s].sort((a, b) => a - b)
  }, [table])
  useEffect(() => {
    if (availableLeads.length && !availableLeads.includes(lead)) setLead(availableLeads[0])
  }, [availableLeads, lead])

  const obsCount = obsShown ? obsShown.size : 0
  /** Zielgröße mit Schwellenereignis → kategorische Bewertung anbieten. */
  const categorical = spec.thresholds.length > 0
  // Die Schwelle muss zur Größe passen: beim Wechsel von Niederschlag auf
  // Temperatur bliebe sonst eine 1-mm-Schwelle im Zustand stehen.
  useEffect(() => {
    if (categorical && !spec.thresholds.includes(threshold)) setThreshold(spec.thresholds[0])
  }, [categorical, spec, threshold])
  /** Kleinster mittlerer Fehler über den ganzen Zeitraum — nur zum Markieren. */
  const bestMae = useMemo(() => {
    const vals = table
      .map((r) => r.cells.get(lead)?.scores)
      .filter((s): s is Scores => s != null && s.n > 0)
      .map((s) => s.mae)
    return vals.length ? Math.min(...vals) : null
  }, [table, lead])

  return (
    <div className="meteo">
      <div className="atclima-bar">
        <span className="atclima-title">Verifikation</span>
        <label className="atclima-ctrl">
          <span className="label-muted">Station</span>
          {/* Tippen statt scrollen: 290 Stationen in einem Dropdown findet
              niemand. `datalist` ist die native Variante — sie filtert beim
              Tippen, ohne eigenes Widget, und funktioniert mit der Tastatur.
              Übernommen wird erst, wenn der Text eine Station EINDEUTIG trifft;
              bis dahin bleibt die alte stehen, statt bei jedem Zeichen zu
              springen. */}
          <input
            type="text"
            list="verify-stations"
            value={stationQuery}
            placeholder="Station suchen …"
            onChange={(e) => {
              const q = e.target.value
              setStationQuery(q)
              // Beim TIPPEN nur der exakte Treffer — so uebernimmt ein Klick
              // in der Vorschlagsliste sofort, ohne dass jedes Zwischenzeichen
              // die Tabelle neu laedt.
              const exact = shown.find((s) => s.name.toLowerCase() === q.trim().toLowerCase())
              if (exact) setStationId(exact.id)
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitStation()
                e.currentTarget.blur()
              }
            }}
            onBlur={commitStation}
            title="Messstation, gegen die verglichen wird — die Vorhersage wird für ihre Koordinaten geholt"
            style={{ width: 200 }}
          />
          <datalist id="verify-stations">
            {[...shown]
              .sort((a, b) => a.name.localeCompare(b.name, 'de'))
              .map((s) => (
                <option key={s.id} value={s.name} />
              ))}
          </datalist>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Größe</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as TargetId)}>
            {Object.entries(TARGETS).map(([id, t]) => (
              <option key={id} value={id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Zeitraum</span>
          <select
            value={span}
            onChange={(e) => setSpan(Number(e.target.value))}
            title={SPANS.find((s) => s.days === span)?.hint}
          >
            {SPANS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="atclima-ctrl">
          <span className="label-muted">Verglichener Lauf</span>
          <select
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            title={
              'Wie ALT die verglichene Vorhersage war. „Stand 24 h vorher" heißt: für jede Stunde ' +
              'des Zieltages wird der Wert genommen, den die Vorhersage 24 Stunden davor hatte — ' +
              'ein gleitender Vorlauf. Es ist ausdrücklich NICHT der 00-UTC-Lauf des Vortags: das ' +
              'Tagesmaximum fällt meist auf 14–16 UTC und stammt damit vom Stand des Vortags um ' +
              'dieselbe Uhrzeit. Gemessen: die Reihe springt an der Tagesgrenze nicht, und der ' +
              'Fehler wächst über den Tag nicht an — bei einem festen 00-UTC-Lauf müsste beides ' +
              'zu sehen sein. Einen bestimmten Lauf gibt die API nicht her (geprüft: `run` wird ' +
              'abgelehnt, `model_run` still ignoriert). Der gleitende Vorlauf hat dafür einen ' +
              'Vorzug: jeder Tag wird beim GLEICHEN Vorhersagealter verglichen, während ein ' +
              'fester Lauf über den Tag hinweg 24 bis 47 Stunden Vorlauf mischt.'
            }
          >
            {(availableLeads.length ? availableLeads : [1]).map((n) => (
              <option key={n} value={n}>
                {leadLabel(n)} ({leadDays(n)})
              </option>
            ))}
          </select>
        </label>
        {categorical && (
          <label className="atclima-ctrl">
            <span className="label-muted">Schwelle</span>
            <select
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              title={
                'Ab welcher Tagesmenge ein Tag als „Regentag" zählt. Die kategorische ' +
                'Bewertung darunter fragt nur noch: hat das Modell diesen Tag angesagt, und kam ' +
                'er? 0,1 mm = überhaupt messbarer Niederschlag, 1 mm = der Niederschlagstag der ' +
                'Klimatologie (dieselbe Schwelle wie die Kenntage in der Klimakarte), 5 und ' +
                '10 mm = ergiebiger Regen. Je höher die Schwelle, desto seltener das Ereignis ' +
                'und desto wackliger die Zahlen — bei 10 mm bleiben selbst in 60 Tagen oft ' +
                'weniger als zehn Fälle übrig.'
              }
            >
              {spec.thresholds.map((t) => (
                <option key={t} value={t}>
                  ≥ {fmtThreshold(t)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="atclima-sub">
          {error ? `⚠ ${error}` : loading ? 'lädt …' : `${obsCount} Messtage`}
        </span>
        {/* Die Warnung als Merker in der Leiste statt als Textblock unter der
            Tabelle: dass eine Fünf-Tage-Reihe die Modelle nicht reiht, muss
            sichtbar sein, aber es braucht dafür keinen Absatz. */}
        {span < ROUGH_DAYS && (
          <span
            className="atclima-hint"
            title={
              `Über ${span} Tage entscheidet der Zufall, welches Modell vorn liegt. Die ` +
              'Fehlerzeile taugt so als Blick zurück, nicht als Reihung — dafür auf 20 Tage ' +
              'stellen, und belastbar würde sie erst über Monate.'
            }
          >
            ⚠ kein Modellvergleich
          </span>
        )}
        <span
          className="atclima-hint"
          title={
            (spec.mode === 'sum'
              ? 'Verglichen wird die Tagessumme über den NIEDERSCHLAGSTAG: 06 UTC bis 06 UTC ' +
                'des Folgetags, also 07 bis 07 MEZ. Der Regen des frühen Morgens zählt damit ' +
                'noch zum VORTAG. Das ist ein anderes Fenster als bei den Temperaturextremen ' +
                'und läuft in die andere Richtung — beides gegen die 10-Minuten-Reihe gemessen ' +
                '(siehe verify.ts), nicht aus der Doku übernommen.'
              : 'Verglichen wird das Tagesextrem über den KLIMATAG: 18 UTC des Vortags bis ' +
                '18 UTC, also 19 bis 19 MEZ. So definiert GeoSphere seine Tagesextreme ' +
                '(gemessen gegen die 10-Minuten-Reihe, siehe verify.ts). Mit dem naheliegenden ' +
                '00–24 UTC stand nach einem heißen Tag mit Frontdurchgang bei ALLEN Modellen ' +
                'gleichzeitig ein Fehler von 2 bis 3 K, der keiner war: das Klima-Tagesmaximum ' +
                'stammte dann aus dem Abend des Vortags.') +
            ' Die Vorhersage wird über dasselbe Fenster reduziert und kommt aus der ' +
            'Historical-Forecast-API von Open-Meteo: sie liefert zu einem vergangenen ' +
            'Zeitpunkt auch das, was N Tage vorher dafür vorhergesagt wurde. Der laufende Tag ' +
            'fehlt bewusst — er hat noch keinen geprüften Tageswert.'
          }
        >
          {spec.mode === 'sum' ? 'Tagessumme' : 'Tagesextrem'} {spec.windowLabel}
        </span>
      </div>

      {/* NACH SKALA GRUPPIERT, nicht alphabetisch: interessant ist der
          Vergleich 2,5-km-Lokalmodell gegen 25-km-Global, und innerhalb der
          Globalen die beiden ECMWF-Läufe (IFS gegen AIFS) direkt
          nebeneinander. Die Auflösung steht an jedem Eintrag — ohne sie ist
          nicht zu sehen, warum ein Modell im Alpental danebenliegt.

          Gezeigt werden nur Modelle, die den gewählten Vorlauf überhaupt
          tragen: bei +3 Tagen fallen AROME Austria (60 h) und ICON-D2 (48 h)
          heraus, weil es dort keine drei Tage alte Vorhersage für diesen Tag
          geben KANN. Sie als leere Spalten anzubieten wäre eine Einladung zum
          Fehlschluss. */}
      <div className="verify-models">
        {groupModelsByScale(
          SELECTABLE_MODELS.filter(
            (m) =>
              (!station || isInCoverage(m, station.lat, station.lon)) &&
              m.forecastHours >= lead * 24 + 24,
          ),
        ).map((group) => (
          <div key={group.scale} className="verify-modelgroup">
            <span className="label-muted" title={SCALE_HINTS[group.scale]}>
              {SCALE_LABELS[group.scale]}
            </span>
            {group.models.map((m) => (
              <label
                key={m.id}
                className="verify-model"
                title={
                  `${m.label} — ${m.provider}\n` +
                  `Gitterweite ${resolutionLabel(m)}\n` +
                  `Vorhersagehorizont ${m.forecastHours} h\n` +
                  `neuer Lauf alle ${m.updateIntervalHours} h\n` +
                  `Abdeckung ${m.coverage === 'global' ? 'global' : 'regional'}\n\n` +
                  SCALE_HINTS[group.scale]
                }
              >
                <input
                  type="checkbox"
                  checked={modelIds.includes(m.id)}
                  onChange={(e) =>
                    setModelIds((prev) =>
                      e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                    )
                  }
                />
                {m.label}
                {/* Die Auflösung steht sichtbar dabei, nicht nur im Tooltip:
                    sie ist beim Modellvergleich die halbe Erklärung. */}
                <span className="verify-res">{resolutionLabel(m)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="verify-body">
        {!station ? (
          <div className="panel-placeholder">Lade Stationen …</div>
        ) : (
          <>
            {/* Was hier verglichen wird, in einem Satz. Eine Zahlenmatrix ohne
                Größe, Ort, Zeitfenster und Zeitraum ist nicht lesbar. */}
            <div className="verify-what">
              <strong>{spec.label}</strong> an der Station <strong>{station.name}</strong>
              {station.altitude != null && <> ({Math.round(station.altitude)} m)</>}, gemessen als{' '}
              {spec.mode === 'sum' ? 'Tagessumme' : 'Tagesextrem'} über den{' '}
              {spec.mode === 'sum' ? 'Niederschlagstag' : 'Klimatag'}{' '}
              <strong>{spec.windowLabel}</strong> ({spec.mode === 'sum' ? '07–07' : '19–19'} MEZ).
              Verglichen mit der{' '}
              <span
                title={
                  'Rohe Modellausgabe, auf den Punkt und auf die Stationshöhe gerechnet — KEIN ' +
                  'MOS. Statistisch korrigierte Punktvorhersagen führt die Seite als DWD MOSMIX ' +
                  'unter „Österreich-Klima → Vorhersage"; die lassen sich hier nicht verifizieren, ' +
                  'weil MOSMIX kein öffentliches Archiv vergangener Läufe hat.'
                }
              >
                deterministischen Punktprognose
              </span>{' '}
              bei <strong>{leadLabel(lead)}</strong>{' '}
              <span
                title={
                  'GLEITENDER Vorlauf als Referenz: für jede Stunde des Tages der Stand, den die ' +
                  'Vorhersage ' + lead * 24 + ' Stunden davor hatte. Das ist NICHT ein fester ' +
                  'Modelllauf — je nach Zeitpunkt und Modell stammt der Stand aus einem anderen ' +
                  'Lauf, und die Modelle laufen unterschiedlich oft: AROME Austria und ICON-D2 ' +
                  'alle 3 Stunden, IFS alle 6, andere alle 12. Ein fester Lauf wäre über die API ' +
                  'ohnehin nicht zu bekommen (geprüft) — und er hätte einen Nachteil: er mischt ' +
                  'über den Tag hinweg ' + lead * 24 + ' bis ' + (lead * 24 + 23) + ' Stunden ' +
                  'Vorlauf, während der gleitende jeden Tag beim GLEICHEN Vorhersagealter ' +
                  'vergleicht. Gemessen: die Reihe springt an der Tagesgrenze nicht und der ' +
                  'Fehler wächst über den Tag nicht an — beides wäre bei einem festen Lauf anders.'
                }
              >
                (gleitend, kein fester Lauf)
              </span>
              . Zeitraum{' '}
              <strong>
                {fmtShort.format(new Date(`${start}T12:00:00Z`))}–{fmtDay(end)}
              </strong>{' '}
              ({obsCount} Messtage).
            </div>
            {/* ÜBER der Tag-für-Tag-Tabelle: die Reihung über den ganzen
                Zeitraum samt Unsicherheit. Die Tabelle darunter bleibt die
                ehrliche Detailansicht — hier steht die Antwort auf „welches
                Modell taugt hier", dort die auf „wie lief es diese Woche". */}
            <RankingBlock rows={ranking} spec={spec} lead={lead} leadIsClear={leadIsClear} />
            <div className="verify-main">
            {/* TAG FÜR TAG: gemessen, vorhergesagt, Differenz. Das ist die
                Frage, die man an fünf Tagen stellt — eine Matrix aus
                Fehlermaßen bräuchte Wochen, um überhaupt etwas zu sagen. */}
            <table className="verify-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th
                    title={
                      `Gemessener Wert der Station — ${spec.mode === 'sum' ? 'Tagessumme' : 'Tagesextrem'} ` +
                      `über ${spec.windowLabel} aus dem geprüften Klimatagesdatensatz ` +
                      '(GeoSphere klima-v2-1d); die Vorhersage wird über dasselbe Fenster reduziert.'
                    }
                  >
                    Messung
                    <span className="verify-err">{spec.windowLabel}</span>
                  </th>
                  {table.map((row) => (
                    <th
                      key={row.model.id}
                      title={
                        `${row.model.label} — ${row.model.provider}\n` +
                        `Gitterweite ${resolutionLabel(row.model)}\n` +
                        `Vorhersagehorizont ${row.model.forecastHours} h\n` +
                        `neuer Lauf alle ${row.model.updateIntervalHours} h\n\n` +
                        'Obere Zahl: Vorhersagewert. Untere: Abweichung von der Messung.'
                      }
                    >
                      {row.model.label}
                      <span className="verify-err">{resolutionLabel(row.model)} · Wert / Δ</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => {
                  // obsShown, nicht observed: gegatet auf die Zielgröße und auf
                  // die gezeigten Tage beschränkt.
                  const obs = obsShown?.get(d) ?? null
                  return (
                    <tr key={d}>
                      <th>{fmtDay(d)}</th>
                      <td className="verify-obs">
                        {obs != null ? `${fmt1(obs)} ${spec.unit}` : '—'}
                      </td>
                      {table.map((row) => {
                        const fc = row.cells.get(lead)?.daily.get(d) ?? null
                        const err = fc != null && obs != null ? fc - obs : null
                        return (
                          <td
                            key={row.model.id}
                            style={{
                              background: err != null ? errColor(Math.abs(err), spec.errSteps) : undefined,
                            }}
                            title={
                              fc == null
                                ? row.model.forecastHours < lead * 24 + 24
                                  ? `${row.model.label} rechnet nur ${row.model.forecastHours} h weit — für einen Vorlauf von ${lead * 24} h bietet die API dort keine Reihe an.`
                                  : 'Für diesen Tag liegt keine Vorhersage vor.'
                                : `${row.model.label}, ${leadLabel(lead)}: ${fmt1(fc)} ${spec.unit}` +
                                  (err != null
                                    ? `, gemessen ${fmt1(obs!)} ${spec.unit} → ${fmtSigned(err)} ${spec.errUnit}`
                                    : '')
                            }
                          >
                            {fc != null ? (
                              <>
                                <span className="verify-fc">{fmt1(fc)}</span>
                                <span className="verify-err">{err != null ? fmtSigned(err) : ''}</span>
                              </>
                            ) : (
                              <span className="verify-empty">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th
                    title={
                      'Über die gezeigten Tage: oben der mittlere Fehlerbetrag, unten die ' +
                      'systematische Schieflage. Ein Modell mit +2 K Schieflage liegt immer zu ' +
                      'warm und ist korrigierbar, eines mit 0 K streut nur; darin steckt auch der ' +
                      'Unterschied zwischen Modellgitterzelle und Messplatz. Markiert ist das ' +
                      'beste Modell ÜBER DEN ZEITRAUM — je Tag das nächstliegende zu zeigen wäre ' +
                      'Rosinenpicken im Nachhinein (gemessen 0,59 K statt 1,16 K des besten ' +
                      'Einzelmodells).' +
                      (categorical
                        ? '\n\nBEIM NIEDERSCHLAG ist diese Zeile das schwächste Maß der Seite: die ' +
                          'meisten Tage sind trocken, ein Modell, das nie Regen ansagt, bekommt ' +
                          'damit einen glänzenden Wert. Maßgeblich ist die kategorische ' +
                          'Bewertung unter der Tabelle.'
                        : '') +
                      (span < ROUGH_DAYS
                        ? `\n\nACHTUNG: über ${span} Tage ist das kein Modellvergleich — bei so kurzen Reihen entscheidet der Zufall, welches Modell vorn liegt.`
                        : `\n\nÜber ${span} Tage ist die Reihung grob; belastbar würde sie erst über Monate.`)
                    }
                  >
                    Ø Fehler
                    <span className="verify-err">{obsCount} Tage</span>
                  </th>
                  <td className="verify-empty">—</td>
                  {table.map((row) => {
                    const sc = row.cells.get(lead)?.scores
                    // Bestes Modell ÜBER DEN ZEITRAUM markieren — nicht je Tag.
                    // Je Tag das nächstliegende Modell zu nehmen wäre kein
                    // Vergleich, sondern Rosinenpicken im Nachhinein (siehe
                    // Legende).
                    const isBest = sc != null && sc.n > 0 && bestMae != null && sc.mae === bestMae
                    return (
                      <td
                        key={row.model.id}
                        className={isBest ? 'verify-best' : undefined}
                        title={
                          sc && sc.n
                            ? `${sc.n} Tage · mittlerer absoluter Fehler ${fmt1(sc.mae)} ${spec.errUnit} · ` +
                              `Bias ${fmtSigned(sc.bias)} ${spec.errUnit} · RMSE ${fmt1(sc.rmse)} ${spec.errUnit}` +
                              (isBest ? '\nKleinster Fehler über den gezeigten Zeitraum.' : '')
                            : 'Keine gemeinsamen Tage.'
                        }
                      >
                        {sc && sc.n ? (
                          <>
                            <span className="verify-fc">{fmt1(sc.mae)}</span>
                            <span className="verify-err">{fmtSigned(sc.bias)}</span>
                          </>
                        ) : (
                          <span className="verify-empty">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
                {/* SKILL statt bloßem Fehlerbetrag: „MAE 1,5 K" sagt nicht,
                    wie schwer die Aufgabe war. Gegen die Persistenz gemessen
                    schon — sie ist die Vorhersage, die jeder ohne Modell
                    hinbekommt. */}
                <tr>
                  <th
                    title={
                      'Skill Score gegen die PERSISTENZ, also gegen „morgen wird es wie heute": ' +
                      '1 − MSE(Modell)/MSE(Persistenz). 0 heißt „so gut wie gar kein Modell", ' +
                      '1 wäre fehlerfrei, NEGATIV heißt schlechter als die triviale Ansage. ' +
                      'Erst dadurch lässt sich ein Fehlerbetrag einordnen: dieselben 1,5 K sind ' +
                      'in einer stabilen Hochdrucklage schwach und in einer Woche mit drei ' +
                      'Frontdurchgängen gut.\n\n' +
                      'GRENZE: Persistenz ist nur bei kurzem Vorlauf ein ernsthafter Gegner. ' +
                      `Bei ${leadDays(lead)} Vorlauf ist ein hoher Wert eher „besser als raten" ` +
                      'als ein Gütesiegel. Bei der Niederschlagssumme ist sie zusätzlich ein ' +
                      'schwacher Maßstab, weil zwei trockene Tage hintereinander ihr einen ' +
                      'fehlerfreien Treffer schenken.'
                    }
                  >
                    Skill
                    <span className="verify-err">vs. Persistenz</span>
                  </th>
                  <td className="verify-empty">—</td>
                  {table.map((row) => {
                    const sk = row.cells.get(lead)?.skill
                    const ok = sk != null && sk.n > 0 && Number.isFinite(sk.ss)
                    return (
                      <td
                        key={row.model.id}
                        title={
                          ok
                            ? `${row.model.label}: ${sk.ss > 0 ? 'um ' + Math.round(sk.ss * 100) + ' % kleinerer' : 'kein kleinerer'} ` +
                              `quadratischer Fehler als die Persistenz, über ${sk.n} Tage.`
                            : 'Nicht bestimmbar — die Persistenz hat hier keinen Fehler, gegen den sich messen ließe (kommt bei Trockenperioden vor).'
                        }
                      >
                        {ok ? (
                          <span className="verify-fc">{fmtScore(sk.ss)}</span>
                        ) : (
                          <span className="verify-empty">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
            </div>
            {categorical && <CategoricalBlock table={table} lead={lead} threshold={threshold} span={span} />}
          </>
        )}
      </div>
      <OpenMeteoAttribution className="app-attribution" />
    </div>
  )
}
