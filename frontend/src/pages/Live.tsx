import { Camera, Maximize2, Play, Radio, Square, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { InferenceFields } from '../components/Detection'
import { Metrics } from '../components/Occupancy'
import { Button, Empty, ErrorBox, Field, PageTitle, Panel, Spinner, Toggle } from '../components/ui'
import { useData } from '../hooks/useData'
import { useLive } from '../hooks/useLive'
import type { Camera as CameraConfig } from '../types'
import { defaults, elapsed, timeLabel } from '../utils'

export function Live() {
  const { data: cameras, error: camerasError, refresh } = useData<CameraConfig[]>('/api/cameras')
  const [cameraId, setCameraId] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [options, setOptions] = useState(defaults)
  const [interval, setIntervalMs] = useState(750)
  const [boxes, setBoxes] = useState(true)
  const monitor = useRef<HTMLDivElement>(null)
  const live = useLive()
  const running = live.status === 'live' || live.status === 'connecting'
  const selectedCamera = cameras?.find(camera => String(camera.id) === cameraId)
  const isStream = selectedCamera?.kind === 'stream'

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const refreshDevices = () => {
      void navigator.mediaDevices.enumerateDevices().then(all => setDevices(all.filter(device => device.kind === 'videoinput'))).catch(() => {})
    }
    refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [live.status])

  const stateLabel = { idle: 'Offline', connecting: 'Menghubungkan', live: 'Terhubung', error: 'Terputus' }[live.status]
  return <>
    <PageTitle title="Pemantauan Langsung" description="Jalankan inferensi YOLO berulang dari webcam atau stream kamera." />
    {camerasError && <ErrorBox message={camerasError} retry={refresh} />}
    {live.error && <ErrorBox message={live.error} />}
    <div className="workspace-grid wide-left">
      <Panel title="Tampilan kamera" description={selectedCamera?.name || 'Webcam lokal'} action={
        <span className={'availability ' + (live.status === 'live' ? 'plenty' : 'unavailable')}><i />{stateLabel}</span>}>
        <div ref={monitor} className={'monitor-display live-display' + (!live.preview ? ' is-empty' : '')}>
          {live.preview && live.frame ? <div className="live-frame" style={{ aspectRatio: live.frame.width + ' / ' + live.frame.height }}>
            <img src={live.preview} alt="Frame terbaru dari sumber pemantauan" />
            {boxes && <svg viewBox={'0 0 ' + live.frame.width + ' ' + live.frame.height} aria-hidden="true">
              {live.frame.rows.map(row => {
                const color = row.kelas === 'EmptyChair' ? '#22c55e' : '#ef4444'
                const label = row.status + ' #' + row.track_id
                return <g key={row.id}><rect x={row.x1} y={row.y1} width={Math.max(0, row.x2 - row.x1)}
                  height={Math.max(0, row.y2 - row.y1)} fill="none" stroke={color} strokeWidth="2.5" />
                  <rect x={row.x1} y={Math.max(0, row.y1 - 19)} width={label.length * 7.2} height={19} fill={color} />
                  <text x={row.x1 + 4} y={Math.max(0, row.y1 - 19) + 14} fill="#0f172a" fontSize="12" fontWeight="700">{label}</text></g>
              })}
            </svg>}
          </div> : <Empty title={running ? 'Sedang menghubungkan kamera' : 'Kamera belum aktif'}
            detail={running ? 'Tunggu sampai frame pertama selesai dianalisis.' : 'Pilih sumber, lalu mulai pemantauan.'} icon={running ? <Spinner /> : <VideoOff />} />}
        </div>
        <div className="live-toolbar"><Toggle label="Bounding box" checked={boxes} set={setBoxes} />
          <span><Radio size={15} /> {live.frame?.fps ?? '—'} FPS</span><span>{elapsed(live.frame?.elapsed_ms)} inferensi</span>
          <Button variant="outline" size="icon" className="fullscreen-button" disabled={!live.frame} aria-label="Layar penuh" title="Layar penuh"
            onClick={() => { void monitor.current?.requestFullscreen?.().catch(() => {}) }}><Maximize2 size={16} /></Button></div>
      </Panel>
      <Panel title="Sumber dan inferensi">
        <Field label="Sumber pemantauan" help={selectedCamera ? 'Hasil dari sumber terdaftar dapat muncul pada tampilan mahasiswa.' : 'Webcam lokal hanya memperbarui riwayat dan tampilan operator.'}>
          <select disabled={running} value={cameraId} onChange={e => {
            setCameraId(e.target.value)
            setIntervalMs(cameras?.find(camera => String(camera.id) === e.target.value)?.interval_ms || 750)
          }}><option value="">Webcam lokal · tanpa penetapan</option>
            {cameras?.map(camera => <option key={camera.id} value={camera.id} disabled={!camera.enabled}>{camera.name}{camera.enabled ? '' : ' · Nonaktif'}</option>)}
          </select>
        </Field>
        {!isStream && <Field label="Perangkat kamera">
          <select value={deviceId} onChange={e => setDeviceId(e.target.value)} disabled={running}>
            <option value="">Kamera default</option>{devices.filter(device => device.deviceId).map((device, index) =>
              <option key={device.deviceId} value={device.deviceId}>{device.label || 'Kamera ' + (index + 1)}</option>)}
          </select>
        </Field>}
        <InferenceFields options={options} set={setOptions} disabled={running} />
        <Field label="Interval inferensi (ms)" help="Nilai lebih tinggi mengurangi beban CPU.">
          <input type="number" min={250} max={10000} step={1} value={Number.isNaN(interval) ? '' : interval}
            disabled={running} onChange={e => setIntervalMs(e.target.valueAsNumber)} />
        </Field>
        {running ? <Button variant="danger" className="stretch panel-action" onClick={live.stop}><Square size={16} /> Hentikan pemantauan</Button> :
          <Button className="stretch panel-action" disabled={!Number.isInteger(interval) || interval < 250 || interval > 10000}
            onClick={() => { void live.start(selectedCamera, deviceId, options, interval) }}><Play size={17} /> Mulai pemantauan</Button>}
        <Button variant="ghost" asChild className="stretch panel-action"><Link to="/operator/settings"><Camera size={16} /> Kelola sumber kamera</Link></Button>
      </Panel>
    </div>
    <Panel title="Ketersediaan saat ini" description={live.frame ? 'Diperbarui ' + timeLabel(live.frame.timestamp) : 'Menunggu hasil dari sumber kamera'}>
      <Metrics summary={live.frame?.smoothed} />
      <p className="muted">Ringkasan menggunakan tiga frame terbaru. ID pelacakan berlaku selama sesi kamera ini.</p>
    </Panel>
  </>
}
