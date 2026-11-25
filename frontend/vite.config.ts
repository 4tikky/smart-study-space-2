import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.SSS_BACKEND_URL || process.env.SSS_BACKEND_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: { '/api': { target: backend }, '/ws': { target: backend, ws: true } },
    },
    preview: { host: '127.0.0.1', port: 5173 },
  }
})
