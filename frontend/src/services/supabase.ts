import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { browserMode } from './runtime'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = browserMode && url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 2 } },
}) : null

export function database() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY, lalu bangun ulang aplikasi.')
  return supabase
}

export function check<T>(result: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (result.error) {
    const code = result.error.code
    if (code === '42501') throw new Error('Akses ditolak. Masuk dengan akun operator yang telah diizinkan.')
    if (code === '23505') throw new Error('Nama, posisi zona, atau cakupan kamera aktif sudah digunakan.')
    if (code === '23503') throw new Error('Lantai atau zona masih digunakan, atau tidak ditemukan.')
    if (code === '23514' || code === '22P02') throw new Error('Nilai konfigurasi tidak valid. Periksa isian lalu coba lagi.')
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') throw new Error('Skema Supabase belum siap. Jalankan migrasi SQL proyek dan periksa konfigurasi Supabase.')
    if (/fetch|network/i.test(result.error.message)) throw new Error('Koneksi Supabase terputus. Periksa jaringan lalu coba lagi.')
    throw new Error(result.error.message)
  }
  return result.data as NonNullable<T>
}

type Listener = () => void
const listeners = new Set<Listener>()
let channel: RealtimeChannel | null = null, debounce = 0
export function notifyDataChanged() {
  clearTimeout(debounce)
  debounce = window.setTimeout(() => listeners.forEach(listener => listener()), 250)
}
export function subscribeDataChanged(listener: Listener) {
  if (!supabase) return () => {}
  listeners.add(listener)
  if (!channel) {
    channel = supabase.channel('public-availability')
    for (const table of ['camera_reports', 'floors', 'zones', 'cameras', 'app_settings']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, notifyDataChanged)
    }
    channel.subscribe(status => { if (status === 'SUBSCRIBED') notifyDataChanged() })
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && channel) { void supabase!.removeChannel(channel); channel = null; clearTimeout(debounce) }
  }
}

export async function operatorAllowed() {
  return Boolean(check(await database().rpc('is_operator')))
}
