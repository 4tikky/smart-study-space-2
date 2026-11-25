import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Availability, InferenceOptions } from './types'

export function cn(...values: ClassValue[]) { return twMerge(clsx(values)) }

const timezone = 'Asia/Jakarta'
const clock = new Intl.DateTimeFormat('id-ID', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
const date = new Intl.DateTimeFormat('id-ID', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })
export const timeLabel = (value?: string | null) => value ? clock.format(new Date(value)).replace('.', ':') + ' WIB' : '—'
export const dateLabel = (value?: string | null) => value ? date.format(new Date(value)) + ' WIB' : '—'
export const pct = (value?: number | null) => value == null ? '—' : Math.round(value * 100) + '%'
export const units = (value?: number | null) => value == null ? '—' : Math.round(value).toLocaleString('id-ID')
export const elapsed = (value?: number | null) => value == null ? '—' : Math.round(value).toLocaleString('id-ID') + ' ms'
export const stamp = (seconds: number) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0')
export const statusLabel: Record<Availability, string> = {
  plenty: 'Banyak kursi tersedia', limited: 'Kursi terbatas', full: 'Hampir penuh', unavailable: 'Pemantauan belum tersedia',
}
export const sourceLabel = { image: 'Gambar', video: 'Video', live: 'Pemantauan langsung' }
export const defaults: InferenceOptions = { confidence: 0.25, resolution: 640, device: 'cpu' }

export function dayRange(days: number) {
  const offset = new Date(Date.now() + 7 * 3600 * 1000)
  const end = offset.toISOString().slice(0, 10)
  offset.setUTCDate(offset.getUTCDate() - days + 1)
  return { start: offset.toISOString().slice(0, 10), end }
}
