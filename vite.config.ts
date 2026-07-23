import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gridProxyPlugin } from './server/plugin.ts'

// https://vite.dev/config/
// base: lokal '/'; GitHub-Project-Pages liegen unter /<repo>/ — der
// Deploy-Workflow setzt VITE_BASE entsprechend.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), gridProxyPlugin()],
})
