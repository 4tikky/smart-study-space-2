import type { InferenceOptions, Job } from '../types'
import { cloudData, recordDetection } from './cloud-data'
import { localJobs, disposeJob } from './local-jobs'
import { detectImage, engineStatus, warmup } from './vision/engine'

function inputs(body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) throw new Error('Berkas masukan tidak ditemukan.')
  const file = body.get('file')
  if (!(file instanceof File)) throw new Error('Pilih berkas untuk diproses.')
  const options: InferenceOptions = { resolution: Number(body.get('resolution') || 640), confidence: Number(body.get('confidence') || 0.25),
    device: body.get('device') === 'cpu' ? 'cpu' : 'auto' }
  if (![320,480,640,800,960].includes(options.resolution) || !Number.isFinite(options.confidence) || options.confidence < 0.05 || options.confidence > 0.95) throw new Error('Pengaturan inferensi tidak valid.')
  return { file, options, body }
}

export async function cloudApi(path: string, request?: RequestInit): Promise<unknown> {
  request?.signal?.throwIfAborted()
  if (path === '/api/detect/image') {
    const { file, options } = inputs(request?.body), result = await detectImage(file, options), session_id = crypto.randomUUID()
    let history_id: number | undefined, persistence_warning: string | undefined
    try { history_id = await recordDetection(session_id, 'image', result.summary, result.elapsed_ms,
      { rows: result.rows, width: result.width, height: result.height, device: result.device }) }
    catch { persistence_warning = 'Deteksi selesai di perangkat. Riwayat belum tersimpan karena koneksi atau izin Supabase. Unduh hasil sebelum meninggalkan halaman.' }
    return { ...result, session_id, history_id, persistence_warning }
  }
  if (path === '/api/detect/video') {
    const { openVideo, processVideo } = await import('./vision/video')
    const { file, options, body } = inputs(request?.body)
    const sampling = Number(body.get('sample_every') || 10)
    if (!Number.isInteger(sampling) || sampling < 1 || sampling > 120) throw new Error('Interval sampling harus antara 1 dan 120 frame.')
    if ([...localJobs.values()].some(job => job.status === 'processing' || job.status === 'queued')) throw new Error('Tunggu pemrosesan video aktif selesai.')
    const inspected = await openVideo(file); inspected.input.dispose()
    for (const id of localJobs.keys()) disposeJob(id)
    const id = crypto.randomUUID(), controller = new AbortController()
    const job: Job & { output?: string; controller?: AbortController } = { id, status: 'queued', progress: 0, frames: [], metadata: inspected.metadata, controller }
    localJobs.set(id, job)
    const update = (fields: Partial<Job>) => { if (localJobs.has(id)) Object.assign(job, fields) }
    void processVideo(file, options, sampling, update, controller.signal).then(async result => {
      controller.signal.throwIfAborted()
      const last = result.frames.at(-1)!
      let persistence_warning: string | undefined
      try { await recordDetection(id, 'video', last, result.frames.reduce((sum, point) => sum + point.elapsed_ms, 0),
        { sampled_frames: result.frames.length, sample_every: result.sample_every, duration_seconds: result.duration, last_frame: last, video_metadata: result.metadata }) }
      catch { persistence_warning = 'Video selesai di perangkat. Riwayat belum tersimpan ke Supabase. Unduh hasil sebelum meninggalkan halaman.' }
      controller.signal.throwIfAborted()
      job.output = URL.createObjectURL(result.blob)
      update({ status: 'completed', progress: 100, frames: result.frames, metadata: result.metadata, output_format: result.extension as 'mp4' | 'webm', persistence_warning })
    }).catch(reason => update({ status: 'error', error: controller.signal.aborted ? 'Pemrosesan video dihentikan.' : (reason as Error).message || 'Video gagal diproses di browser.' }))
    return { id, status: 'queued' }
  }
  const jobId = /^\/api\/jobs\/([^/]+)$/.exec(path)?.[1]
  if (jobId) {
    const job = localJobs.get(jobId)
    if (!job) throw new Error('Hasil video tidak tersedia pada tab ini. Proses kembali video.')
    const { controller: _controller, output: _output, ...fields } = job
    return { ...fields }
  }
  if (path === '/api/model/info') {
    if (engineStatus.status === 'loading') void warmup({ device: 'auto', confidence: 0.25, resolution: 640 }).catch(() => {})
    const response = await fetch('/models/manifest.json', { cache: 'no-cache' })
    if (!response.ok) throw new Error('Manifest ONNX tidak ditemukan.')
    const manifest = await response.json()
    return { architecture: manifest.architecture, file: manifest.file, classes: Object.values(manifest.classes), status: engineStatus.status,
      device: engineStatus.device, defaults: { confidence: 0.25, resolution: 640, device: 'auto' }, metadata: await cloudData('/api/model/metadata') }
  }
  return cloudData(path, request)
}
