import { useCallback, useEffect, useRef, useState } from 'react'
import { liveUrl } from '../services/api'
import type { Camera, InferenceOptions, LiveFrame } from '../types'

type Status = 'idle' | 'connecting' | 'live' | 'error'
type Session = { socket?: WebSocket; stream?: MediaStream; timer?: number; pendingUrl?: string; shownUrl?: string }

export function useLive() {
  const [status, setStatus] = useState<Status>('idle')
  const [frame, setFrame] = useState<LiveFrame | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const session = useRef<Session | null>(null)

  const close = useCallback(() => {
    const running = session.current
    session.current = null
    if (!running) return
    clearTimeout(running.timer)
    running.stream?.getTracks().forEach(track => track.stop())
    if (running.socket?.readyState === WebSocket.OPEN) running.socket.send('stop')
    running.socket?.close()
    if (running.pendingUrl) URL.revokeObjectURL(running.pendingUrl)
    if (running.shownUrl) URL.revokeObjectURL(running.shownUrl)
  }, [])

  useEffect(() => close, [close])

  const fail = (message: string) => {
    close()
    setFrame(null); setPreview(''); setStatus('error'); setError(message)
  }

  const stop = () => {
    close()
    setFrame(null); setPreview(''); setStatus('idle'); setError('')
  }

  async function start(camera: Camera | undefined, deviceId: string, options: InferenceOptions, interval: number) {
    close()
    const running: Session = {}
    session.current = running
    setStatus('connecting'); setError(''); setFrame(null); setPreview('')
    const browser = camera?.kind !== 'stream'
    const source = document.createElement('video')
    source.muted = true
    source.playsInline = true
    const canvas = document.createElement('canvas')
    let sentAt = 0
    const readyDeadline = performance.now() + 10000

    function capture() {
      if (!running.socket || session.current !== running || running.socket.readyState !== WebSocket.OPEN) return
      if (!source.videoWidth) {
        if (performance.now() > readyDeadline) {
          fail('Browser belum menerima frame dari webcam.')
          return
        }
        clearTimeout(running.timer)
        running.timer = window.setTimeout(capture, 150)
        return
      }
      const scale = Math.min(1, 960 / Math.max(source.videoWidth, source.videoHeight))
      canvas.width = Math.max(1, Math.round(source.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(source.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) { fail('Browser tidak dapat menyiapkan frame kamera.'); return }
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      watchdog()
      canvas.toBlob(blob => {
        if (session.current !== running || running.socket?.readyState !== WebSocket.OPEN) return
        if (!blob) { fail('Frame kamera tidak dapat dikodekan.'); return }
        running.pendingUrl = URL.createObjectURL(blob)
        sentAt = performance.now()
        running.socket.send(blob)
      }, 'image/jpeg', 0.84)
    }

    function watchdog() {
      clearTimeout(running.timer)
      running.timer = window.setTimeout(() => {
        if (session.current === running) fail('Waktu tunggu kamera habis. Periksa koneksi dan coba lagi.')
      }, Math.max(25000, interval * 3))
    }

    try {
      if (browser) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Buka aplikasi melalui localhost atau HTTPS untuk mengakses kamera.')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 960 }, height: { ideal: 540 } },
          audio: false,
        })
        if (session.current !== running) { stream.getTracks().forEach(track => track.stop()); return }
        running.stream = stream
        source.srcObject = stream
        await source.play()
        for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
          if (session.current === running) fail('Akses kamera terputus. Pilih sumber dan hubungkan kembali.')
        })
      }
      if (session.current !== running) return
      const socket = new WebSocket(liveUrl())
      running.socket = socket
      watchdog()
      socket.onopen = () => socket.send(JSON.stringify({ ...options, camera_id: camera?.id, interval_ms: interval }))
      socket.onerror = () => { if (session.current === running) fail('Koneksi pemantauan gagal. Pastikan backend sedang berjalan.') }
      socket.onclose = () => { if (session.current === running) fail('Koneksi pemantauan terputus. Mulai kembali untuk menyambung.') }
      socket.onmessage = event => {
        if (session.current !== running) return
        const message = JSON.parse(event.data) as LiveFrame & { type: string; message?: string }
        if (message.type === 'error') { fail(message.message || 'Pemantauan gagal.'); return }
        if (message.type === 'ready') {
          if (browser) capture()
          else watchdog()
          return
        }
        if (message.type !== 'frame') return
        clearTimeout(running.timer)
        if (browser && running.pendingUrl) {
          if (running.shownUrl) URL.revokeObjectURL(running.shownUrl)
          running.shownUrl = running.pendingUrl
          running.pendingUrl = undefined
          setPreview(running.shownUrl)
          running.timer = window.setTimeout(capture, Math.max(0, interval - (performance.now() - sentAt)))
        } else { setPreview(message.image || ''); watchdog() }
        setFrame(message); setStatus('live')
      }
    } catch (reason) {
      if (session.current !== running) return
      const issue = reason as Error
      const known: Record<string, string> = {
        NotAllowedError: 'Izin kamera ditolak. Izinkan akses kamera di browser lalu coba lagi.',
        NotFoundError: 'Tidak ada webcam yang terdeteksi. Sambungkan kamera lalu coba lagi.',
        NotReadableError: 'Kamera sedang digunakan aplikasi lain atau tidak dapat dibaca.',
        OverconstrainedError: 'Kamera yang dipilih sudah tidak tersedia.',
      }
      fail(known[issue.name] || issue.message || 'Kamera gagal diaktifkan.')
    }
  }

  return { status, frame, preview, error, start, stop }
}
