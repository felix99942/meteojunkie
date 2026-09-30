// Dokumentation der Kennzahlen im Skew-T: WIE sie hier gerechnet werden.
//
// Bewusst die Rechnung DIESER Seite, nicht die Lehrbuchdefinition: CAPE, CIN
// und DCAPE gibt es in mehreren Konventionen (Startpaket, Auftrieb über T
// oder Tv, Startniveau des Abwinds), und zwei Programme, die dieselbe
// Sondierung verschieden beziffern, rechnen meist schlicht verschieden. Wer
// die Zahlen mit einer anderen Quelle vergleicht, braucht genau diese
// Angaben. Quelle der Wahrheit ist `lib/sounding.ts` / `lib/thermo.ts` —
// jede Formel hier steht dort so im Code. Ändert sich dort das Verfahren,
// muss dieser Text mit.
//
// Formelsatz mit KaTeX. Die Komponente wird von `SkewTPanel` per React.lazy
// geladen: KaTeX samt Schriften kommt erst mit dem ersten Klick auf „Info",
// nicht mit der Seite.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo } from 'react'

/** Eine Formel; `block` = abgesetzt und zentriert, sonst im Fliesstext. */
function M({ t, block = false }: { t: string; block?: boolean }) {
  // Statische, eigene Zeichenketten — kein Nutzertext, daher unbedenklich.
  const html = useMemo(
    () => katex.renderToString(t, { displayMode: block, throwOnError: false }),
    [t, block],
  )
  return block ? (
    <div className="skewt-info-formula" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  )
}

const TOC: [string, string][] = [
  ['si-grund', 'Grundlagen'],
  ['si-cape', 'ML-CAPE'],
  ['si-cin', 'CIN'],
  ['si-dcape', 'DCAPE'],
  ['si-tw', 'Feuchtkugeltemperatur'],
]

