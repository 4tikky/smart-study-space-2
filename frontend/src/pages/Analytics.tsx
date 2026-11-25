import { ChartNoAxesCombined, Clock3, Percent } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Empty, ErrorBox, Field, PageTitle, Panel, Skeleton } from '../components/ui'
import { useData } from '../hooks/useData'
import type { Analytics as AnalyticsData, AnalyticsPoint } from '../types'
import { dayRange } from '../utils'

const dateOptions = [{ label: 'Hari ini', days: 1 }, { label: '7 hari terakhir', days: 7 },
  { label: '30 hari terakhir', days: 30 }, { label: 'Rentang khusus', days: 0 }]
const format = (n: number | null) => n == null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'

function Bars({ data }: { data: AnalyticsPoint[] }) {
  return <div className="chart small-chart"><ResponsiveContainer width="100%" height="100%">
    <BarChart data={data}><CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tickFormatter={label => String(label).replace(/^\d /, '')} />
      <YAxis domain={[0, 100]} tickFormatter={value => value + '%'} /><Tooltip labelFormatter={label => String(label).replace(/^\d /, '')} />
      <Bar dataKey="occupancy" name="Keterisian (%)" fill="#0f766e" radius={[5, 5, 0, 0]} maxBarSize={32} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer></div>
}

export function Analytics() {
  const [preset, setPreset] = useState(7)
  const [range, setRange] = useState(() => dayRange(7))
  const ready = !!range.start && !!range.end && range.start <= range.end
  const { data, error, loading, refresh } = useData<AnalyticsData>(ready ? '/api/analytics?' + new URLSearchParams(range) : null)
  return <>
    <PageTitle title="Analitik" description="Pelajari pola keterisian dari riwayat kamera terdaftar." />
    <Panel title="Rentang waktu" description="Semua waktu menggunakan WIB.">
      <div className="action-row no-margin">{dateOptions.map(item => <Button key={item.days} variant={preset === item.days ? 'primary' : 'outline'}
        aria-pressed={preset === item.days} size="small" onClick={() => { setPreset(item.days); if (item.days) setRange(dayRange(item.days)) }}>{item.label}</Button>)}</div>
      {preset === 0 && <div className="two-columns compact analytics-range">
        <Field label="Dari tanggal"><input type="date" value={range.start} onChange={e => setRange({ ...range, start: e.target.value })} /></Field>
        <Field label="Sampai tanggal"><input type="date" value={range.end} min={range.start} onChange={e => setRange({ ...range, end: e.target.value })} /></Field>
      </div>}
    </Panel>
    {!ready && <ErrorBox message="Pilih rentang tanggal yang valid." />}
    {error && <ErrorBox message={error} retry={refresh} />}
    {loading && <Skeleton className="floor-skeleton" />}
    {data && (data.count && data.average != null ? <>
      <div className="operator-quick"><div><span className="metric-icon teal"><Percent size={20} /></span><span>Rata-rata keterisian<strong>{format(data.average)}</strong></span></div>
        <div><span className="metric-icon plum"><Clock3 size={20} /></span><span>Jam dengan rata-rata tertinggi<strong>{data.peak?.label || '—'} WIB · {format(data.peak?.occupancy ?? null)}</strong></span></div></div>
      <Panel title="Tren ketersediaan" description={data.count + ' pengamatan · Rata-rata per sampel kamera dalam setiap periode'}>
        <div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tickFormatter={value => String(value).slice(5)} />
          <YAxis yAxisId="pct" domain={[0, 100]} tickFormatter={value => value + '%'} />
          <YAxis yAxisId="count" orientation="right" /><Tooltip /><Legend />
          <Line dataKey="occupancy" yAxisId="pct" name="Keterisian (%)" stroke="#0f766e" strokeWidth={3} isAnimationActive={false} />
          <Line dataKey="empty" yAxisId="count" name="Kursi tersedia" stroke="#6d4f8b" strokeWidth={2} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div>
      </Panel>
      <div className="two-columns detail-columns">
        <Panel title="Perbandingan per lantai"><Bars data={data.floors} /></Panel>
        <Panel title="Keterisian menurut jam"><Bars data={data.hourly} /></Panel>
      </div>
      <Panel title="Pola menurut hari"><Bars data={data.daily} /></Panel>
    </> : <Panel><Empty title="Data pemantauan belum cukup" detail="Mulai pemantauan dari kamera terdaftar atau pilih rentang dengan catatan deteksi kursi." icon={<ChartNoAxesCombined />} /></Panel>)}
  </>
}
