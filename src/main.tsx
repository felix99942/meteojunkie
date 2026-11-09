import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { SERIES_GC_TIME_MS, SERIES_STALE_TIME_MS } from './api/queries.ts'

// Lange staleTime als Default: Modellläufe ändern sich nur alle 1–6 h,
// permanentes Refetching wäre Verschwendung (SPEC §6).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: SERIES_STALE_TIME_MS,
      gcTime: SERIES_GC_TIME_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
