import { Download, Film, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDrop, InferenceFields, useMediaUrl } from '../components/Detection'
import { Metrics } from '../components/Occupancy'
import { Button, Empty, ErrorBox, Field, PageTitle, Panel, Spinner, useToast } from '../components/ui'
import { useData } from '../hooks/useData'
import { api, download, endpoint, upload } from '../services/api'
import type { Job } from '../types'
import { defaults, elapsed, stamp } from '../utils'

const jobFinished = (job: Job) => job.status === 'completed' || job.status === 'error'

export function VideoDetection() {
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState(defaults)
  const [sampling, setSampling] = useState(10)
  const [id, setId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [originalError, setOriginalError] = useState(false)
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const original = useMediaUrl(file)
  const toast = useToast()
  const { data: job, error: jobError, refresh } = useData<Job>(id ? '/api/jobs/' + id : null, 900, jobFinished)
  const complete = job?.status === 'completed'
  const busy = uploading || Boolean(id && !jobError && (!job || ['queued', 'processing'].includes(job.status)))
  const output = complete ? endpoint('/api/jobs/' + id + '/video') : ''
  const frame = complete ? job.frames.findLast(item => item.playback_seconds <= seconds + 0.01) || job.frames[0] : job?.latest

  useEffect(() => {
    if (!complete) return
    toast('Pemrosesan video selesai.')
  }, [complete, id, toast])

  function choose(next: File) {
    if (!/\.(mp4|avi|mov)$/i.test(next.name) || !next.size || next.size > 150 * 1024 * 1024) {
      setError('Pilih video MP4, AVI, atau MOV dengan ukuran hingga 150 MB.')
      return
    }
    setFile(next); setId(''); setSeconds(0); setOriginalError(false); setError('')
  }

  async function process() {
    if (!file) return
    setUploading(true); setId(''); setSeconds(0); setError('')
    try {
      const data = await api<{ id: string }>('/api/detect/video', upload(file, options, { sample_every: sampling }))
      setId(data.id)
    } catch (reason) { setError((reason as Error).message) }
    finally { setUploading(false) }
  }

  const chart = job?.frames.map(row => ({ ...row, occupancy: row.occupancy == null ? null : row.occupancy * 100 })) ?? []
  return <>
    <PageTitle title="Deteksi Video" description="Analisis perubahan ketersediaan kursi dari frame video." />
    {(error || jobError || job?.error) && <ErrorBox message={error || jobError || job?.error || ''} retry={jobError ? refresh : undefined} />}
    <div className="workspace-grid">
      <Panel title="Video masukan"><FileDrop kind="video" file={file} choose={choose} disabled={busy} /></Panel>
      <Panel title="Pengaturan video"><InferenceFields options={options} set={setOptions} disabled={busy} />
        <Field label="Interval sampling"><select value={sampling} onChange={e => setSampling(Number(e.target.value))} disabled={busy}>
          {[1, 5, 10, 15, 30, 60, 120].map(value => <option key={value} value={value}>Setiap {value} frame</option>)}
        </select></Field>
        <Button type="button" className="panel-action stretch" onClick={process} disabled={!file || busy}>{busy ? <Spinner /> : <ScanLine size={18} />}
          {busy ? 'Memproses…' : 'Proses video'}</Button>
      </Panel>
    </div>
    {busy && <Panel title={uploading ? 'Mengunggah video' : job?.status === 'queued' ? 'Menunggu antrean' : 'Menganalisis frame'}>
      <progress value={job?.progress || 0} max={100} aria-label="Progres pemrosesan video" /><p className="muted">{job?.progress || 0}% · {job?.processed_frames || 0} frame dianalisis</p>
    </Panel>}
    <Panel title="Pratinjau dan hasil" action={complete && <Button variant="outline" onClick={async () => {
      try {
        const response = await fetch(output)
        if (!response.ok) throw new Error()
        const url = URL.createObjectURL(await response.blob())
        download(url, 'deteksi-video.mp4')
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      } catch { setError('Video hasil tidak dapat diunduh. Coba proses ulang.') }
    }}><Download size={17} /> Unduh MP4</Button>}>
      <div className="two-columns">
        <div className="comparison-item"><header><h3>Video asli</h3></header><div className="image-preview">
          {original && !originalError ? <video src={original} key={original} controls playsInline onError={() => setOriginalError(true)} /> :
            <Empty title={originalError ? 'Codec pratinjau tidak didukung' : 'Belum ada video'} detail={originalError ? 'Anda tetap dapat memproses video jika server mendukung codec.' : 'Pilih video untuk mulai.'} icon={<Film />} />}
        </div></div>
        <div className="comparison-item"><header><h3>Video beranotasi</h3></header><div className="image-preview">
          {output ? <video src={output} key={output} controls playsInline onTimeUpdate={e => setSeconds(e.currentTarget.currentTime)} onSeeked={e => setSeconds(e.currentTarget.currentTime)} /> :
            <Empty title="Belum ada video hasil" detail="Video beranotasi tersedia setelah pemrosesan selesai." icon={<ScanLine />} />}
        </div></div>
      </div>
    </Panel>
    {frame && <Panel title={'Frame ' + frame.frame + ' · ' + stamp(frame.seconds)} description={'Inferensi ' + elapsed(frame.elapsed_ms) + (job?.sample_every ? ' · Sampling setiap ' + job.sample_every + ' frame' : '')}>
      <Metrics summary={frame} /><p className="muted">Jumlah kursi dihitung pada setiap frame sampel. Ekspor MP4 diputar sesuai interval sampling dan tanpa audio.</p>
    </Panel>}
    {complete && <Panel title="Keterisian selama video" description="Persentase dan jumlah kursi tersedia pada setiap frame sampel.">
      <div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="seconds" type="number" tickFormatter={stamp} /><YAxis yAxisId="pct" domain={[0, 100]} tickFormatter={v => v + '%'} />
        <YAxis yAxisId="count" orientation="right" allowDecimals={false} /><Tooltip labelFormatter={value => stamp(Number(value))} /><Legend />
        <Line yAxisId="pct" dataKey="occupancy" name="Keterisian (%)" stroke="#0f766e" strokeWidth={3} dot={chart.length <= 20} isAnimationActive={false} />
        <Line yAxisId="count" dataKey="empty" name="Kursi tersedia" stroke="#6d4f8b" strokeWidth={2} dot={chart.length <= 20} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div>
    </Panel>}
  </>
}
