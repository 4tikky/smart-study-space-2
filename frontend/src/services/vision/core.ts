import type { Detection, Summary } from '../../types'

export function processingSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, (width >= height ? 1920 : 1080) / width, (width >= height ? 1080 : 1920) / height)
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))]
}

export function letterbox(width: number, height: number, resolution: number) {
  const side = Math.ceil(resolution / 32) * 32
  const gain = Math.min(side / width, side / height)
  const scaledWidth = Math.round(width * gain), scaledHeight = Math.round(height * gain)
  const dw = (side - scaledWidth) % 32, dh = (side - scaledHeight) % 32
  return { side, gain, scaledWidth, scaledHeight, inputWidth: scaledWidth + dw, inputHeight: scaledHeight + dh,
    left: Math.round(dw / 2 - 0.1), top: Math.round(dh / 2 - 0.1) }
}

export function decodeDetections(data: ArrayLike<number>, dims: readonly number[], width: number, height: number,
  resolution: number, confidence: number, classes: Record<string, string>): Detection[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== 6 || data.length !== dims[1] * 6) {
    throw new Error('Format keluaran ONNX tidak sesuai model YOLO26s yang telah divalidasi.')
  }
  const { gain, left, top } = letterbox(width, height, resolution)
  const rows: Detection[] = []
  const coordinate = (value: number, offset: number, limit: number) => Math.round(Math.max(0, Math.min(limit, (value - offset) / gain)) * 10) / 10
  for (let i = 0; i < data.length; i += 6) {
    if (data[i + 4] <= confidence) continue
    const kelas = classes[String(data[i + 5])]
    if (!['EmptyChair', 'OccupiedChair'].includes(kelas) || !Array.from({ length: 6 }, (_, j) => data[i + j]).every(Number.isFinite)) {
      throw new Error('Nilai atau kelas keluaran model tidak valid.')
    }
    const row: Detection = { id: rows.length + 1, kelas: kelas as Detection['kelas'],
      status: kelas === 'EmptyChair' ? 'Kursi kosong' : 'Kursi terisi', confidence: data[i + 4],
      x1: coordinate(data[i], left, width), y1: coordinate(data[i + 1], top, height),
      x2: coordinate(data[i + 2], left, width), y2: coordinate(data[i + 3], top, height) }
    if (row.x2 > row.x1 && row.y2 > row.y1) rows.push(row)
  }
  return rows
}

export function summarize(rows: Detection[]): Summary {
  const empty = rows.filter(row => row.kelas === 'EmptyChair').length
  const occupied = rows.length - empty
  return { total: rows.length, empty, occupied, occupancy: rows.length ? occupied / rows.length : null }
}

export function aggregate(summaries: Summary[]): Summary | null {
  if (!summaries.length) return null
  const empty = summaries.reduce((sum, item) => sum + item.empty, 0)
  const occupied = summaries.reduce((sum, item) => sum + item.occupied, 0)
  return { total: empty + occupied, empty, occupied, occupancy: empty + occupied ? occupied / (empty + occupied) : null }
}

export function iou(a: Detection, b: Detection) {
  const intersection = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - intersection
  return union > 0 ? intersection / union : 0
}

// Same greedy overlap matching, three-frame occlusion window, and observed median as FastAPI.
export class SessionTracker {
  private tracks = new Map<number, { frame: number; row: Detection }>()
  private observations: Summary[] = []
  private nextId = 1
  private frame = 0
  update(rows: Detection[]): Summary {
    this.frame++
    for (const [id, item] of this.tracks) if (this.frame - item.frame > 3) this.tracks.delete(id)
    const candidates = rows.flatMap((row, index) => [...this.tracks].map(([id, old]) => ({ score: iou(row, old.row), index, id })))
      .sort((a, b) => b.score - a.score || b.index - a.index || b.id - a.id)
    const used = new Set<number>()
    for (const { score, index, id } of candidates) {
      if (score < 0.3) break
      if (!used.has(id) && rows[index].track_id == null) { rows[index].track_id = id; used.add(id) }
    }
    for (const row of rows) {
      row.track_id ??= this.nextId++
      this.tracks.set(row.track_id, { frame: this.frame, row })
    }
    this.observations = [summarize(rows), ...this.observations].slice(0, 3)
    return this.observations.length === 3
      ? [...this.observations].sort((a, b) => a.occupied - b.occupied || a.total - b.total)[1] : this.observations[0]
  }
}
