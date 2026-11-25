import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
const worker = readdirSync(new URL('../dist/assets/', import.meta.url)).find(name => /^inference\.worker-.*\.js$/.test(name))!
const reference = JSON.parse(readFileSync(new URL('../../tools/onnx-validation.json', import.meta.url), 'utf8'))

test('static production bundle protects operator routes and makes no FastAPI requests', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => { if (/\/api\/|:8000\/|\/ws\//.test(request.url())) apiRequests.push(request.url()) })
  await page.goto('/operator/video')
  await expect(page).toHaveURL(/\/masuk$/)
  await expect(page.getByRole('heading', { name: 'Masuk operator' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Mode operator/ })).toBeVisible()
  expect(apiRequests).toEqual([])
})

test('production worker executes real ONNX under the deployment CSP', async ({ page }) => {
  const violations: string[] = []
  page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()) })
  await page.goto('/masuk')
  const result = await page.evaluate(async workerFile => {
    const bitmap = await createImageBitmap(await (await fetch('/library-study-room.webp')).blob())
    const worker = new Worker('/assets/' + workerFile, { type: 'module' })
    try { return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Production inference timeout')), 120000)
      worker.onmessage = event => { clearTimeout(timer); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result) }
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
      worker.postMessage({ id: 1, bitmap, options: { confidence: 0.25, resolution: 320, device: 'cpu' } }, [bitmap])
    }) } finally { worker.terminate() }
  }, worker)
  const expected = reference.comparisons.find((row: any) => row.fixture === 'landscape' && row.resolution === 320 && row.confidence === 0.25)
  expect(result.rows.length).toBe(expected.detections)
  expect(result.device).toBe('WebAssembly')
  expect(violations).toEqual([])
})
