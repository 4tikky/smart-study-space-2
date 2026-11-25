import { ChevronLeft, ChevronRight, Download, FileClock, Search } from 'lucide-react'
import { useState } from 'react'
import { DetectionTable } from '../components/Detection'
import { Metrics } from '../components/Occupancy'
import { Button, Empty, ErrorBox, Field, Modal, PageTitle, Panel, Skeleton, useToast } from '../components/ui'
import { useData } from '../hooks/useData'
import { api, download, downloadText, endpoint } from '../services/api'
import { browserMode } from '../services/runtime'
import type { Configuration, Detection, HistoryRecord } from '../types'
import { dateLabel, elapsed, pct, sourceLabel, stamp } from '../utils'

const initial = { q: '', start: '', end: '', source: '', floor: '', camera: '' }
const pageSize = 20
type HistoryDetail = HistoryRecord & { details: { rows?: Detection[]; width?: number; height?: number; device?: string
  sampled_frames?: number; sample_every?: number; duration_seconds?: number } | null }

export function History() {
  const [filters, setFilters] = useState(initial)
  const [page, setPage] = useState(0)
  const [current, setCurrent] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  const { data: config, error: configError, refresh: reloadConfig } = useData<Configuration>('/api/configuration')
  const { data, error, loading, refresh } = useData<{ items: HistoryRecord[]; count: number }>('/api/history?' + query + '&limit=' + pageSize + '&offset=' + page * pageSize)
  const detail = useData<HistoryDetail>(current ? '/api/history/' + current : null)
  const toast = useToast()

  function change(name: keyof typeof initial, value: string) {
    setFilters(old => ({ ...old, [name]: value })); setPage(0)
  }

  async function exportRecords() {
    setExporting(true)
    try {
      if (browserMode) {
        downloadText(await api<string>('/api/history/export?' + query), 'study-space-history.csv', 'text/csv;charset=utf-8')
        toast('CSV riwayat siap diunduh.'); return
      }
      const response = await fetch(endpoint('/api/history/export?' + query))
      if (!response.ok) throw new Error()
      const url = URL.createObjectURL(await response.blob())
      download(url, 'study-space-history.csv')
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast('CSV riwayat siap diunduh.')
    } catch (error) { toast((error as Error).message || 'Ekspor gagal. Periksa koneksi data.', true) }
    finally { setExporting(false) }
  }

  return <>
    <PageTitle title="Riwayat Deteksi" description="Telusuri deteksi gambar, video, dan sesi pemantauan." action={
      <Button variant="outline" onClick={exportRecords} disabled={!data?.count || exporting}><Download size={17} /> Ekspor CSV</Button>} />
    <Panel title="Cari dan filter">
      <div className="history-filters">
        <Field label="Pencarian"><span className="input-icon"><Search size={16} /><input type="search" placeholder="Sesi, lantai, zona, kamera" value={filters.q} onChange={e => change('q', e.target.value)} /></span></Field>
        <Field label="Dari tanggal"><input type="date" value={filters.start} onChange={e => change('start', e.target.value)} /></Field>
        <Field label="Sampai tanggal"><input type="date" value={filters.end} min={filters.start || undefined} onChange={e => change('end', e.target.value)} /></Field>
        <Field label="Sumber"><select value={filters.source} onChange={e => change('source', e.target.value)}><option value="">Semua sumber</option>
          {Object.entries(sourceLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Lantai"><select value={filters.floor} onChange={e => change('floor', e.target.value)}><option value="">Semua lantai</option>
          {config?.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></Field>
        <Field label="Kamera"><select value={filters.camera} onChange={e => change('camera', e.target.value)}><option value="">Semua kamera</option>
          {config?.cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></Field>
      </div>
      {configError && <ErrorBox message={configError} retry={reloadConfig} />}
      {!!query.size && <Button variant="ghost" size="small" onClick={() => { setFilters(initial); setPage(0) }}>Hapus filter</Button>}
    </Panel>
    <Panel title="Catatan deteksi" description={data ? data.count + ' catatan' : undefined}>
      {error && <ErrorBox message={error} retry={refresh} />}
      {loading && <Skeleton className="floor-skeleton" />}
      {data && (data.items.length ? <>
        <div className="table-wrap"><table><thead><tr><th>Waktu (WIB)</th><th>Sumber</th><th>Lokasi</th><th>Terdeteksi</th><th>Tersedia</th><th>Terisi</th><th>Keterisian</th><th>Inferensi</th><th><span className="sr-only">Tindakan</span></th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}><td>{dateLabel(item.timestamp)}</td><td>{sourceLabel[item.source]}</td>
            <td>{item.floor_name || '—'}{item.zone_name && <small className="table-secondary">{item.zone_name}</small>}</td>
            <td>{item.total}</td><td>{item.empty}</td><td>{item.occupied}</td><td>{pct(item.occupancy)}</td><td>{elapsed(item.elapsed_ms)}</td>
            <td><Button variant="ghost" size="small" onClick={() => setCurrent(item.id)}>Detail</Button></td></tr>)}</tbody></table></div>
        <div className="pagination"><span>{page * pageSize + 1}–{Math.min(data.count, (page + 1) * pageSize)} dari {data.count}</span>
          <Button variant="outline" size="icon" disabled={!page} onClick={() => setPage(n => n - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={17} /></Button>
          <Button variant="outline" size="icon" disabled={(page + 1) * pageSize >= data.count} onClick={() => setPage(n => n + 1)} aria-label="Halaman berikutnya"><ChevronRight size={17} /></Button></div>
      </> : <Empty title="Tidak ada catatan deteksi" detail={query.size ? 'Sesuaikan filter untuk memperluas pencarian.' : 'Jalankan deteksi atau mulai pemantauan untuk mengisi riwayat.'} icon={<FileClock />} />)}
    </Panel>
    <Modal open={!!current} onOpenChange={open => { if (!open) setCurrent(null) }} title="Detail deteksi" wide>
      {detail.error && <ErrorBox message={detail.error} retry={detail.refresh} />}
      {detail.loading && <Skeleton className="floor-skeleton" />}
      {detail.data && <><Metrics summary={detail.data} /><div className="info-lines">
        <div><span>ID sesi</span><strong className="break-anywhere">{detail.data.session_id}</strong></div>
        <div><span>Sumber</span><strong>{sourceLabel[detail.data.source]} · {detail.data.camera_name || 'Tanpa kamera terdaftar'}</strong></div>
        <div><span>Waktu</span><strong>{dateLabel(detail.data.timestamp)}</strong></div>
        <div><span>Waktu proses</span><strong>{elapsed(detail.data.elapsed_ms)}</strong></div>
        {detail.data.details?.sampled_frames != null && <div><span>Sampling video</span><strong>{detail.data.details.sampled_frames} frame · {stamp(detail.data.details.duration_seconds || 0)}</strong></div>}
      </div>{!!detail.data.details?.rows?.length && <DetectionTable rows={detail.data.details.rows} />}</>}
    </Modal>
  </>
}
