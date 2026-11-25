import { Download, Film, Info, ScanLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDrop, InferenceFields, useMediaUrl } from '../components/Detection'
import { Metrics } from '../components/Occupancy'
import { Button, Empty, ErrorBox, Field, PageTitle, Panel, Spinner, useToast } from '../components/ui'
import { useData } from '../hooks/useData'
import { api, download, endpoint, upload } from '../services/api'
import type { Job, VideoMetadata } from '../types'
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
  const [previewMetadata, setPreviewMetadata] = useState<VideoMetadata | null>(null)
  const original = useMediaUrl(file)
  const toast = useToast()
  const { data: job, error: jobError, refresh } = useData<Job>(id ? '/api/jobs/' + id : null, 900, jobFinished)
  const complete = job?.status === 'completed'
  const busy = uploading || Boolean(id && !jobError && (!job || ['queued', 'processing'].includes(job.status)))
  const output = complete ? endpoint('/api/jobs/' + id + '/video') : ''
  const frame = complete ? job.frames.findLast(item => item.playback_seconds <= seconds + 0.01) || job.frames[0] : job?.latest
  const metadata = job?.metadata || previewMetadata
  const metadataError = metadata && (metadata.duration_seconds > 600 ? 'Durasi video maksimal 10 menit.' :
    metadata.width * metadata.height > 4096 * 4096 || Math.max(metadata.width, metadata.height) > 8192 ?
      'Resolusi video melebihi batas keamanan: maksimal 16.777.216 piksel per frame dan 8.192 piksel per sisi.' : '')

  useEffect(() => {
    if (!complete) return
    toast('Pemrosesan video selesai.')
  }, [complete, id, toast])

  function choose(next: File) {
    if (!/\.(mp4|avi|mov)$/i.test(next.name) || !next.size || next.size > 150 * 1024 * 1024) {
      setError('Pilih video MP4, AVI, atau MOV dengan ukuran hingga 150 MB.')
      return
    }
    setFile(next); setId(''); setSeconds(0); setOriginalError(false); setPreviewMetadata(null); setError('')
  }

  function readMetadata(video: HTMLVideoElement) {
    const { videoWidth: width, videoHeight: height, duration } = video
    if (!width || !height || !Number.isFinite(duration) || duration <= 0) return
    const scale = Math.min(1, (width >= height ? 1920 : 1080) / width, (width >= height ? 1080 : 1920) / height)
    const processing_width = Math.max(1, Math.floor(width * scale))
    const processing_height = Math.max(1, Math.floor(height * scale))
    setPreviewMetadata({ width, height, duration_seconds: duration, processing_width, processing_height,
      resized: width !== processing_width || height !== processing_height })
  }

  async function process() {
    if (!file || metadataError) return
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
    {(error || metadataError || jobError || job?.error) && <ErrorBox message={error || metadataError || jobError || job?.error || ''} retry={jobError ? refresh : undefined} />}
    <div className="workspace-grid">
      <Panel title="Video masukan"><FileDrop kind="video" file={file} choose={choose} disabled={busy} />
        <div className="video-resize-info" role="status">
          <p><Info size={18} aria-hidden="true" /><strong>Penyesuaian resolusi otomatis</strong></p>
          <p>Video beresolusi tinggi akan disesuaikan secara otomatis untuk mengoptimalkan proses deteksi tanpa mengubah rasio aspek video.</p>
          {metadata && <div className="info-lines">
            <div><span>Resolusi asli</span><strong>{metadata.width} × {metadata.height} px</strong></div>
            <div><span>Resolusi pemrosesan</span><strong>{metadata.processing_width} × {metadata.processing_height} px</strong></div>
            <div><span>Durasi video</span><strong>{stamp(metadata.duration_seconds)}</strong></div>
            <div><span>Ukuran file</span><strong>{((file?.size || 0) / (1024 * 1024)).toLocaleString('id-ID', { maximumFractionDigits: 2 })} MB</strong></div>
            <div><span>Status penyesuaian resolusi</span><strong>{metadata.resized ? 'Resolusi disesuaikan secara otomatis.' : 'Resolusi video sudah optimal. Penyesuaian tidak diperlukan.'}</strong></div>
          </div>}
        </div>
      </Panel>
      <Panel title="Pengaturan video"><InferenceFields options={options} set={setOptions} disabled={busy} />
        <Field label="Interval sampling"><select value={sampling} onChange={e => setSampling(Number(e.target.value))} disabled={busy}>
          {[1, 5, 10, 15, 30, 60, 120].map(value => <option key={value} value={value}>Setiap {value} frame</option>)}
        </select></Field>
        <Button type="button" className="panel-action stretch" onClick={process} disabled={!file || busy || Boolean(metadataError)}>{busy ? <Spinner /> : <ScanLine size={18} />}
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
          {original && !originalError ? <video src={original} key={original} controls playsInline preload="metadata" onLoadedMetadata={e => readMetadata(e.currentTarget)} onError={() => setOriginalError(true)} /> :
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
