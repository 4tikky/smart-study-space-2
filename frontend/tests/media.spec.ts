import { test, expect } from '@playwright/test'

test('browser video processing preserves sampling, resizing, timing and MP4/WebM exports', async ({ page }) => {
  await page.goto('/tests/vision.html'); await page.waitForFunction(() => Boolean((window as any).vision))
  for (const [width, height] of [[1280,720], [1920,1080], [2560,1440], [3840,2160], [2160,3840], [3000,1000], [641,431]]) {
    const result = await page.evaluate(async ({width, height}) => {
      const v = (window as any).vision
      const blob = await (await fetch(`/tests/fixtures/${width}x${height}.mp4`)).blob()
      const updates: any[] = []
      const result = await v.processVideo(new File([blob], 'input.mp4'), { device: 'cpu', resolution: 320, confidence: 0.25 }, 2,
        (update: any) => updates.push(update), new AbortController().signal, width === 1280)
      return { ...result, blob: undefined, output: await v.inspectOutput(result.blob), updates }
    }, {width, height})
    const scale = Math.min(1, (width >= height ? 1920 : 1080) / width, (width >= height ? 1080 : 1920) / height)
    const w = Math.floor(width * scale), h = Math.floor(height * scale)
    expect(result.output.width).toBe(w + w % 2); expect(result.output.height).toBe(h + h % 2)
    expect(result.output.duration).toBeCloseTo(1, 2)
    expect(result.output.stats.packetCount).toBe(1)
    expect(result.frames.length).toBe(1); expect(result.frames[0].frame).toBe(1)
    expect(result.frames[0].playback_seconds).toBe(0)
    expect(result.extension).toBe(width === 1280 ? 'webm' : 'mp4')
    expect(result.frames[0].total).toBe(result.frames[0].empty + result.frames[0].occupied)
  }
})

test('browser rejects corrupted and excessive-duration videos', async ({ page }) => {
  await page.goto('/tests/vision.html'); await page.waitForFunction(() => Boolean((window as any).vision))
  const errors = await page.evaluate(async () => {
    const errors: string[] = []
    const long = await (await fetch('/tests/fixtures/long.mp4')).blob()
    for (const file of [new File(['corrupt'], 'corrupt.mp4'), new File([long], 'long.mp4')]) {
      try { await (window as any).vision.openVideo(file) } catch (error) { errors.push((error as Error).message) }
    }
    return errors
  })
  expect(errors).toHaveLength(2); expect(errors[1]).toContain('10 menit')
})

test('camera frames use real inference and stable session tracking', async ({ page }) => {
  await page.goto('/tests/vision.html'); await page.waitForFunction(() => Boolean((window as any).vision))
  const frames = await page.evaluate(async () => new Promise<any[]>(async (resolve, reject) => {
    const frames: any[] = []
    let stop: () => void
    try {
      stop = await (window as any).vision.startCamera('', undefined, { device: 'cpu', resolution: 320, confidence: 0.25 }, 250,
        async (frame: any) => { frames.push(frame); if (frames.length === 3) { stop(); resolve(frames) } }, reject)
    } catch (error) { reject(error) }
  }))
  expect(frames).toHaveLength(3); expect(frames[0].summary.total).toBeGreaterThan(0)
  expect(frames[0].rows.map((r: any) => r.track_id)).toEqual(frames[1].rows.map((r: any) => r.track_id))
  expect(frames[2].smoothed.total).toBe(frames[2].smoothed.empty + frames[2].smoothed.occupied)
})
