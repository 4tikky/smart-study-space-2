import { Activity, Armchair, CircleCheck, Users } from 'lucide-react'
import type { Availability, Summary } from '../types'
import { pct, statusLabel, units } from '../utils'

export function AvailabilityBadge({ status, label }: { status: Availability; label?: string }) {
  return <span className={'availability ' + status}><i />{label || statusLabel[status]}</span>
}

export function OccupancyBar({ occupancy, status }: { occupancy?: number | null; status?: Availability }) {
  return <div className={'occupancy-bar ' + (status || '')} role={occupancy == null ? undefined : 'progressbar'}
    aria-label="Tingkat keterisian" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={occupancy == null ? undefined : Math.round(occupancy * 100)}>
    {occupancy != null && <span style={{ width: pct(occupancy) }} />}
  </div>
}

export function Metrics({ summary }: { summary?: Summary | null }) {
  const metrics = [
    { name: 'Kursi terdeteksi', value: units(summary?.total), icon: Armchair, tone: 'teal' },
    { name: 'Kursi tersedia', value: units(summary?.empty), icon: CircleCheck, tone: 'green' },
    { name: 'Kursi terisi', value: units(summary?.occupied), icon: Users, tone: 'red' },
    { name: 'Tingkat keterisian', value: pct(summary?.occupancy), icon: Activity, tone: 'plum' },
  ]
  return <dl className="metrics">{metrics.map(({ name, value, icon: Icon, tone }) =>
    <div className="metric" key={name}><span className={'metric-icon ' + tone}><Icon size={21} strokeWidth={1.8} /></span>
      <div><dt>{name}</dt><dd>{value}</dd></div></div>)}</dl>
}
