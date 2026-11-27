import { Armchair, Building2, Clock3, Layers3, Map, Plug, Radio, VideoOff } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { AvailabilityBadge, Metrics, OccupancyBar } from '../components/Occupancy'
import { Button, Empty, ErrorBox, Panel, Skeleton } from '../components/ui'
import type { useData } from '../hooks/useData'
import type { Floor, Occupancy } from '../types'
import { dateLabel, pct, timeLabel, units } from '../utils'

const connectionLabel = { online: 'Kamera aktif', offline: 'Kamera offline', unconfigured: 'Kamera belum dikonfigurasi' }

function FloorCard({ floor }: { floor: Floor }) {
  const missing = floor.summary == null
  return <article className="floor-card">
    <header><span className="floor-icon"><Layers3 size={22} strokeWidth={1.8} /></span>
      <AvailabilityBadge status={floor.status} label={missing ? (floor.connection === 'offline' ? 'Pemantauan offline' : undefined) : floor.summary?.total === 0 ? 'Kursi belum terdeteksi' : floor.summary?.occupancy === 1 ? 'Penuh' : undefined} /></header>
    <h3>{floor.name}</h3>
    <p className="floor-available"><strong>{units(floor.summary?.empty)}</strong> kursi tersedia</p>
    <div className="floor-track"><span>Keterisian</span><strong>{pct(floor.summary?.occupancy)}</strong></div>
    <OccupancyBar occupancy={floor.summary?.occupancy} status={floor.status} />
    <div className="floor-meta"><span>{units(floor.summary?.total)} kursi terdeteksi</span><span title={dateLabel(floor.last_updated)}><Clock3 size={13} />{timeLabel(floor.last_updated)}</span></div>
    <Button asChild variant="outline" className="floor-button"><Link to={'/lantai/' + floor.id}>Lihat detail<span className="sr-only"> {floor.name}</span></Link></Button>
  </article>
}

export function Student() {
  const { data, error, loading, refresh } = useOutletContext<ReturnType<typeof useData<Occupancy>>>()
  const reduced = useReducedMotion()
  return <motion.div initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
    <div className="student-context"><span><Building2 size={17} /> Perpustakaan Universitas Diponegoro</span>
      <span className={'context-system system-status ' + (data ? 'system-online' : '')}><i />{data ? 'Sistem aktif' : loading ? 'Memeriksa sistem' : 'Sistem offline'}</span>
      <span title={dateLabel(data?.last_updated)}><Clock3 size={16} /> Terakhir diperbarui <b>{timeLabel(data?.last_updated)}</b></span></div>
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <span className="hero-eyebrow"><span><Radio size={15} strokeWidth={2} /></span> Ketersediaan ruang belajar</span>
        <h1 id="hero-title">Temukan tempat<br className="hero-break" /> belajar <em>idealmu.</em></h1>
        <p>Cek ketersediaan kursi secara langsung sebelum berangkat ke perpustakaan.</p>
        <div className="hero-readout"><span className="hero-seat"><Armchair size={24} strokeWidth={1.8} /></span>
          <div className="hero-number"><strong>{units(data?.summary?.empty)}</strong><span>Kursi tersedia</span></div>
          <div className="hero-readout-divider" />
          <div className="hero-overall"><span>Keterisian keseluruhan</span><strong>{pct(data?.summary?.occupancy)}</strong></div>
        </div>
        {data && !data.summary && <span className="hero-data-state"><i /> Belum ada kamera aktif</span>}
      </div>
      <div className="hero-image"><img src="/foto-ruang-belajar.jpg" alt="Pengunjung belajar di meja panjang perpustakaan" fetchPriority="high" />
        <span className="photo-caption"><BookMark /> Ruang belajar perpustakaan</span></div>
    </section>
    {error && <ErrorBox message={error} retry={refresh} />}
    <div className="student-metrics">{loading ? <Skeleton className="metrics-skeleton" /> : <Metrics summary={data?.summary} />}</div>
    <section id="lantai" className="floor-section">
      <header className="section-heading"><div><h2>Ketersediaan per lantai</h2><p>Lihat kondisi ruang belajar di setiap lantai perpustakaan.</p></div>
        {data?.floors.length ? <span className="floor-counter"><Radio size={15} /> {data.monitored_floors} dari {data.floors.length} lantai terpantau</span> : null}</header>
      {loading ? <div className="floor-grid">{[1, 2, 3].map(value => <Skeleton key={value} className="floor-skeleton" />)}</div>
        : data?.floors.length ? <div className="floor-grid">{data.floors.map(floor => <FloorCard key={floor.id} floor={floor} />)}</div>
        : data && <Panel><Empty title="Belum ada lantai aktif" detail="Lantai akan muncul setelah operator mengaktifkannya." icon={<Layers3 />} /></Panel>}
    </section>
  </motion.div>
}

