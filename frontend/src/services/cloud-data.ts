import type { Camera, HistoryRecord, Metadata, Summary } from '../types'
import { buildOccupancy, type Snapshot } from './availability'
import { check, database, notifyDataChanged } from './supabase'

export const emptyMetadata: Metadata = { dataset_size: null, train_size: null, validation_size: null, test_size: null, epochs: null,
  precision: null, recall: null, f1: null, map50: null, map5095: null, reference: '' }
export let localPreview: { image: string; name: string; timestamp: string } | null = null
let previewChannel: BroadcastChannel | undefined, lastPreviewSent = 0
function previewBus() {
  if (!previewChannel && typeof BroadcastChannel !== 'undefined') {
    previewChannel = new BroadcastChannel('smart-study-operator-preview')
    previewChannel.onmessage = event => {
      if (event.data?.type === 'request') {
        if (localPreview && Date.parse(localPreview.timestamp) > Date.now() - 10000) previewChannel!.postMessage({ type: 'preview', value: localPreview })
      } else if (event.data?.type === 'preview') {
        const value = event.data.value
        if (value === null || typeof value?.image === 'string' && value.image.startsWith('data:image/jpeg;base64,') && value.image.length < 700000 && typeof value.name === 'string' && Number.isFinite(Date.parse(value.timestamp))) {
          localPreview = value; notifyDataChanged()
        }
      }
    }
    previewChannel.postMessage({ type: 'request' })
  }
  return previewChannel
}
export function setLocalPreview(value: typeof localPreview) {
  localPreview = value
  if (!value || !lastPreviewSent || performance.now() - lastPreviewSent >= 3000) {
    previewBus()?.postMessage({ type: 'preview', value }); lastPreviewSent = value ? performance.now() : 0
  }
}
export function getLocalPreview() {
  previewBus()
  return localPreview && Date.parse(localPreview.timestamp) > Date.now() - 10000 ? localPreview : null
}

export async function recordDetection(session: string, source: 'image' | 'video' | 'live', summary: Summary, elapsed: number, details: object | null = null) {
  const id = check(await database().rpc('record_detection', { p_session: session, p_source: source, p_summary: summary, p_elapsed: elapsed, p_details: details }))
  notifyDataChanged()
  return Number(id)
}
export async function cameraRpc(action: 'claim_camera' | 'release_camera' | 'publish_camera', id: number, session: string, summary?: Summary, elapsed?: number) {
  check(await database().rpc(action, { p_camera: id, p_session: session, ...(summary ? { p_summary: summary, p_elapsed: elapsed } : {}) }))
  notifyDataChanged()
}
export async function cameraSource(id: number) {
  const row = check(await database().from('camera_sources').select('stream_url').eq('camera_id', id).single())
  return row.stream_url as string
}

function historyQuery(params: URLSearchParams) {
  let query = database().from('history').select('id,session_id,timestamp,source,floor_id,floor_name,zone_name,camera_id,camera_name,total,empty,occupied,occupancy,elapsed_ms', { count: 'exact' })
  const start = params.get('start'), end = params.get('end')
  if (start && end && start > end) throw new Error('Tanggal awal harus sebelum tanggal akhir.')
  if (start) query = query.gte('timestamp', start + 'T00:00:00+07:00')
  if (end) query = query.lte('timestamp', end + 'T23:59:59.999+07:00')
  for (const [param, column] of [['source','source'], ['floor','floor_id'], ['camera','camera_id']]) {
    const value = params.get(param); if (value) query = query.eq(column, value)
  }
  const q = params.get('q')?.replace(/[(),."\\%_]/g, ' ').trim().slice(0, 100)
  if (q) query = query.or(['session_id','floor_name','zone_name','camera_name'].map(column => `${column}.ilike.%${q}%`).join(','))
  return query.order('timestamp', { ascending: false }).order('id', { ascending: false })
}
function csv(records: HistoryRecord[]) {
  const fields = ['id','session_id','timestamp','source','floor_id','floor_name','zone_name','camera_id','camera_name','total','empty','occupied','occupancy','elapsed_ms'] as (keyof HistoryRecord)[]
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value)
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"','""') + '"'
  }
  return '\uFEFF' + [fields.join(','), ...records.map(row => fields.map(field => cell(row[field])).join(','))].join('\r\n')
}

