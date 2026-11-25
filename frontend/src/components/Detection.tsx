import { CloudUpload, ImageUp, Maximize2, Minus, Plus, Video } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Detection, InferenceOptions } from '../types'
import { pct } from '../utils'
import { Button, Field, Modal } from './ui'

export function FileDrop({ kind, file, choose, disabled }: {
  kind: 'image' | 'video'; file: File | null; choose: (file: File) => void; disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const id = useId()
  const isImage = kind === 'image'
  const Icon = file ? (isImage ? ImageUp : Video) : CloudUpload
  return <div className={'file-drop' + (dragging ? ' dragging' : '')} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
    onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled && e.dataTransfer.files[0]) choose(e.dataTransfer.files[0]) }}>
    <span className="empty-icon"><Icon size={25} /></span>
    <strong>{file?.name || (isImage ? 'Tarik gambar ke sini' : 'Tarik video ke sini')}</strong>
    <p id={id}>{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB' : isImage ? 'JPG, JPEG, PNG, atau WebP · Maks. 20 MB' : 'MP4, AVI, atau MOV · Maks. 150 MB dan 10 menit'}</p>
    <input ref={input} type="file" hidden accept={isImage ? '.jpg,.jpeg,.png,.webp' : '.mp4,.avi,.mov'} onChange={e => {
      if (e.target.files?.[0]) choose(e.target.files[0])
      e.target.value = ''
    }} />
    <Button variant="outline" size="small" type="button" disabled={disabled} aria-describedby={id} onClick={() => input.current?.click()}>{file ? 'Ganti file' : 'Pilih file'}</Button>
  </div>
}

export function useMediaUrl(file: File | null) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) { setUrl(''); return }
    const address = URL.createObjectURL(file)
    setUrl(address)
    return () => URL.revokeObjectURL(address)
  }, [file])
  return url
}

export function InferenceFields({ options, set, disabled }: {
  options: InferenceOptions; set: (options: InferenceOptions) => void; disabled?: boolean
}) {
  return <>
    <Field label={'Confidence minimum · ' + options.confidence.toFixed(2)} help="Prediksi di bawah ambang ini disaring.">
      <input type="range" min="0.05" max="0.95" step="0.05" value={options.confidence} disabled={disabled}
        onChange={e => set({ ...options, confidence: Number(e.target.value) })} />
    </Field>
    <div className="two-columns compact">
      <Field label="Resolusi inferensi"><select value={options.resolution} disabled={disabled} onChange={e => set({ ...options, resolution: Number(e.target.value) })}>
        {[320, 480, 640, 800, 960].map(size => <option key={size} value={size}>{size} px</option>)}
      </select></Field>
      <Field label="Perangkat"><select value={options.device} disabled={disabled} onChange={e => set({ ...options, device: e.target.value as InferenceOptions['device'] })}>
        <option value="cpu">CPU</option><option value="auto">Otomatis</option>
      </select></Field>
    </div>
  </>
}

export function Preview({ src, label, placeholder }: { src?: string; label: string; placeholder: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const fullscreen = useRef<HTMLDivElement>(null)
  return <div className="comparison-item"><header><h3>{label}</h3>{src && <Button variant="ghost" size="icon"
    aria-label={'Perbesar ' + label.toLowerCase()} title="Perbesar pratinjau" onClick={() => { setZoom(1); setOpen(true) }}><Maximize2 size={17} /></Button>}</header>
    <div className="image-preview">{src ? <img src={src} alt={label} /> : placeholder}</div>
    <Modal open={open} onOpenChange={setOpen} title={label} wide>
      <div ref={fullscreen} className="zoom-area">
        <div className="zoom-tools">
          <Button variant="outline" size="icon" aria-label="Perkecil" disabled={zoom <= 1} onClick={() => setZoom(n => Math.max(1, n - 0.25))}><Minus size={17} /></Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" aria-label="Perbesar" disabled={zoom >= 3} onClick={() => setZoom(n => n + 0.25)}><Plus size={17} /></Button>
          <Button variant="outline" size="icon" aria-label="Layar penuh" onClick={() => { void fullscreen.current?.requestFullscreen?.().catch(() => {}) }}><Maximize2 size={16} /></Button>
        </div>
        <div className="zoom-scroll"><img src={src} alt={label} style={{ width: zoom * 100 + '%', maxWidth: 'none' }} /></div>
      </div>
    </Modal>
  </div>
}

export function DetectionTable({ rows }: { rows: Detection[] }) {
  return <div className="table-wrap"><table><thead><tr><th>No.</th><th>Kelas</th><th>Confidence</th><th>Koordinat (x1, y1, x2, y2)</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}><td>{row.id}</td>
      <td><span className={'class-tag ' + (row.kelas === 'EmptyChair' ? 'empty-chair' : 'occupied-chair')}>{row.kelas}</span></td>
      <td className="number">{pct(row.confidence)}</td><td className="number">{[row.x1, row.y1, row.x2, row.y2].join(', ')}</td></tr>)}</tbody>
  </table></div>
}
