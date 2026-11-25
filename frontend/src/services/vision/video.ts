import { ALL_FORMATS, BlobSource, CanvasSource, Input, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink,
  WebMOutputFormat, canEncodeVideo, type StreamTargetChunk, type VideoCodec } from 'mediabunny'
import type { InferenceOptions, Job, VideoFrame, VideoMetadata } from '../../types'
import { processingSize } from './core'
import { annotateCanvas, predict } from './engine'

const MAX_OUTPUT = 128 * 1024 * 1024
const BLOCK = 1024 * 1024

export async function openVideo(file: File) {
  if (!file.size || file.size > 150 * 1024 * 1024) throw new Error('Ukuran video maksimal 150 MB.')
  if (!/\.(mp4|avi|mov)$/i.test(file.name)) throw new Error('Pilih video MP4, AVI, atau MOV.')
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('Video tidak memiliki trek gambar yang dapat dibaca.')
    const width = await track.getDisplayWidth(), height = await track.getDisplayHeight()
    if (!width || !height || width * height > 4096 * 4096 || Math.max(width, height) > 8192) throw new Error('Resolusi video melebihi batas keamanan: maksimal 16.777.216 piksel per frame dan 8.192 piksel per sisi.')
    const duration_seconds = await track.computeDuration()
    if (!Number.isFinite(duration_seconds) || duration_seconds <= 0) throw new Error('Durasi video tidak dapat dibaca.')
    if (duration_seconds > 600) throw new Error('Durasi video maksimal 10 menit.')
    const stats = await track.computePacketStats()
    const fps = stats.averagePacketRate, count = stats.packetCount
    if (!Number.isFinite(fps) || fps <= 0 || fps > 240 || count < 1 || count > 144000) throw new Error('FPS atau jumlah frame video melebihi batas keamanan.')
    if (!await track.canDecode()) throw new Error('Codec video tidak didukung browser ini. Gunakan MP4 H.264, browser lain, atau mode FastAPI lokal.')
    const [processing_width, processing_height] = processingSize(width, height)
    const metadata: VideoMetadata = { width, height, fps, duration_seconds, processing_width, processing_height,
      orientation: width >= height ? 'landscape' : 'portrait', resized: width !== processing_width || height !== processing_height }
    return { input, track, count, metadata }
  } catch (error) {
    input.dispose()
    if (/^(Video|Codec|Pilih|Ukuran|Resolusi|Durasi|FPS)/.test((error as Error).message)) throw error
    throw new Error('Video tidak dapat dibuka. File mungkin rusak atau codec tidak didukung browser. Coba MP4 H.264.')
  }
}

export async function createVideoOutput(canvas: HTMLCanvasElement, forceWebm = false) {
  let codec: VideoCodec | undefined
  for (const candidate of (forceWebm ? ['vp9', 'vp8'] : ['avc', 'vp9', 'vp8']) as VideoCodec[]) {
    if (await canEncodeVideo(candidate, { width: canvas.width, height: canvas.height, bitrate: 1500000 })) { codec = candidate; break }
  }
  if (!codec) throw new Error('Browser ini tidak mendukung ekspor video. Gunakan Chrome, Edge, atau Safari terbaru dengan WebCodecs.')
  // Fixed blocks allow MP4 header rewrites while enforcing the cap DURING encoding.
  const blocks: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  const target = new StreamTarget(new WritableStream<StreamTargetChunk>({ write({ position, data }) {
    if (position + data.length > MAX_OUTPUT) throw new Error('Hasil video melebihi batas memori 128 MB. Gunakan video lebih singkat.')
    length = Math.max(length, position + data.length)
    let offset = 0
    while (offset < data.length) {
      const block = Math.floor((position + offset) / BLOCK), start = (position + offset) % BLOCK
      blocks[block] ??= new Uint8Array(BLOCK)
      const count = Math.min(data.length - offset, BLOCK - start)
      blocks[block].set(data.subarray(offset, offset + count), start); offset += count
    }
  } }), { chunked: true, chunkSize: BLOCK })
  const mp4 = codec === 'avc'
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'fragmented' }) : new WebMOutputFormat(), target })
  const source = new CanvasSource(canvas, { codec, bitrate: 1500000, latencyMode: 'realtime', keyFrameInterval: 2 })
  output.addVideoTrack(source)
  await output.start()
  return { source, output, mime: mp4 ? 'video/mp4' : 'video/webm', extension: mp4 ? 'mp4' : 'webm',
    async finish() {
      source.close(); await output.finalize()
      const blob = new Blob(blocks.map((block, index) => block.subarray(0, Math.min(BLOCK, length - index * BLOCK))), { type: mp4 ? 'video/mp4' : 'video/webm' })
      blocks.length = 0
      return blob
    } }
}

