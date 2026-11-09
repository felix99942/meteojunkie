// Impressum und Datenschutz als eigene Seite, ohne Anmeldung erreichbar (`worker/auth.ts`).
// Dieselbe Komponente wie in der App, damit es nur eine Fassung des Textes gibt.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Impressum } from './components/Impressum'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app">
      <Impressum />
    </div>
  </StrictMode>,
)
