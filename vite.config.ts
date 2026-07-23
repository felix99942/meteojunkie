import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gridProxyPlugin } from './server/plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gridProxyPlugin()],
})
