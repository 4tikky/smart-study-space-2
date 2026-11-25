import { useCallback, useEffect, useRef, useState } from 'react'
import type { Camera, InferenceOptions, LiveFrame } from '../types'
import { browserMode } from '../services/runtime'
import { cameraRpc, cameraSource, recordDetection, setLocalPreview } from '../services/cloud-data'
import { startCamera } from '../services/vision/camera'
import { warmup } from '../services/vision/engine'
import { useLegacyLive } from './useLegacyLive'

function useBrowserLive() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [frame, setFrame] = useState<LiveFrame | null>(null), [preview, setPreview] = useState(''), [error, setError] = useState('')
  const running = useRef<{ stop?: () => void; camera?: Camera; id: string } | null>(null)
  const close = useCallback(() => {
    const current = running.current; running.current = null
    current?.stop?.(); setLocalPreview(null)
    if (current?.camera) void cameraRpc('release_camera', current.camera.id, current.id).catch(() => {})
  }, [])
  useEffect(() => close, [close])
  const stop = () => { close(); setFrame(null); setPreview(''); setStatus('idle'); setError('') }
  async function start(camera: Camera | undefined, deviceId: string, options: InferenceOptions, interval: number) {
    close(); setStatus('connecting'); setError(''); setFrame(null); setPreview('')
    const current = { camera, id: crypto.randomUUID() } as NonNullable<typeof running.current>
    running.current = current
    let lastSync = 0, lastHistory = 0
    const fail = (message: string) => {
      if (running.current !== current) return
      close(); setStatus('error'); setError(message); setFrame(null); setPreview('')
    }
    try {
      const url = camera?.kind === 'stream' ? await cameraSource(camera.id) : undefined
      await warmup(options)
      if (running.current !== current) return
      if (camera) await cameraRpc('claim_camera', camera.id, current.id)
      if (running.current !== current) { if (camera) await cameraRpc('release_camera', camera.id, current.id); return }
      const stopSource = await startCamera(deviceId, url, options, interval, async (frame, preview) => {
        if (running.current !== current) return
        setFrame(frame); setPreview(preview); setStatus('live')
        setLocalPreview({ image: preview, name: camera?.name || 'Webcam lokal', timestamp: frame.timestamp })
        // Local inference retains the chosen cadence; only aggregates cross the network.
        if (camera && (!lastSync || performance.now() - lastSync >= 15000)) {
          await cameraRpc('publish_camera', camera.id, current.id, frame.smoothed, frame.elapsed_ms)
          lastSync = performance.now()
        } else if (!camera && (!lastHistory || performance.now() - lastHistory >= 60000)) {
          await recordDetection(current.id, 'live', frame.smoothed, frame.elapsed_ms); lastHistory = performance.now()
        }
      }, fail)
      if (running.current !== current) stopSource()
      else current.stop = stopSource
    } catch (reason) {
      const issue = reason as Error
      const known: Record<string,string> = { NotAllowedError: 'Izin kamera ditolak. Izinkan akses kamera di browser.',
        NotFoundError: 'Kamera tidak ditemukan. Sambungkan webcam atau gunakan kamera ponsel.', NotReadableError: 'Kamera sedang digunakan aplikasi lain.',
        OverconstrainedError: 'Perangkat kamera yang dipilih tidak tersedia.' }
      fail(known[issue.name] || issue.message || 'Kamera gagal diaktifkan.')
    }
  }
  return { status, frame, preview, error, start, stop }
}
export const useLive = browserMode ? useBrowserLive : useLegacyLive
