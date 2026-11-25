import { Armchair, Camera, Cpu, Database, Focus, LayoutDashboard, SlidersHorizontal } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, ErrorBox, Field, Modal, PageTitle, Panel, Skeleton, Spinner, useToast } from '../components/ui'
import { useData } from '../hooks/useData'
import { api, json } from '../services/api'
import type { Metadata, MetadataKey, ModelInfo } from '../types'

const fields: [MetadataKey, string][] = [['dataset_size', 'Total dataset'], ['train_size', 'Data pelatihan'],
  ['validation_size', 'Data validasi'], ['test_size', 'Data pengujian'], ['epochs', 'Epoch'],
  ['precision', 'Precision'], ['recall', 'Recall'], ['f1', 'F1-score'], ['map50', 'mAP@50'], ['map5095', 'mAP@50–95']]
const pipeline = [{ name: 'Gambar atau kamera', Icon: Camera }, { name: 'Prapemrosesan', Icon: SlidersHorizontal },
  { name: 'Inferensi YOLO', Icon: Cpu }, { name: 'Bounding box', Icon: Focus }, { name: 'Hitung kursi', Icon: Armchair },
  { name: 'Dasbor', Icon: LayoutDashboard }]

export function Model() {
  const { data, error, loading, refresh } = useData<ModelInfo>('/api/model/info', 5000)
  const [draft, setDraft] = useState<Metadata | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const toast = useToast()
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true); setSaveError('')
    try {
      await api('/api/model/metadata', json('PUT', draft))
      setDraft(null); refresh(); toast('Metadata disimpan.')
    } catch (reason) { setSaveError((reason as Error).message) }
    finally { setSaving(false) }
  }
  return <>
    <PageTitle title="Informasi Model" description="Arsitektur, konfigurasi inferensi, dan referensi evaluasi." />
    {error && <ErrorBox message={error} retry={refresh} />}
    {loading && <Skeleton className="floor-skeleton" />}
    {data && <>
      <Panel title={data.architecture} description={data.file} action={
        <span className={'availability ' + (data.status === 'ready' ? 'plenty' : 'unavailable')}><i />{{ ready: 'Model siap', loading: 'Model sedang dimuat', error: 'Model gagal dimuat' }[data.status]}</span>}>
        <div className="info-lines model-facts">
          <div><span>Kelas model</span><strong>{data.classes.join(' · ')}</strong></div>
          <div><span>Confidence default</span><strong>{data.defaults.confidence}</strong></div>
          <div><span>Resolusi default</span><strong>{data.defaults.resolution} px</strong></div>
          <div><span>Perangkat saat ini</span><strong>{data.device || '—'}</strong></div>
        </div>
      </Panel>
      <Panel title="Alur deteksi"><div className="pipeline">{pipeline.map(({ name, Icon }) => <div key={name}><span><Icon size={23} /></span><strong>{name}</strong></div>)}</div></Panel>
      <Panel title="Metadata pelatihan" description="Isi nilai berdasarkan laporan pelatihan atau evaluasi yang dapat diverifikasi."
        action={<Button variant="outline" onClick={() => { setDraft({ ...data.metadata }); setSaveError('') }}><Database size={17} /> Edit metadata</Button>}>
        <div className="info-lines model-facts">
          {fields.map(([key, label], index) => <div key={key}><span>{label}</span><strong>
            {data.metadata[key] == null ? 'Tidak tersedia' : index >= 5 ? (data.metadata[key]! * 100).toLocaleString('id-ID') + '%' : data.metadata[key]!.toLocaleString('id-ID')}
          </strong></div>)}
          <div><span>Referensi</span><strong className="break-anywhere">{data.metadata.reference || 'Tidak tersedia'}</strong></div>
        </div>
      </Panel>
    </>}
    <Modal title="Edit metadata pelatihan" detail="Masukkan metrik sebagai nilai 0 sampai 1 dan sertakan referensinya." open={!!draft}
      onOpenChange={open => { if (!open && !saving) setDraft(null) }} wide>
      {draft && <form onSubmit={save}>
        {saveError && <ErrorBox message={saveError} />}
        <div className="two-columns compact">{fields.map(([key, label], index) => <Field label={label} key={key}>
          <input type="number" min={key === 'epochs' ? 1 : 0} max={index >= 5 ? 1 : undefined}
            step={index >= 5 ? 'any' : 1} value={draft[key] ?? ''} onChange={e => setDraft({ ...draft, [key]: e.target.value ? Number(e.target.value) : null })} />
        </Field>)}</div>
        <Field label="Referensi laporan"><input value={draft.reference} maxLength={500} onChange={e => setDraft({ ...draft, reference: e.target.value })} /></Field>
        <div className="action-row"><Button disabled={saving} type="submit">{saving && <Spinner />} Simpan metadata</Button></div>
      </form>}
    </Modal>
  </>
}
