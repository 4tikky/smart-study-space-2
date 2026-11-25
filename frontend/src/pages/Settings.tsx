import { Building2, Camera, Edit3, MapPin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Empty, ErrorBox, Field, Modal, PageTitle, Panel, Skeleton, Spinner, Toggle, useToast } from '../components/ui'
import { useData } from '../hooks/useData'
import { api, json } from '../services/api'
import type { Camera as CameraConfig, Configuration, FloorConfig, Settings as Preferences, ZoneConfig } from '../types'
import { browserMode } from '../services/runtime'

type FloorDraft = Omit<FloorConfig, 'id'> & { id?: number }
type ZoneDraft = Omit<ZoneConfig, 'id'> & { id?: number }
type CameraDraft = Omit<CameraConfig, 'id' | 'busy'> & { id?: number; stream_url: string }
type Editor = { type: 'floors'; value: FloorDraft } | { type: 'zones'; value: ZoneDraft } | { type: 'cameras'; value: CameraDraft }
type Collection = Editor['type']
const singular = { floors: 'lantai', zones: 'zona', cameras: 'kamera' }

export function Settings() {
  const { data, error, loading, refresh } = useData<Configuration>('/api/configuration')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deletion, setDeletion] = useState<{ type: Collection; id: number; name: string } | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [confirmRetention, setConfirmRetention] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const toast = useToast()

  useEffect(() => { if (data) setPrefs(data.settings) }, [data])
  function open(item: Editor) { setDialogError(''); setEditor(item) }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editor) return
    setBusy(true); setDialogError('')
    try {
      const path = '/api/' + editor.type + (editor.value.id ? '/' + editor.value.id : '')
      await api(path, json(editor.value.id ? 'PUT' : 'POST', editor.value))
      toast('Konfigurasi ' + singular[editor.type] + ' disimpan.')
      setEditor(null); refresh()
    } catch (reason) { setDialogError((reason as Error).message) }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!deletion) return
    setBusy(true); setDialogError('')
    try {
      await api('/api/' + deletion.type + '/' + deletion.id, { method: 'DELETE' })
      toast('Konfigurasi dihapus. Catatan riwayat tetap tersedia.'); setDeletion(null); refresh()
    } catch (reason) { setDialogError((reason as Error).message) }
    finally { setBusy(false) }
  }

  function requestSavePreferences(event: FormEvent) {
    event.preventDefault()
    if (!prefs || !data) return
    if (prefs.retention_days < data.settings.retention_days) setConfirmRetention(true)
    else void savePreferences()
  }

  async function savePreferences() {
    if (!prefs) return
    setBusy(true)
    try {
      await api('/api/settings', json('PUT', prefs))
      setConfirmRetention(false); toast('Pengaturan pemantauan disimpan.'); refresh()
    } catch (reason) { toast((reason as Error).message, true) }
    finally { setBusy(false) }
  }

  function actions(type: Collection, entity: { id: number; name: string }, edit: () => void) {
    return <div className="config-actions">
      <Button variant="ghost" size="icon" aria-label={'Edit ' + entity.name} title={'Edit ' + entity.name} onClick={edit}><Edit3 size={17} /></Button>
      <Button variant="ghost" size="icon" aria-label={'Hapus ' + entity.name} title={'Hapus ' + entity.name}
        onClick={() => { setDialogError(''); setDeletion({ type, id: entity.id, name: entity.name }) }}><Trash2 size={17} /></Button>
    </div>
  }

  const floorName = (id: number) => data?.floors.find(floor => floor.id === id)?.name || '—'
  const editorTitle = editor ? (editor.value.id ? 'Edit ' : 'Tambah ') + singular[editor.type] : ''
  const firstFloor = data?.floors[0]?.id || 0
  return <>
    <PageTitle title="Pengaturan" description="Konfigurasi lantai, zona belajar, sumber kamera, dan kebijakan retensi." />
    {error && <ErrorBox message={error} retry={refresh} />}
    {loading && <Skeleton className="floor-skeleton" />}
    {data && <>
      <div className="two-columns detail-columns">
        <Panel title="Lantai perpustakaan" action={<Button variant="outline" size="small" onClick={() => open({ type: 'floors', value: { name: '', description: '', enabled: true } })}><Plus size={16} /> Tambah lantai</Button>}>
          {data.floors.length ? <div className="config-list">{data.floors.map(floor => <div key={floor.id}>
            <span className="metric-icon teal"><Building2 size={19} /></span><div><strong>{floor.name}</strong><p>{floor.enabled ? 'Ditampilkan' : 'Disembunyikan'}{floor.description ? ' · ' + floor.description : ''}</p></div>
            {actions('floors', floor, () => open({ type: 'floors', value: floor }))}
          </div>)}</div> : <Empty title="Belum ada lantai" detail="Tambahkan lantai untuk mengatur cakupan pemantauan." icon={<Building2 />} />}
        </Panel>
        <Panel title="Zona belajar" action={<Button variant="outline" size="small" disabled={!firstFloor} onClick={() => open({ type: 'zones', value: {
          name: '', floor_id: firstFloor, description: '', outlets: null, layout_row: null, layout_col: null,
        } })}><Plus size={16} /> Tambah zona</Button>}>
          {data.zones.length ? <div className="config-list">{data.zones.map(zone => <div key={zone.id}>
            <span className="metric-icon teal"><MapPin size={19} /></span><div><strong>{zone.name}</strong><p>{floorName(zone.floor_id)}
              {zone.outlets != null ? ' · ' + zone.outlets + ' stopkontak' : ''}{zone.layout_row ? ' · Posisi ' + zone.layout_row + ',' + zone.layout_col : ''}</p></div>
            {actions('zones', zone, () => open({ type: 'zones', value: zone }))}
          </div>)}</div> : <Empty title="Belum ada zona" detail="Tambahkan area belajar yang bisa dipantau secara terpisah." icon={<MapPin />} />}
        </Panel>
      </div>
      <Panel title="Sumber kamera" description="Gunakan satu kamera aktif per lantai tanpa zona, atau satu kamera per zona dengan cakupan terpisah."
        action={<Button variant="outline" size="small" disabled={!firstFloor} onClick={() => open({ type: 'cameras', value: {
          name: '', floor_id: firstFloor, kind: 'browser', zone_id: null, enabled: true, interval_ms: 750, stream_url: '',
        } })}><Plus size={16} /> Tambah kamera</Button>}>
        {data.cameras.length ? <div className="config-list">{data.cameras.map(camera => <div key={camera.id}>
          <span className="metric-icon teal"><Camera size={19} /></span><div><strong>{camera.name}</strong><p>{floorName(camera.floor_id)}
            {camera.zone_id != null ? ' · ' + (data.zones.find(zone => zone.id === camera.zone_id)?.name || 'Zona') : ''}
            {' · ' + (camera.kind === 'browser' ? 'Webcam / USB' : 'RTSP / IP') + ' · ' + camera.interval_ms + ' ms'}</p></div>
          <span className={'availability ' + (camera.busy ? 'plenty' : 'unavailable')}><i />{camera.busy ? 'Dalam sesi' : camera.enabled ? 'Siap digunakan' : 'Nonaktif'}</span>
          {actions('cameras', camera, () => open({ type: 'cameras', value: { ...camera, stream_url: '' } }))}
        </div>)}</div> : <Empty title="Belum ada kamera terdaftar" detail="Daftarkan webcam atau URL kamera IP agar hasil bisa tampil di dasbor mahasiswa." icon={<Camera />} />}
      </Panel>
      {prefs && <Panel title="Ambang dan retensi" description="Catatan yang melewati masa retensi dihapus otomatis.">
        <form onSubmit={requestSavePreferences}>
          <div className="three-columns">
            <Field label="Mulai terbatas (%)"><input type="number" required min={1} max={99} value={prefs.limited_at} onChange={e => setPrefs({ ...prefs, limited_at: Number(e.target.value) })} /></Field>
            <Field label="Hampir penuh (%)"><input type="number" required min={1} max={100} value={prefs.full_at} onChange={e => setPrefs({ ...prefs, full_at: Number(e.target.value) })} /></Field>
            <Field label="Retensi riwayat (hari)"><input type="number" required min={1} max={3650} value={prefs.retention_days} onChange={e => setPrefs({ ...prefs, retention_days: Number(e.target.value) })} /></Field>
          </div>
          <Button className="panel-action" type="submit" disabled={busy}>{busy && <Spinner />} Simpan pengaturan</Button>
        </form>
      </Panel>}
    </>}
    <Modal open={!!editor} title={editorTitle} onOpenChange={value => { if (!value && !busy) setEditor(null) }}>
      {editor && <form onSubmit={save}>
        {dialogError && <ErrorBox message={dialogError} />}
        <Field label="Nama"><input required maxLength={100} value={editor.value.name} onChange={e => {
          const name = e.target.value
          if (editor.type === 'floors') setEditor({ ...editor, value: { ...editor.value, name } })
          if (editor.type === 'zones') setEditor({ ...editor, value: { ...editor.value, name } })
          if (editor.type === 'cameras') setEditor({ ...editor, value: { ...editor.value, name } })
        }} /></Field>
        {editor.type !== 'floors' && <Field label="Lantai"><select value={editor.value.floor_id} onChange={e => {
          const floor_id = Number(e.target.value)
          if (editor.type === 'zones') setEditor({ ...editor, value: { ...editor.value, floor_id } })
          else setEditor({ ...editor, value: { ...editor.value, floor_id, zone_id: null } })
        }}>{data?.floors.map(floor => <option value={floor.id} key={floor.id}>{floor.name}</option>)}</select></Field>}
        {editor.type !== 'cameras' && <Field label="Deskripsi"><textarea maxLength={240} value={editor.value.description} onChange={e => {
          const description = e.target.value
          if (editor.type === 'floors') setEditor({ ...editor, value: { ...editor.value, description } })
          else setEditor({ ...editor, value: { ...editor.value, description } })
        }} /></Field>}
        {editor.type === 'floors' && <Toggle label="Tampilkan di dasbor mahasiswa" checked={Boolean(editor.value.enabled)}
          set={enabled => setEditor({ ...editor, value: { ...editor.value, enabled } })} />}
        {editor.type === 'zones' && <div className="three-columns">
          <Field label="Stopkontak" help="Informasi fasilitas"><input type="number" min={0} max={1000} value={editor.value.outlets ?? ''} onChange={e => setEditor({ ...editor, value: {
            ...editor.value, outlets: e.target.value ? Number(e.target.value) : null,
          } })} /></Field>
          <Field label="Baris skema"><input type="number" min={1} max={12} value={editor.value.layout_row ?? ''} onChange={e => setEditor({ ...editor, value: {
            ...editor.value, layout_row: e.target.value ? Number(e.target.value) : null,
          } })} /></Field>
          <Field label="Kolom skema"><input type="number" min={1} max={6} value={editor.value.layout_col ?? ''} onChange={e => setEditor({ ...editor, value: {
            ...editor.value, layout_col: e.target.value ? Number(e.target.value) : null,
          } })} /></Field>
        </div>}
        {editor.type === 'cameras' && <>
          <Field label="Tipe kamera"><select value={editor.value.kind} onChange={e => setEditor({ ...editor, value: {
            ...editor.value, kind: e.target.value as CameraDraft['kind'], stream_url: '',
          } })}><option value="browser">Webcam browser / USB</option><option value="stream">Kamera IP / RTSP</option></select></Field>
          {editor.value.kind === 'stream' && <Field label={browserMode ? 'URL media gateway' : 'URL stream'} help={browserMode ? 'Browser memerlukan gateway HTTPS dengan codec yang didukung dan izin CORS. Kosongkan saat mengedit untuk mempertahankan URL.' : editor.value.id ? 'Kosongkan untuk mempertahankan URL tersimpan.' : 'RTSP, RTSPS, atau HTTP(S).'}><input
            type="password" autoComplete="off" required={!editor.value.id} maxLength={2048} value={editor.value.stream_url}
            onChange={e => setEditor({ ...editor, value: { ...editor.value, stream_url: e.target.value } })} /></Field>}
          <Field label="Zona"><select value={editor.value.zone_id ?? ''} onChange={e => setEditor({ ...editor, value: {
            ...editor.value, zone_id: e.target.value ? Number(e.target.value) : null,
          } })}>
            <option value="">Pemantauan tanpa zona</option>{data?.zones.filter(zone => zone.floor_id === editor.value.floor_id).map(zone => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></Field>
          <Field label="Interval inferensi (ms)"><input type="number" required min={250} max={10000} value={editor.value.interval_ms}
            onChange={e => setEditor({ ...editor, value: { ...editor.value, interval_ms: Number(e.target.value) } })} /></Field>
          <Toggle label="Izinkan pemantauan" checked={Boolean(editor.value.enabled)} set={enabled => setEditor({ ...editor, value: { ...editor.value, enabled } })} />
        </>}
        <div className="action-row"><Button type="submit" disabled={busy}>{busy && <Spinner />} Simpan</Button></div>
      </form>}
    </Modal>
    <Modal open={confirmRetention} title="Kurangi masa retensi?"
      detail={'Catatan yang lebih lama dari ' + (prefs?.retention_days ?? 0) + ' hari akan dihapus.'}
      onOpenChange={open => { if (!open && !busy) setConfirmRetention(false) }}>
      <div className="action-row">
        <Button variant="outline" autoFocus onClick={() => setConfirmRetention(false)} disabled={busy}>Batal</Button>
        <Button variant="danger" onClick={savePreferences} disabled={busy}>{busy && <Spinner />} Terapkan retensi</Button>
      </div>
    </Modal>
    <Modal open={!!deletion} title={'Hapus ' + (deletion?.name || 'konfigurasi') + '?'}
      detail={deletion?.type === 'floors' ? 'Lantai beserta zona dan sumber kamera yang terdaftar akan dihapus.' : 'Konfigurasi ini akan dihapus dari pemantauan.'}
      onOpenChange={open => { if (!open && !busy) setDeletion(null) }}>
      {dialogError && <ErrorBox message={dialogError} />}
      <div className="action-row"><Button variant="outline" autoFocus onClick={() => setDeletion(null)} disabled={busy}>Batal</Button>
        <Button variant="danger" onClick={remove} disabled={busy}>{busy && <Spinner />} Hapus</Button></div>
    </Modal>
  </>
}
