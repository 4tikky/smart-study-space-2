import type { InferenceOptions, LiveFrame } from '../../types'
import { SessionTracker } from './core'
import { predict, warmup } from './engine'

export async function startCamera(deviceId: string, streamUrl: string | undefined, options: InferenceOptions,
  interval: number, onFrame: (frame: LiveFrame, preview: string) => Promise<void>, onError: (message: string) => void) {
  let active = true, timer = 0, stream: MediaStream | undefined
  const source = document.createElement('video')
  source.muted = true; source.playsInline = true; source.crossOrigin = 'anonymous'
  const canvas = document.createElement('canvas'), tracker = new SessionTracker()
  let previous = 0
  const stop = () => {
    active = false; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop())
    source.pause(); source.srcObject = null; source.removeAttribute('src'); source.load()
    canvas.width = canvas.height = 1
    document.removeEventListener('visibilitychange', hidden)
  }
  const fail = (message: string) => { if (active) { stop(); onError(message) } }
  function hidden() { if (document.hidden) fail('Pemantauan dihentikan karena tab tidak aktif. Buka kembali tab lalu mulai pemantauan.') }
  try {
    await warmup(options)
    if (streamUrl) {
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('RTSP/IP memerlukan media gateway dengan URL HTTPS yang dapat diputar browser dan izin CORS.')
      source.src = streamUrl
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Gunakan HTTPS dan browser yang mendukung akses kamera.')
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 15, max: 30 },
      } })
      source.srcObject = stream
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => fail('Akses kamera terputus. Hubungkan kembali perangkat lalu mulai pemantauan.'))
    }
    await source.play()
    document.addEventListener('visibilitychange', hidden)
    source.addEventListener('error', () => fail('Stream tidak dapat diputar. Periksa gateway, codec, HTTPS, dan izin CORS.'))
    async function capture() {
      if (!active) return
      const started = performance.now()
      try {
        if (!source.videoWidth) throw new Error('Browser belum menerima frame dari kamera.')
        const scale = Math.min(1, 960 / Math.max(source.videoWidth, source.videoHeight))
        canvas.width = Math.max(1, Math.round(source.videoWidth * scale)); canvas.height = Math.max(1, Math.round(source.videoHeight * scale))
        canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
        const result = await predict(canvas, options)
        if (!active) return
        const now = performance.now(), smoothed = tracker.update(result.rows)
        await onFrame({ ...result, smoothed, timestamp: new Date().toISOString(), fps: previous ? Math.round(10000 / (now - previous)) / 10 : null }, canvas.toDataURL('image/jpeg', 0.84))
        previous = now
        if (active) timer = window.setTimeout(capture, Math.max(0, interval - (performance.now() - started)))
      } catch (error) { fail((error as Error).message) }
    }
    timer = window.setTimeout(capture, 0)
    return stop
  } catch (error) { stop(); throw error }
}
