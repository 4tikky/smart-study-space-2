import { Camera, Clock3, MapPinned, VideoOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Metrics, AvailabilityBadge } from '../components/Occupancy'
import { Button, Empty, ErrorBox, PageTitle, Panel, Skeleton } from '../components/ui'
import { useData } from '../hooks/useData'
import type { Operator } from '../types'
import { dateLabel, sourceLabel, units } from '../utils'

export function Overview() {
  const { data, error, loading, refresh } = useData<Operator>('/api/operator/monitoring', 3500)
  return <>
    <PageTitle title="Ringkasan" description="Pantau kondisi tempat belajar dan sumber kamera perpustakaan." action={
      <Button asChild><Link to="/operator/live"><Camera size={18} /> Mulai pemantauan</Link></Button>} />
    {error && <ErrorBox message={error} retry={refresh} />}
    {loading ? <Skeleton className="metrics-skeleton" /> : <Metrics summary={data?.summary} />}
    <div className="operator-quick">
      <div><span className="metric-icon teal"><Camera size={20} /></span><span>Sumber kamera aktif<strong>{units(data?.active_sources)}</strong></span></div>
      <div><span className="metric-icon teal"><Clock3 size={20} /></span><span>Deteksi terakhir<strong>{dateLabel(data?.last_detection?.timestamp)}</strong></span>
        {data?.last_detection && <span className="demo-tag">{sourceLabel[data.last_detection.source]}</span>}</div>
    </div>
    <div className="workspace-grid wide-left">
      <Panel title="Pratinjau pemantauan" description={data?.preview?.name || 'Tampilan kamera khusus operator'}>
        {loading ? <Skeleton className="monitor-display" /> : data?.preview ?
          <div className="monitor-display"><img src={data.preview.image} alt="Frame terbaru kamera aktif" /><span className="monitor-label">{dateLabel(data.preview.timestamp)}</span></div> :
          <div className="monitor-display is-empty"><Empty title="Belum ada kamera yang menayangkan" detail="Pilih sumber kamera dan mulai pemantauan untuk melihat hasil deteksi." icon={<VideoOff />} /></div>}
      </Panel>
      <Panel title="Zona terhubung" description="Ketersediaan menurut lantai">
        {data?.floors.length ? <div className="zone-list">{data.floors.map(floor =>
          <div key={floor.id}><div><strong>{floor.name}</strong><p>{floor.active_sources} dari {floor.configured_sources} kamera aktif · {floor.zones.length} zona</p></div>
            <AvailabilityBadge status={floor.status} label={floor.connection === 'online' ? 'Aktif' : 'Offline'} /></div>)}</div>
          : <Empty title="Belum ada sumber" detail="Tambahkan lantai, zona, dan kamera pada pengaturan." icon={<MapPinned />} />}
        <Button asChild variant="outline" className="panel-action"><Link to="/operator/settings">Kelola sumber kamera</Link></Button>
      </Panel>
    </div>
  </>
}
