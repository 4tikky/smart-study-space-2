import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const report = JSON.parse(readFileSync(new URL('../../tools/onnx-validation.json', import.meta.url), 'utf8'))

test('WASM browser inference matches the real PyTorch image and exports an annotated PNG', async ({ page }) => {
  await page.goto('/tests/vision.html')
  await page.waitForFunction(() => Boolean((window as any).vision))
  for (const resolution of [320, 640]) {
    const result = await page.evaluate(async resolution => {
      const blob = await (await fetch('/library-study-room.webp')).blob()
      return (window as any).vision.detectImage(new File([blob], 'library.webp'), { device: 'cpu', resolution, confidence: 0.25 })
    }, resolution)
    const golden = report.comparisons.find((row: any) => row.fixture === 'landscape' && row.resolution === resolution && row.confidence === 0.25)
    expect(result.device).toBe('WebAssembly')
    expect(result.rows.length).toBe(golden.detections)
    expect(result.annotated).toMatch(/^data:image\/png;base64,/)
    const candidates = [...result.rows]
    for (const [x1, y1, x2, y2, confidence, classId] of golden.pytorch_rows) {
      const matching = candidates.filter((row: any) => row.kelas === (classId === 0 ? 'EmptyChair' : 'OccupiedChair'))
        .sort((a: any, b: any) => Math.abs(a.x1 - x1) + Math.abs(a.y1 - y1) - Math.abs(b.x1 - x1) - Math.abs(b.y1 - y1))
      expect(matching.length).toBeGreaterThan(0)
      const row = matching[0]
      for (const [actual, expected] of [[row.x1, x1], [row.y1, y1], [row.x2, x2], [row.y2, y2]]) expect(Math.abs(actual - expected)).toBeLessThan(3)
      expect(Math.abs(row.confidence - confidence)).toBeLessThan(0.03)
      candidates.splice(candidates.indexOf(row), 1)
    }
    expect(result.summary.total).toBe(result.summary.empty + result.summary.occupied)
  }
})

test('video processing sizes retain the original automatic resizing rules', async ({ page }) => {
  await page.goto('/tests/vision.html')
  await page.waitForFunction(() => Boolean((window as any).vision))
  const sizes = await page.evaluate(() => [[1280,720], [1920,1080], [2560,1440], [3840,2160], [2160,3840], [3000,1000], [641,431]]
    .map(([w,h]) => (window as any).vision.processingSize(w,h)))
  expect(sizes).toEqual([[1280,720], [1920,1080], [1920,1080], [1920,1080], [1080,1920], [1920,640], [641,431]])
})

test('automatic execution provider performs real inference or falls back to WASM', async ({ page }) => {
  await page.goto('/tests/vision.html'); await page.waitForFunction(() => Boolean((window as any).vision))
  const result = await page.evaluate(async () => {
    const blob = await (await fetch('/library-study-room.webp')).blob()
    return (window as any).vision.detectImage(new File([blob], 'library.webp'), { device: 'auto', resolution: 480, confidence: 0.25 })
  })
  const expected = report.comparisons.find((row: any) => row.fixture === 'landscape' && row.resolution === 480 && row.confidence === 0.25)
  expect(['WebGPU','WebAssembly']).toContain(result.device)
  expect(result.rows.length).toBe(expected.detections)
  console.log('Automatic inference provider:', result.device)
})