// Decode incrementally; the media decoder has a bounded four-frame queue. Only
// sampled frames are resized, inferred and rendered, as in the FastAPI pipeline.
export async function processVideo(file: File, options: InferenceOptions, sampling: number,
  update: (fields: Partial<Job>) => void, signal: AbortSignal, forceWebm = false) {
  const video = await openVideo(file)
  const { input, track, count, metadata } = video
  const canvas = document.createElement('canvas')
  canvas.width = metadata.processing_width; canvas.height = metadata.processing_height
  const rendered = document.createElement('canvas')
  rendered.width = canvas.width + canvas.width % 2; rendered.height = canvas.height + canvas.height % 2
  const context = canvas.getContext('2d')!, render = rendered.getContext('2d')!
  let encoder: Awaited<ReturnType<typeof createVideoOutput>> | undefined
  try {
    signal.throwIfAborted()
    const stride = Math.max(sampling, Math.ceil(count / 1200))
    const fps = metadata.fps!, cadence = stride / fps
    update({ metadata, status: 'processing', sample_every: stride })
    encoder = await createVideoOutput(rendered, forceWebm)
    const points: VideoFrame[] = []
    let index = 0
    for await (const sample of new VideoSampleSink(track, { optimizeForLatency: true }).samples()) {
      try {
        signal.throwIfAborted()
        if (sample.displayWidth !== metadata.width || sample.displayHeight !== metadata.height) throw new Error('Resolusi video berubah saat diproses.')
        if (index >= count || index > 144000) throw new Error('Jumlah frame tidak cocok dengan metadata video.')
        if (index % stride === 0) {
          context.clearRect(0, 0, canvas.width, canvas.height)
          sample.draw(context, 0, 0, canvas.width, canvas.height)
          const prediction = await predict(canvas, options)
          signal.throwIfAborted()
          annotateCanvas(canvas, prediction.rows)
          render.fillStyle = '#000'; render.fillRect(0, 0, rendered.width, rendered.height); render.drawImage(canvas, 0, 0)
          // Explicit presentation timestamps preserve timing even when inference is slow.
          await encoder.source.add(points.length * cadence, cadence)
          const seconds = Math.max(0, sample.timestamp)
          const point = { frame: index + 1, seconds, playback_seconds: points.length * cadence,
            ...prediction.summary, elapsed_ms: prediction.elapsed_ms }
          points.push(point)
          update({ progress: Math.min(99, Math.round((index + 1) / count * 100)), processed_frames: points.length, latest: point })
        }
        index++
      } finally { sample.close() }
    }
    if (!points.length || index < count) throw new Error('Video terpotong atau frame tidak dapat dibaca.')
    const blob = await encoder.finish()
    return { blob, extension: encoder.extension, frames: points, sample_every: stride, metadata, duration: metadata.duration_seconds }
  } finally {
    if (encoder && encoder.output.state !== 'finalized') await encoder.output.cancel().catch(() => {})
    input.dispose(); canvas.width = canvas.height = rendered.width = rendered.height = 1
  }
}
