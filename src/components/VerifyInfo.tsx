// Dokumentation der Verifikation: WIE jede Kennzahl hier gerechnet wird.
//
// Wie `SoundingInfo` die Rechnung DIESER Seite, nicht die Lehrbuchdefinition:
// Tagesfenster, Referenzvorhersagen und Signifikanz gibt es in vielen
// Konventionen, und wer die Zahlen mit einer anderen Verifikation vergleicht,
// braucht genau diese Angaben. Quelle der Wahrheit ist `components/verify.ts`
// (Statistik) bzw. `config/ownVerify.ts` (Archiv der eigenen Modelle) — jede
// Formel hier steht dort so im Code. Ändert sich dort das Verfahren, muss
// dieser Text mit.
//
// Per React.lazy aus `VerifyPanel` geladen: KaTeX kommt erst mit dem ersten
// Klick auf „Info".

import { useEffect } from 'react'
import { M } from './Tex'

const TOC: [string, string][] = [
  ['vi-grund', 'Grundlagen'],
  ['vi-fehler', 'Bias, MAE, RMSE'],
  ['vi-murphy', 'MSE-Zerlegung'],
  ['vi-skill', 'Skill Score'],
  ['vi-paired', 'Unterscheidbarkeit'],
  ['vi-cat', 'Regentage (ETS)'],
  ['vi-own', 'C-LAEF und Varda'],
]