export async function cloudData(path: string, options?: RequestInit): Promise<unknown> {
  const url = new URL(path, location.origin), route = url.pathname.replace('/api/', ''), params = url.searchParams
  const method = options?.method || 'GET', db = database()
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) : undefined
  if (route === 'occupancy' || route === 'floors' && method === 'GET' || route === 'operator/monitoring') {
    const started = Date.now()
    const occupancy = buildOccupancy(check(await db.rpc('public_snapshot')) as Snapshot, started)
    if (route === 'floors') return occupancy.floors
    if (route === 'operator/monitoring') {
      const last = check(await db.from('history').select('*').order('timestamp', { ascending: false }).limit(1))
      return { ...occupancy, preview: getLocalPreview(), last_detection: last[0] || null }
    }
    return occupancy
  }
  if (route === 'configuration') {
    const results = await Promise.all(['floors','zones','cameras','app_settings'].map(table => db.from(table).select('*').order('id')))
    const [floors, zones, cameraRows, settings] = results.map(result => check(result))
    const leases = check(await db.from('camera_leases').select('camera_id,expires_at'))
    const cameras = cameraRows.map(row => ({ ...row, busy: leases.some(lease => lease.camera_id === row.id && Date.parse(lease.expires_at) > Date.now()) }))
    return { floors, zones, cameras, settings: settings[0] }
  }
  if (route === 'cameras' && method === 'GET') return ((await cloudData('/api/configuration')) as { cameras: Camera[] }).cameras
  if (route === 'settings') {
    if (method === 'PUT') {
      const result = check(await db.from('app_settings').update({ limited_at: body.limited_at, full_at: body.full_at, retention_days: body.retention_days }).eq('id', 1).select().single())
      check(await db.rpc('prune_history')); notifyDataChanged(); return result
    }
    return check(await db.from('app_settings').select('*').eq('id', 1).single())
  }
  if (route === 'model/metadata') {
    if (method === 'PUT') {
      if (Object.entries(body).some(([key,value]) => key !== 'reference' && value != null) && !body.reference?.trim()) throw new Error('Cantumkan referensi laporan pelatihan atau evaluasi.')
      check(await db.from('training_metadata').update({ value: body }).eq('id', 1)); return body
    }
    return { ...emptyMetadata, ...check(await db.from('training_metadata').select('value').eq('id', 1).single()).value }
  }
  if (route === 'history/export') {
    const rows: HistoryRecord[] = []
    for (let offset = 0; ; offset += 500) {
      const response = await historyQuery(params).range(offset, offset + 499)
      const batch = check(response) as HistoryRecord[]
      if ((response.count || 0) > 20000) throw new Error('Ekspor maksimal 20.000 catatan. Persempit rentang tanggal atau filter.')
      rows.push(...batch)
      if (batch.length < 500) return csv(rows)
    }
  }
  if (route === 'history') {
    const limit = Math.max(1, Math.min(200, Number(params.get('limit')) || 30)), offset = Math.max(0, Number(params.get('offset')) || 0)
    const response = await historyQuery(params).range(offset, offset + limit - 1)
    return { items: check(response), count: response.count || 0 }
  }
  if (/^history\/\d+$/.test(route)) return check(await db.from('history').select('*').eq('id', Number(route.split('/')[1])).single())
  if (route === 'analytics') {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
    const start = new Date(Date.now() + 7 * 3600000 - 6 * 86400000).toISOString().slice(0, 10)
    return check(await db.rpc('get_analytics', { p_start: params.get('start') || start, p_end: params.get('end') || today }))
  }
  const match = /^(floors|zones|cameras)(?:\/(\d+))?$/.exec(route)
  if (match && method !== 'GET') {
    const table = match[1], id = match[2] && Number(match[2])
    if (method === 'DELETE') { check(await db.from(table).delete().eq('id', id)); notifyDataChanged(); return }
    if (table === 'cameras') {
      const result = check(await db.rpc('save_camera', { p_camera: body, p_id: id || null })); notifyDataChanged(); return result
    }
    const fields = table === 'floors' ? ['name','description','enabled'] : ['name','floor_id','description','outlets','layout_row','layout_col']
    const values = Object.fromEntries(fields.filter(field => field in body).map(field => [field, body[field]]))
    const result = check(await (id ? db.from(table).update(values).eq('id', id) : db.from(table).insert(values)).select().single())
    notifyDataChanged(); return result
  }
  throw new Error('Operasi tidak tersedia: ' + route)
}
