// Formelsatz für die Info-Fenster (Sounding, Verifikation). KaTeX zieht samt
// Schriften ~82 KB gzip — deshalb nur aus Komponenten importieren, die selbst
// per React.lazy geladen werden.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

/** Eine Formel; `block` = abgesetzt und zentriert, sonst im Fliesstext. */
export function M({ t, block = false }: { t: string; block?: boolean }) {
  // Statische, eigene Zeichenketten — kein Nutzertext, daher unbedenklich.
  const html = useMemo(() => katex.renderToString(t, { displayMode: block, throwOnError: false }), [t, block])
  return block ? (
    <div className="skewt-info-formula" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  )
}
