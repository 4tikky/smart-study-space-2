import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  testDir: './tests', timeout: 180000, workers: 1,
  testIgnore: '**/production.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5174', channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true,
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-video-capture=' + fileURLToPath(new URL('tests/fixtures/camera.y4m', import.meta.url))] } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --port 5174 --strictPort', env: { SSS_TEST: '1' }, url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 60000 },
})
