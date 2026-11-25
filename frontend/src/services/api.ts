import type { InferenceOptions } from '../types'
import { browserMode } from './runtime'
import { localVideoUrl } from './local-jobs'

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const endpoint = (path: string) => browserMode ? localVideoUrl(path) || path : base + path

export function liveUrl() {
  const url = new URL(endpoint('/ws/live-detection'), location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (browserMode) return await (await import('./cloud-api')).cloudApi(path, options) as T
  let response: Response
  try {
    response = await fetch(endpoint(path), { cache: 'no-store', ...options })
  } catch (error) {
    if (options?.signal?.aborted) throw error
    throw new Error('Server tidak dapat dijangkau. Periksa koneksi atau jalankan backend.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    const messages = Array.isArray(detail)
      ? detail.map(entry => entry.msg?.replace(/^Value error, /, '')).filter(Boolean).join(' ')
      : detail
    throw new Error(messages || 'Permintaan gagal. Server mungkin sedang tidak tersedia.')
  }
  if (response.status === 204) return undefined as T
  return await response.json()
}

export function json(method: string, data?: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }
}

export function upload(file: File, options: InferenceOptions, extra?: Record<string, number>) {
  const form = new FormData()
  form.append('file', file)
  for (const [key, value] of Object.entries({ ...options, ...extra })) form.append(key, String(value))
  return { method: 'POST', body: form }
}

export function download(url: string, filename: string) {
  const a = document.createElement('a')
  a.download = filename
  a.href = url
  a.click()
}

export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  download(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
