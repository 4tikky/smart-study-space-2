import { test, expect } from '@playwright/test'
test('operator preview is shared locally across tabs and cleared when monitoring stops', async ({ page, context }) => {
  const overview = await context.newPage()
  for (const tab of [page, overview]) { await tab.goto('/tests/vision.html'); await tab.waitForFunction(() => Boolean((window as any).vision)) }
  await overview.evaluate(() => (window as any).vision.getLocalPreview())
  await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch('/library-study-room.webp')).blob())
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 214
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, 320, 214); bitmap.close()
    ;(window as any).vision.setLocalPreview({ image: canvas.toDataURL('image/jpeg'), name: 'Kamera pengujian', timestamp: new Date().toISOString() })
  })
  await expect.poll(() => overview.evaluate(() => (window as any).vision.getLocalPreview()?.name)).toBe('Kamera pengujian')
  await page.evaluate(() => (window as any).vision.setLocalPreview(null))
  await expect.poll(() => overview.evaluate(() => (window as any).vision.getLocalPreview())).toBeNull()
})
