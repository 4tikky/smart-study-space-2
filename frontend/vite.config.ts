import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
const deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const securityHeaders = Object.fromEntries(deployment.headers[0].headers.map((header: { key: string; value: string }) => [header.key, header.value]))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.SSS_BACKEND_URL || process.env.SSS_BACKEND_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' as const },
    server: {
      host: '127.0.0.1',
      port: 5173,
      hmr: process.env.SSS_TEST ? false : undefined,
      proxy: (env.VITE_RUNTIME || process.env.VITE_RUNTIME) === 'legacy' ? { '/api': { target: backend }, '/ws': { target: backend, ws: true } } : undefined,
    },
    preview: { host: '127.0.0.1', port: 5173, headers: securityHeaders },
  }
})
