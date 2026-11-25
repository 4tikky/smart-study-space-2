import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({ ...base, testMatch: '**/production.spec.ts', testIgnore: [],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5175' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false, timeout: 60000 },
})