export default function SoundingInfo({ onClose }: { onClose: () => void }) {
  // Esc schließt — das Fenster liegt über dem Diagramm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="skewt-info" role="dialog" aria-label="Wie die Kennzahlen gerechnet werden">
      <div className="skewt-info-head">
        <h2>Wie die Kennzahlen gerechnet werden</h2>
        <button type="button" className="skewt-info-close" onClick={onClose} title="Schließen (Esc)">
          ✕
        </button>
      </div>

      <div className="skewt-info-body">
        {/* Knöpfe statt #-Links: die sollen nur IM Fenster scrollen und
            weder die Adresse ändern noch die Seite verschieben. */}
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
        <section id="si-grund">
          <h3>Grundlagen</h3>
          <p>
            Das Profil beginnt am <b>Modellboden</b>, nicht bei 1000 hPa: Drucklevel unterhalb des
            Bodendrucks <M t="p_s" /> liegen im Gelände und werden verworfen; der Bodenpunkt aus
            2-m-Temperatur, 2-m-Feuchte und 10-m-Wind ist das unterste Niveau. Temperatur und
            Taupunkt werden linear in <M t="\ln p" /> auf ein <b>5-hPa-Gitter</b> interpoliert —
            auf diesem Gitter laufen alle Integrale (Trapezregel).
          </p>

          <h4>Feuchte</h4>
          <p>Sättigungsdampfdruck über Wasser (Bolton 1980) und Mischungsverhältnis:</p>
          <M block t="e_s(T) = 6{,}112\,\text{hPa}\cdot\exp\!\left(\frac{17{,}67\,T}{T + 243{,}5}\right) \qquad w = \varepsilon\,\frac{e}{p - e}" />
          <p>
            mit <M t="T" /> in °C, <M t="e = e_s(T_d)" /> und <M t="\varepsilon = R_d/R_v = 0{,}622" />.
          </p>

          <h4>Potentielle Temperatur und Virtualtemperatur</h4>
          <M block t="\theta = T\left(\frac{p_0}{p}\right)^{\kappa} \qquad T_v = T\,(1 + 0{,}608\,w)" />
          <p>
            mit <M t="p_0 = 1000\,\text{hPa}" />, <M t="\kappa = R_d/c_p \approx 0{,}2854" />,{' '}
            <M t="R_d = 287{,}04\,\text{J\,kg}^{-1}\text{K}^{-1}" />,{' '}
            <M t="c_p = 1005\,\text{J\,kg}^{-1}\text{K}^{-1}" />, <M t="T" /> in Kelvin und{' '}
            <M t="w" /> in kg/kg. <b>Der Auftrieb wird über <M t="T_v" /> gerechnet</b> — feuchte
            Luft ist bei gleicher Temperatur leichter. Gezeichnet sind die echten Temperaturen;
            deshalb beginnt die rote Fläche meist ein Stück über der LFC-Marke.
          </p>

          <h4>Hebungskondensationsniveau (LCL)</h4>
          <p>Bolton 1980, Gl. 15, Temperaturen in Kelvin; der Druck folgt aus der Erhaltung von θ:</p>
          <M block t="T_{\text{LCL}} = \frac{1}{\dfrac{1}{T_d - 56} + \dfrac{\ln(T/T_d)}{800}} + 56 \qquad p_{\text{LCL}} = p_0\left(\frac{T_{\text{LCL}}}{\theta}\right)^{1/\kappa}" />

          <h4>Feuchtadiabate</h4>
          <p>
            Oberhalb des LCL folgt ein gesättigtes Paket der Pseudoadiabate. Sie wird numerisch
            integriert (Runge-Kutta 4. Ordnung, Schritte von 5 hPa, aufwärts wie abwärts):
          </p>
          <M block t="\frac{dT}{dp} = \frac{1}{p}\cdot\frac{R_d\,T + L_v\,w_s}{c_p + \dfrac{L_v^2\,w_s\,\varepsilon}{R_d\,T^2}}" />
          <p>
            mit <M t="L_v = 2{,}501\cdot 10^{6}\,\text{J/kg}" /> und dem
            Sättigungsmischungsverhältnis <M t="w_s = w(e_s(T))" />.
          </p>
        </section>

        {/* --- ML-CAPE --------------------------------------------------- */}
        <section id="si-cape">
          <h3>ML-CAPE — Energie des Aufwinds</h3>
          <p>
            <b>1. Startpaket (ML, „mixed layer“).</b> θ und w werden über alle{' '}
            <M t="N" /> Profilniveaus in den untersten 100 hPa über Grund gemittelt und auf den
            Bodendruck gebracht:
          </p>
          <M block t="\bar\theta = \frac{1}{N}\sum_{p_i \,\ge\, p_s - 100\,\text{hPa}} \theta_i \qquad \bar w = \frac{1}{N}\sum_{p_i \,\ge\, p_s - 100\,\text{hPa}} w_i \qquad T_{\text{start}} = \bar\theta\left(\frac{p_s}{p_0}\right)^{\kappa}" />
          <p>
            Das glättet die bodennahe Schicht: das bodenbasierte Paket hängt an einem einzigen
            Wertepaar und meldet bei nächtlicher Inversion eine Stabilität, die nur die untersten
            Meter betrifft.
          </p>
          <p>
            <b>2. Heben.</b> Trockenadiabatisch (θ und w konstant) bis <M t="p_{\text{LCL}}" />,
            darüber entlang der Feuchtadiabate, gesättigt mit <M t="w = w_s" />.
          </p>
          <p>
            <b>3. Auftrieb</b> je Gitterpunkt, in J/kg je Einheit <M t="\ln p" />:
          </p>
          <M block t="B(p) = R_d\,\bigl(T_{v,\text{Paket}}(p) - T_{v,\text{Umgebung}}(p)\bigr)" />
          <p>
            <b>4. Niveaus.</b> Das <b>LFC</b> ist der erste Wechsel von <M t="B \le 0" /> zu{' '}
            <M t="B > 0" /> oberhalb des LCL; ist <M t="B" /> am LCL schon positiv (freie
            Konvektion), liegt das LFC auf dem LCL. Das <b>EL</b> ist der Wechsel zurück zu{' '}
            <M t="B \le 0" /> darüber, sonst die Profilspitze.
          </p>
          <p>
            <b>5. Integral</b> über die positiven Abschnitte zwischen LFC und EL:
          </p>
          <M block t="\text{CAPE} = \int_{p_{\text{EL}}}^{p_{\text{LFC}}} \max\bigl(B(p),\,0\bigr)\;d\ln p \quad\;[\text{J/kg}]" />
          <p className="skewt-info-note">
            SB-CAPE und MU-CAPE in der Tabelle laufen durch dieselbe Rechnung, nur mit anderem
            Startpaket: SB startet mit den Bodenwerten, MU von dem Profilniveau in den untersten
            300 hPa, dessen Paket die größte CAPE ergibt.
          </p>
        </section>

        {/* --- CIN ------------------------------------------------------- */}
        <section id="si-cin">
          <h3>CIN — die Sperre davor</h3>
          <p>
            Dasselbe gehobene ML-Paket; integriert wird die <b>negative</b> Auftriebsfläche vom
            Boden bis zum LFC:
          </p>
          <M block t="\text{CIN} = \int_{p_{\text{LFC}}}^{p_s} \min\bigl(B(p),\,0\bigr)\;d\ln p \;\le\; 0 \quad\;[\text{J/kg}]" />
          <p>
            Die Energie, die ein Paket mitbringen muss, bevor es von selbst weitersteigt.{' '}
            <b>Ohne LFC steht „–“</b> statt einer Zahl: gibt es kein Niveau freier Konvektion,
            gibt es auch keine Sperre zu überwinden — bis zur Profilspitze weiter summiert käme
            ein sinnloser Betrag von vielen tausend J/kg heraus. Setzt freie Konvektion schon am
            LCL ein, bleibt nur die Fläche zwischen Boden und LCL, oft 0.
          </p>
        </section>

        {/* --- DCAPE ----------------------------------------------------- */}
        <section id="si-dcape">
          <h3>DCAPE — Energie des Abwinds</h3>
          <p>
            Das Gegenstück zu CAPE: wie kräftig ein durch Verdunstung gekühlter Abwind am Boden
            ankommt. Hohe Werte bei trockener Mittelschicht sind das Kennzeichen für{' '}
            <b>Fallböen</b>. Verfahren nach der Konvention des SPC (Storm Prediction Center):
          </p>
          <p>
            <b>1. Startniveau</b> <M t="p_{\text{src}}" />: das Minimum der
            äquivalentpotentiellen Temperatur in den untersten 400 hPa über Grund — die
            „energieärmste“ Luft, aus der ein Abwind am ehesten stammt. θ<sub>e</sub> nach
            Bolton 1980, Gl. 43 (<M t="r" /> in g/kg, <M t="T_L = T_{\text{LCL}}" /> in K):
          </p>
          <M block t="\theta_e = T\left(\frac{p_0}{p}\right)^{\kappa\,(1 - 0{,}28\cdot10^{-3}\,r)} \!\cdot\, \exp\!\left[\left(\frac{3{,}376}{T_L} - 0{,}00254\right) r\,\bigl(1 + 0{,}81\cdot10^{-3}\,r\bigr)\right]" />
          <M block t="p_{\text{src}} = \operatorname*{arg\,min}_{\,p_s - 400\,\text{hPa} \,\le\, p \,\le\, p_s} \theta_e(p)" />
          <p>
            Liegt das Minimum am Boden, gibt es keinen Abwind zu rechnen.
          </p>
          <p>
            <b>2. Start</b> gesättigt bei der Feuchtkugeltemperatur dieses Niveaus,{' '}
            <M t="T_{\text{Paket}}(p_{\text{src}}) = T_w(p_{\text{src}})" /> — weiter kann
            Verdunstung die Luft nicht kühlen.
          </p>
          <p>
            <b>3. Absinken</b> entlang der Feuchtadiabate bis zum Boden; das Paket bleibt
            gesättigt, mitgeführtes Flüssigwasser wird nicht angerechnet.
          </p>
          <p>
            <b>4. Integral</b> über die Abschnitte, auf denen das Paket <b>kälter</b> ist als die
            Umgebung:
          </p>
          <M block t="\text{DCAPE} = \int_{p_{\text{src}}}^{p_s} \max\Bigl(R_d\,\bigl(T_{v,\text{Umgebung}} - T_{v,\text{Paket}}\bigr),\,0\Bigr)\;d\ln p \;\ge\; 0 \quad\;[\text{J/kg}]" />
          <p>
            Ein wärmerer Abschnitt bremst den Abwind und wird bewusst nicht gegengerechnet.
          </p>
        </section>

        {/* --- Feuchtkugel ----------------------------------------------- */}
        <section id="si-tw">
          <h3>Feuchtkugeltemperatur <M t="T_w" /></h3>
          <p>
            Die Temperatur, auf die Verdunstung die Luft abkühlen <b>kann</b>. Sie liegt immer
            zwischen Taupunkt und Temperatur, <M t="T_d \le T_w \le T" />, und fällt bei
            Sättigung mit beiden zusammen. Gerechnet nach der <b>Regel von Normand</b>: vom Punkt
            trockenadiabatisch hinauf zum LCL, von dort feuchtadiabatisch zurück auf den
            Ausgangsdruck:
          </p>
          <M block t="(p,\,T,\,T_d)\;\xrightarrow{\;\theta,\ w\ \text{konstant}\;}\;(p_{\text{LCL}},\,T_{\text{LCL}})\;\xrightarrow{\;\text{Feuchtadiabate}\;}\;(p,\,T_w)" />
          <p>
            Beide Schritte sind die Bausteine von oben (LCL nach Bolton, numerische
            Feuchtadiabate), <M t="T_w" /> erbt also deren Genauigkeit. Kontrollwert:{' '}
            <M t="T = 20\,°\text{C},\ T_d = 10\,°\text{C},\ p = 1000\,\text{hPa} \;\Rightarrow\; T_w = 13{,}98\,°\text{C}" />
            , wie in der Psychrometertafel.
          </p>
          <p>
            Die Kurve wird an jedem Profilniveau so bestimmt. Daraus stammt die Zeile{' '}
            <b>„0 °C feucht“</b> der Tabelle — die Höhe, in der <M t="T_w" /> durch 0 °C geht. Für
            die Schneefallgrenze ist sie die entscheidende Nullgradgrenze: fallender Schnee kühlt
            ungesättigte Luft durch Schmelzen und Verdunsten auf <M t="T_w" /> ab und überlebt
            deshalb bis etwa dorthin.
          </p>
        </section>

        <p className="skewt-info-note">
          Alle Kennzahlen kommen aus den Rohdaten des gewählten Modells an diesem Punkt — keine
          Beobachtung, keine Nachbearbeitung. Liefert ein Modell weniger Drucklevel (ECMWF ohne
          975/950/900/800 hPa), ist die Grenzschicht gröber aufgelöst, und die Zahlen weichen
          entsprechend ab.
        </p>
      </div>
    </div>
  )
}
