import { Download, Image as ImageIcon, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { DetectionTable, FileDrop, InferenceFields, Preview, useMediaUrl } from '../components/Detection'
import { Metrics } from '../components/Occupancy'
import { Button, Empty, ErrorBox, PageTitle, Panel, Spinner, Toggle, useToast } from '../components/ui'
import { api, download, downloadText, upload } from '../services/api'
import type { ImageResult } from '../types'
import { defaults, elapsed } from '../utils'

export function ImageDetection() {
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState(defaults)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [boxes, setBoxes] = useState(true)
  const [error, setError] = useState('')
  const original = useMediaUrl(file)
  const toast = useToast()

  function choose(next: File) {
    if (!/\.(jpe?g|png|webp)$/i.test(next.name) || !next.size || next.size > 20 * 1024 * 1024) {
      setError('Pilih gambar JPG, JPEG, PNG, atau WebP dengan ukuran hingga 20 MB.')
      return
    }
    setFile(next); setResult(null); setError('')
  }

  async function analyze() {
    if (!file) return
    setBusy(true); setError(''); setResult(null)
    try {
      const data = await api<ImageResult>('/api/detect/image', upload(file, options))
      setResult(data)
      toast(data.summary.total ? 'Analisis gambar selesai.' : 'Analisis selesai. Belum ada kursi terdeteksi.')
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }

  function exportRows(format: 'csv' | 'json') {
    if (!result) return
    const lines = ['id,kelas,status,confidence,x1,y1,x2,y2', ...result.rows.map(row =>
      [row.id, row.kelas, row.status, row.confidence, row.x1, row.y1, row.x2, row.y2].join(','))]
    if (format === 'csv') downloadText('\uFEFF' + lines.join('\r\n'), 'deteksi-gambar.csv', 'text/csv')
    else {
      const { annotated: _annotated, ...data } = result
      downloadText(JSON.stringify(data, null, 2), 'deteksi-gambar.json', 'application/json')
    }
  }

  return <>
    <PageTitle title="Deteksi Gambar" description="Analisis foto area belajar untuk menemukan kursi kosong dan terisi." />
    {error && <ErrorBox message={error} />}
    {result?.persistence_warning && <ErrorBox message={result.persistence_warning} />}
    <div className="workspace-grid">
      <Panel title="Gambar masukan"><FileDrop kind="image" file={file} choose={choose} disabled={busy} /></Panel>
      <Panel title="Pengaturan deteksi"><InferenceFields options={options} set={setOptions} disabled={busy} />
        <Button className="panel-action stretch" type="button" onClick={analyze} disabled={!file || busy}>
          {busy ? <Spinner /> : <ScanLine size={18} />}{busy ? 'Menganalisis…' : 'Analisis gambar'}</Button></Panel>
    </div>
    <Panel title="Perbandingan gambar" description={result ? elapsed(result.elapsed_ms) + ' · ' + result.device : 'Gambar asli dan hasil inferensi YOLO'} action={
      <Toggle label="Bounding box" checked={boxes} set={setBoxes} disabled={!result} />}>
      <div className="two-columns">
        <Preview src={original} label="Gambar asli" placeholder={<Empty title="Belum ada gambar" detail="Pilih gambar untuk melihat pratinjau." icon={<ImageIcon />} />} />
        <Preview src={result ? (boxes ? result.annotated : original) : undefined} label="Hasil deteksi"
          placeholder={<Empty title={busy ? 'Inferensi sedang berjalan' : 'Belum ada hasil'} detail={busy ? 'YOLO sedang menganalisis gambar.' : 'Jalankan analisis untuk melihat hasil.'} icon={busy ? <Spinner /> : <ScanLine />} />} />
      </div>
      {result && <div className="action-row">
        <Button variant="outline" onClick={() => download(result.annotated, 'deteksi-gambar.png')}><Download size={17} /> Gambar anotasi</Button>
        <Button variant="outline" onClick={() => exportRows('csv')}><Download size={17} /> CSV</Button>
        <Button variant="outline" onClick={() => exportRows('json')}><Download size={17} /> JSON</Button>
      </div>}
    </Panel>
    {result && <><Metrics summary={result.summary} /><Panel title="Rincian deteksi">
      {result.rows.length ? <DetectionTable rows={result.rows} /> : <Empty title="Belum ada kursi terdeteksi" detail="Coba foto yang lebih jelas atau sesuaikan confidence minimum." icon={<ScanLine />} />}
    </Panel></>}
  </>
}