export default function VerifyInfo({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="skewt-info verify-info" role="dialog" aria-label="Wie die Verifikation gerechnet wird">
      <div className="skewt-info-head">
        <h2>Wie die Verifikation gerechnet wird</h2>
        <button type="button" className="skewt-info-close" onClick={onClose} title="Schließen (Esc)">
          ✕
        </button>
      </div>

      <div className="skewt-info-body">
        <nav className="skewt-info-toc">
          {TOC.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* --- Grundlagen ------------------------------------------------ */}
        <section id="vi-grund">
          <h3>Grundlagen</h3>
          <h4>Messung</h4>
          <p>
            Verglichen wird mit den <b>geprüften Tageswerten von GeoSphere Austria</b> (Datensatz
            klima-v2-1d): Tageshöchst- und Tagestiefsttemperatur (<i>tlmax</i>, <i>tlmin</i>) und
            die Niederschlagssumme (<i>rr</i>). Der laufende Tag fehlt, er hat noch keinen
            geprüften Wert.
          </p>

          <h4>Tagesfenster</h4>
          <p>
            Beide Seiten werden über <b>dasselbe Zeitfenster</b> zu einem Tageswert reduziert.
            GeoSphere verwendet dafür zwei verschiedene Fenster. Beide wurden gegen die
            10-Minuten-Reihe nachgemessen:
          </p>
          <M
            block
            t="\text{Extreme } D:\ [\,D{-}1\ 18\,\text{UTC},\ D\ 18\,\text{UTC}\,) \qquad \text{Niederschlag } D:\ [\,D\ 06\,\text{UTC},\ D{+}1\ 06\,\text{UTC}\,)"
          />
          <p>
            Das entspricht 19–19 MEZ bzw. 07–07 MEZ, fest in MEZ und ohne Sommerzeit. Aus den
            Stundenwerten <M t="x_h" /> der Vorhersage wird das Maximum, das Minimum bzw. die
            Summe gebildet. Ein Tag zählt nur mit <b>mindestens 20 Stundenwerten</b>, sonst wäre
            ein angeschnittener Tag beim Niederschlag nicht von „weniger Regen“ zu unterscheiden.
          </p>

          <h4>Vorlauf</h4>
          <p>
            „Stand <M t="24n" /> h vorher“ ist ein <b>gleitender Vorlauf</b>: Für jede Stunde{' '}
            <M t="t" /> gilt der Wert des jüngsten Laufs mit
          </p>
          <M block t="t_{\text{init}} \le t - 24\,n\ \text{h}" />
          <p>
            Bei Open-Meteo sind das die Reihen <code>previous_day</code>
            <M t="n" />. Jeder Tag wird so beim gleichen Vorhersagealter verglichen. Ein fester
            00-UTC-Lauf würde über den Tag dagegen <M t="24n" /> bis <M t="24n+23" /> Stunden
            Vorlauf mischen.
          </p>

          <h4>Höhe</h4>
          <p>
            Die Modelltemperatur wird auf die Stationshöhe <M t="z_s" /> umgerechnet, mit dem
            Standardgradienten von 0,65 K je 100 m:
          </p>
          <M block t="T_{\text{Station}} = T_{\text{Modell}} + 0{,}0065\,\tfrac{\text{K}}{\text{m}}\cdot\left(z_{\text{Modell}} - z_s\right)" />
          <p>
            Bei den Open-Meteo-Modellen erledigt das Open-Meteo, weil die Abfrage die Stationshöhe
            mitgibt. Bei C-LAEF und Varda rechnet die Seite selbst. Die Modellhöhe{' '}
            <M t="z_{\text{Modell}}" /> wird dort aus einem Geländemodell genähert, gemittelt über
            1 km. Inversionen kennt diese Korrektur nicht.
          </p>

          <p>
            <b>Alle Kennzahlen</b> werden nur über die Tage <M t="i = 1 \dots n" /> gebildet, an
            denen Vorhersage <M t="f_i" /> <b>und</b> Messung <M t="o_i" /> vorliegen. Der Fehler
            ist <M t="e_i = f_i - o_i" />: positiv heißt zu warm bzw. zu nass.
          </p>
        </section>

        {/* --- Fehlermaße ------------------------------------------------ */}
        <section id="vi-fehler">
          <h3>Bias, MAE, RMSE</h3>
          <M
            block
            t="\text{Bias} = \frac{1}{n}\sum_i e_i \qquad \text{MAE} = \frac{1}{n}\sum_i |e_i| \qquad \text{RMSE} = \sqrt{\text{MSE}},\ \ \text{MSE} = \frac{1}{n}\sum_i e_i^2"
          />
          <p>
            Beim <b>Bias</b> ist das Vorzeichen die Aussage: Er zeigt den systematischen Versatz,
            etwa durch eine falsche Modellhöhe. Der <b>MAE</b> ist die Größe des typischen
            Fehlgriffs, und nach ihm richtet sich „Bestes Modell“. Der <b>RMSE</b> gewichtet
            Ausreißer stärker.
          </p>
          <p>
            Das Diagramm <b>„MAE nach Vorlauf“</b> zeigt den MAE für jeden verfügbaren Vorlauf
            über denselben Zeitraum. Steigt die Kurve mit dem Vorlauf nicht an, ist der Zeitraum
            zu kurz, um die Modelle zu trennen.
          </p>
        </section>

        {/* --- Murphy ---------------------------------------------------- */}
        <section id="vi-murphy">
          <h3>Zerlegung des MSE (Murphy 1988)</h3>
          <p>
            Mit den Mittelwerten <M t="\bar f, \bar o" />, den Standardabweichungen{' '}
            <M t="\sigma_f, \sigma_o" /> und der Korrelation <M t="r" /> über dieselben Tage:
          </p>
          <M
            block
            t="\sigma_f^2 = \frac{1}{n}\sum_i (f_i - \bar f)^2 \qquad r = \frac{\frac{1}{n}\sum_i (f_i-\bar f)(o_i-\bar o)}{\sigma_f\,\sigma_o}"
          />
          <M
            block
            t="\text{MSE} = \underbrace{\text{Bias}^2}_{\text{Versatz}} + \underbrace{(\sigma_f - \sigma_o)^2}_{\text{Amplitude}} + \underbrace{2\,\sigma_f\,\sigma_o\,(1 - r)}_{\text{Korrelation}}"
          />
          <p>
            Das ist eine exakte Identität, keine Näherung. Deshalb werden die Streuungen durch{' '}
            <M t="n" /> geteilt und nicht durch <M t="n-1" />. Der dritte Term wird als Rest{' '}
            <M t="\text{MSE} - \text{Bias}^2 - (\sigma_f-\sigma_o)^2" /> gerechnet, damit die
            Balken auch dann genau den MSE ergeben, wenn <M t="r" /> nicht definiert ist.
          </p>
          <p>
            <b>Versatz:</b> Das Modell liegt systematisch zu hoch oder zu tief. Das ließe sich
            nachträglich korrigieren. <b>Amplitude:</b> Das Modell schwankt zu wenig, etwa mit
            gedämpftem Tagesgang (<M t="\sigma_f/\sigma_o < 1" />), oder zu stark.{' '}
            <b>Korrelation:</b> Der Verlauf stimmt nicht, also Timing- und Lagefehler. Zwei
            Modelle mit gleichem MSE können hier völlig verschieden aussehen.
          </p>
        </section>

        {/* --- Skill ------------------------------------------------------ */}
        <section id="vi-skill">
          <h3>Skill Score</h3>
          <p>
            Ein Fehlermaß allein sagt nicht, wie schwer die Aufgabe war. Der Skill Score misst
            deshalb gegen eine triviale Referenzvorhersage <M t="f^{\text{ref}}" />:
          </p>
          <M block t="SS = 1 - \frac{\text{MSE}_{\text{Modell}}}{\text{MSE}_{\text{Referenz}}}" />
          <p>
            1 = perfekt, 0 = so gut wie die Referenz, negativ = schlechter. Gewertet werden nur
            Tage, an denen Modell, Messung und Referenz vorliegen. Ist die Referenz fehlerfrei
            (beim Niederschlag z. B. lauter trockene Tage), ist SS nicht definiert und erscheint
            nicht.
          </p>
          <h4>Persistenz</h4>
          <M block t="f^{\text{pers}}_i = o_{i-1}" />
          <p>
            „Wie gestern“ ist nur bei <b>kurzem Vorlauf</b> ein ernsthafter Gegner. Bei mehreren
            Tagen Vorlauf schlägt jedes Modell die Persistenz mühelos.
          </p>
          <h4>Klimatologie</h4>
          <M block t="f^{\text{klim}}_i = \frac{1}{n-1}\sum_{j \ne i} o_j" />
          <p>
            Das ist der Mittelwert der Messung im gewählten Zeitraum, <b>ohne den Tag selbst</b>{' '}
            (leave-one-out): Die Referenz soll den Tag nicht kennen, den sie vorhersagt. Es ist eine
            Stichproben-Klimatologie, kein 30-jähriges Mittel. Dafür ist sie an jeder Station
            definiert. Über den ganzen Vorlaufbereich bleibt sie der aussagekräftigere Maßstab.
          </p>
        </section>

        {/* --- Gepaart ---------------------------------------------------- */}
        <section id="vi-paired">
          <h3>Ist der Vorsprung echt? — gepaarter Vergleich</h3>
          <p>
            Ob das beste Modell <M t="A" /> wirklich vor einem anderen Modell <M t="B" /> liegt,
            wird über die Differenz der Tagesfehler geprüft. Was beiden gemeinsam schwerfiel, etwa
            eine Front, kürzt sich dabei heraus:
          </p>
          <M
            block
            t="d_i = |e^A_i| - |e^B_i| \qquad \bar d = \frac{1}{n}\sum_i d_i \qquad s^2 = \frac{1}{n-1}\sum_i (d_i - \bar d)^2"
          />
          <p>
            Wetter hält an, aufeinanderfolgende Tage sind also nicht unabhängig. Das wird über die
            Autokorrelation erster Ordnung <M t="\rho" /> der Differenzreihe korrigiert
            (AR(1)-Näherung, <M t="\rho" /> begrenzt auf 0…0,95):
          </p>
          <M
            block
            t="\rho = \frac{\sum_{i\ge2} (d_i-\bar d)(d_{i-1}-\bar d)}{\sum_i (d_i-\bar d)^2} \qquad n_{\text{eff}} = n\,\frac{1-\rho}{1+\rho} \qquad SE = \sqrt{\frac{s^2}{n_{\text{eff}}}}"
          />
          <p>
            Die beiden Modelle gelten als <b>unterscheidbar</b>, wenn gilt:
          </p>
          <M block t="|\bar d| > 2\,SE" />
          <p>
            Das entspricht grob 95 %. Bei mehreren Modellen im Vergleich ist das optimistisch,
            deshalb steht in der Anzeige „unterscheidbar“ und nicht „signifikant“. Bei{' '}
            <M t="\rho = 0{,}5" /> bleibt von 60 Tagen effektiv nur ein Drittel.
          </p>
        </section>

        {/* --- Kategorisch ------------------------------------------------ */}
        <section id="vi-cat">
          <h3>Niederschlag kategorisch — Regentage</h3>
          <p>
            Beim Niederschlag ist der Fehler in mm wenig wert: Ein Modell, das nie Regen ansagt,
            bekommt in trockenen Wochen einen glänzenden MAE. Deshalb zählt zusätzlich die Frage,
            ob ein Regentag (Tagessumme <M t="\ge" /> Schwelle) angesagt wurde und ob er eintrat:
          </p>
          <M
            block
            t="\begin{array}{c|cc} & \text{eingetreten} & \text{nicht eingetreten} \\ \hline \text{angesagt} & a\ (\text{Treffer}) & b\ (\text{Fehlalarm}) \\ \text{nicht angesagt} & c\ (\text{verpasst}) & d \end{array}"
          />
          <M
            block
            t="\text{POD} = \frac{a}{a+c} \qquad \text{FAR} = \frac{b}{a+b} \qquad \text{FBI} = \frac{a+b}{a+c}"
          />
          <p>
            <b>POD</b> (Trefferquote): Anteil der Regentage, die angesagt waren.{' '}
            <b>FAR</b> (Fehlalarmanteil): Anteil der Ansagen, bei denen kein Regen kam.{' '}
            <b>FBI</b> (Häufigkeitsbias): Anzahl der Ansagen geteilt durch die eingetretenen
            Regentage, über 1 = zu oft nass. Die Trefferquote allein ist wertlos, denn „immer
            Regen“ erreicht 1.
          </p>
          <h4>Equitable Threat Score (Gilbert)</h4>
          <M
            block
            t="a_r = \frac{(a+c)(a+b)}{n} \qquad \text{ETS} = \frac{a - a_r}{a + b + c - a_r}"
          />
          <p>
            <M t="a_r" /> ist die Zahl der Treffer, die bei gleicher Ansagehäufigkeit schon
            zufällig zustande kämen. 1 = perfekt, 0 = nicht besser als Zufall, die Untergrenze
            ist −1/3. Je höher die Schwelle, desto seltener das Ereignis und desto wackliger die
            Zahl.
          </p>
        </section>

        {/* --- Eigene Modelle --------------------------------------------- */}
        <section id="vi-own">
          <h3>C-LAEF und Varda — eigenes Archiv</h3>
          <p>
            Beide Modelle gibt es nicht bei Open-Meteo. GeoSphere hält von C-LAEF nur die letzten
            sechs Läufe vor, und Varda wird auf eigener Hardware gerechnet. Deshalb legt die Seite
            ab dem <b>24.11.2026</b> ein eigenes Archiv an. Von jedem Lauf werden 2-m-Temperatur
            und Niederschlag an den Stationen gespeichert (bilinear aus dem 1-km-Gitter). Daraus
            entstehen stündlich dieselben gleitenden Vorlaufreihen, die Open-Meteo liefert:
          </p>
          <M block t="x^{(n)}(t) = x_{\,\text{jüngster Lauf mit } t_{\text{init}} \le t - 24n\,\text{h}}(t)" />
          <p>
            Der Niederschlag kommt als Summe seit dem Start. Die Stundenmenge ist die Differenz
            zweier Schritte. Liegen Schritte mehr als eine Stunde auseinander, wird die Menge
            gleichmäßig verteilt, wie bei Open-Meteo.
          </p>
          <p>
            <b>Folge:</b> Das Archiv wächst erst ab seinem Start. Ein Vorlauf von <M t="n" />{' '}
            Tagen hat frühestens <M t="24n" /> Stunden nach dem ersten archivierten Lauf einen
            Wert, und gewertet wird er erst, wenn der zugehörige Messtag abgeschlossen ist. C-LAEF
            führt +1 und +2 Tage (60 h Horizont, alle 3 h), Varda +1 bis +4 Tage (120 h, alle
            6 h).
          </p>
        </section>

        <p className="skewt-info-note">
          Verglichen wird die rohe Modellausgabe am Stationspunkt, nur auf die Stationshöhe
          gerechnet. Es ist kein MOS und keine statistische Nachkorrektur. Ein Modell, das hier
          systematisch daneben liegt, kann nach einer Biaskorrektur trotzdem brauchbar sein. Das
          zeigt der Versatz-Anteil der MSE-Zerlegung.
        </p>
      </div>
    </div>
  )
}
