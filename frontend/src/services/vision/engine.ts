import type { Detection, InferenceOptions, Prediction } from '../../types'

let worker: Worker | undefined
let sequence = 0
let chain: Promise<unknown> = Promise.resolve()
export const engineStatus: { status: 'loading' | 'ready' | 'error'; device: string | null; error?: string } = { status: 'loading', device: null }

function request(bitmap: ImageBitmap | undefined, options: InferenceOptions): Promise<Prediction> {
  return new Promise((resolve, reject) => {
    worker ??= new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })
    const target = worker
    const id = ++sequence
    const timeout = window.setTimeout(() => {
      target.terminate(); if (worker === target) worker = undefined
      finish(new Error('Inferensi terlalu lama. Coba resolusi lebih kecil atau perangkat lain.'))
    }, 180000)
    function finish(error?: Error, result?: Prediction) {
      clearTimeout(timeout); target.removeEventListener('message', message); target.removeEventListener('error', failed)
      if (error) { engineStatus.status = 'error'; engineStatus.error = error.message; reject(error) }
      else { engineStatus.status = 'ready'; engineStatus.device = result!.device; engineStatus.error = undefined; resolve(result!) }
    }
    function message(event: MessageEvent) {
      if (event.data.id === id) finish(event.data.error ? new Error(event.data.error) : undefined, event.data.result)
    }
    function failed() {
      target.terminate(); if (worker === target) worker = undefined
      finish(new Error('Mesin inferensi browser terhenti. Periksa memori perangkat atau coba resolusi lebih kecil.'))
    }
    target.addEventListener('message', message); target.addEventListener('error', failed)
    target.postMessage({ id, bitmap, options }, bitmap ? [bitmap] : [])
  })
}

// Serialize all callers and snapshot only when their turn starts; never queue decoded frames.
export function predict(source: CanvasImageSource, options: InferenceOptions): Promise<Prediction> {
  const task = chain.catch(() => {}).then(async () => request(await createImageBitmap(source), options))
  chain = task
  return task
}
export async function warmup(options: InferenceOptions) {
  const task = chain.catch(() => {}).then(() => request(undefined, options))
  chain = task
  return task
}

export function annotateCanvas(canvas: HTMLCanvasElement, rows: Detection[]) {
  const context = canvas.getContext('2d')!
  const font = Math.max(12, Math.round(Math.max(canvas.width, canvas.height) / 60))
  context.font = `600 ${font}px sans-serif`
  context.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 300))
  for (const row of rows) {
    const color = row.kelas === 'EmptyChair' ? '#22c55e' : '#ef4444'
    context.strokeStyle = context.fillStyle = color
    context.strokeRect(row.x1, row.y1, row.x2 - row.x1, row.y2 - row.y1)
    const text = `${row.status}${row.track_id ? ' #' + row.track_id : ''} ${Math.round(row.confidence * 100)}%`
    const width = context.measureText(text).width + 10, height = font + 8
    const left = Math.max(0, Math.min(row.x1, canvas.width - width)), top = Math.max(0, row.y1 - height)
    context.fillRect(left, top, width, height); context.fillStyle = '#0f172a'
    context.fillText(text, left + 5, top + font + 1)
  }
}

export async function detectImage(file: File, options: InferenceOptions) {
  if (!file.size || file.size > 20 * 1024 * 1024 || !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Pilih JPG, PNG, atau WebP hingga 20 MB.')
  let image: ImageBitmap
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('Gambar tidak dapat dibuka. File mungkin rusak atau formatnya tidak didukung.') }
  try {
    if (image.width * image.height > 24000000) throw new Error('Resolusi gambar maksimal 24 megapiksel.')
    const result = await predict(image, options)
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    canvas.getContext('2d')!.drawImage(image, 0, 0); annotateCanvas(canvas, result.rows)
    const annotated = canvas.toDataURL('image/png')
    canvas.width = canvas.height = 1
    return { ...result, annotated }
  } finally { image.close() }
}