function BookMark() { return <span className="photo-caption-icon" aria-hidden="true"><Map size={13} /></span> }

export function FloorDetail() {
  const { id } = useParams()
  const { data, loading, error, refresh } = useOutletContext<ReturnType<typeof useData<Occupancy>>>()
  const floor = data?.floors.find(item => String(item.id) === id)
  const mapped = floor?.zones.filter(zone => zone.layout_row && zone.layout_col) ?? []
  return <>
    <div className="student-context floor-breadcrumb"><Link to="/#lantai"><Layers3 size={17} /> Daftar lantai</Link><span>{floor?.name || 'Detail lantai'}</span></div>
    {error && <ErrorBox message={error} retry={refresh} />}
    {loading && <Skeleton className="floor-skeleton" />}
    {data && !floor && <Panel><Empty title="Lantai tidak ditemukan" detail="Pilih lantai aktif dari daftar perpustakaan." /></Panel>}
    {floor && <>
      <div className="floor-detail-heading"><span className="floor-icon"><Layers3 /></span><div><h1>{floor.name}</h1>
        <p>{floor.description || 'Ketersediaan kursi dan zona belajar'}</p></div><AvailabilityBadge status={floor.status} /></div>
      <Metrics summary={floor.summary} />
      <div className="two-columns detail-columns">
        <Panel title="Pemantauan lantai"><div className="info-lines">
          <div><span>Koneksi kamera</span><strong>{connectionLabel[floor.connection]}</strong></div>
          <div><span>Area dengan data</span><strong>{floor.reporting_scopes} dari {floor.configured_scopes} area dikonfigurasi</strong></div>
          <div><span>Terakhir diperbarui</span><strong>{dateLabel(floor.last_updated)}</strong></div>
        </div><OccupancyBar occupancy={floor.summary?.occupancy} status={floor.status} /></Panel>
        <Panel title="Zona belajar">
          {floor.zones.length ? <div className="zone-list">{floor.zones.map(zone =>
            <div key={zone.id}><div><strong>{zone.name}</strong><p>{zone.description || connectionLabel[zone.connection]}</p>
              {zone.outlets != null && <small><Plug size={13} /> {zone.outlets} stopkontak</small>}</div>
              <div className="zone-total"><strong>{units(zone.summary?.empty)}</strong><small>tersedia</small></div></div>)}</div>
            : <Empty title="Belum ada zona" detail="Zona muncul saat operator menambahkan area belajar." icon={<VideoOff />} />}
        </Panel>
      </div>
      {!!mapped.length && <Panel title="Tata letak zona" description="Skema area belajar sesuai konfigurasi operator.">
        <div className="zone-map" style={{ gridTemplateColumns: 'repeat(' + Math.max(...mapped.map(zone => zone.layout_col || 1)) + ', minmax(92px, 1fr))' }}>
          {mapped.map(zone => <div key={zone.id} style={{ gridRow: zone.layout_row!, gridColumn: zone.layout_col! }}>
            <Map size={19} /><strong>{zone.name}</strong><small>{connectionLabel[zone.connection]}</small></div>)}
        </div></Panel>}
    </>}
  </>
}
