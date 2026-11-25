import * as ort from 'onnxruntime-web/webgpu'
import { decodeDetections, letterbox, summarize } from './core'
import type { InferenceOptions } from '../../types'

type Manifest = { sha256: string; validated: boolean; file: string; classes: Record<string, string>
  input: { name: string }; output: { name: string; end_to_end: boolean; nms_required: boolean } }
let session: ort.InferenceSession | undefined
let manifest: Manifest | undefined
let provider = ''
let requested = ''
let modelBytes: Uint8Array<ArrayBuffer> | undefined
ort.env.wasm.numThreads = 1 // Works without cross-origin isolation, including mobile Safari.
ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href

async function initialize(device: string, forceWasm = false) {
  if (session && requested === device && !forceWasm) return
  await session?.release()
  session = undefined
  if (!manifest) {
    const response = await fetch('/models/manifest.json', { cache: 'no-cache' })
    if (!response.ok) throw new Error('Manifest model tidak ditemukan. Jalankan ekspor dan validasi ONNX.')
    manifest = await response.json()
    if (!manifest?.validated || !manifest.output.end_to_end || manifest.output.nms_required) throw new Error('Model ONNX belum lulus validasi YOLO26s.')
  }
  if (!modelBytes) {
    const response = await fetch('/models/' + manifest.file + '?v=' + manifest.sha256)
    if (!response.ok) throw new Error('Model ONNX tidak dapat diunduh. Periksa koneksi dan berkas model.')
    modelBytes = new Uint8Array(await response.arrayBuffer())
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', modelBytes))).map(value => value.toString(16).padStart(2, '0')).join('')
    if (digest !== manifest.sha256) { modelBytes = undefined; throw new Error('Berkas model tidak cocok dengan manifest validasi.') }
  }
  const gpu = device === 'auto' && !forceWasm && 'gpu' in navigator
  if (gpu) {
    try {
      session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['webgpu', 'wasm'], graphOptimizationLevel: 'all' })
      provider = 'WebGPU'
    } catch { /* Unsupported GPU/operators: rebuild the full session using WASM. */ }
  }
  if (!session) {
    session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    provider = 'WebAssembly'
  }
  requested = device
}

self.onmessage = async (event: MessageEvent<{ id: number; bitmap?: ImageBitmap; options: InferenceOptions }>) => {
  const { id, bitmap, options } = event.data
  try {
    await initialize(options.device)
    if (!bitmap) { self.postMessage({ id, result: { device: provider } }); return }
    const started = performance.now()
    const { inputWidth, inputHeight, scaledWidth, scaledHeight, left, top } = letterbox(bitmap.width, bitmap.height, options.resolution)
    // Canvas downsampling uses a browser-dependent filter and can change detections.
    // Read only the two source rows needed for each output row, then use OpenCV's
    // half-pixel bilinear mapping and 11-bit interpolation coefficients.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.fillStyle = '#fff'; context.fillRect(0, 0, bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0)
    const plane = inputWidth * inputHeight
    const rgb = new Float32Array(plane * 3)
    rgb.fill(114 / 255)
    for (let y = 0; y < scaledHeight; y++) {
      const sy = Math.max(0, Math.min(bitmap.height - 1, Math.fround((y + 0.5) * bitmap.height / scaledHeight - 0.5)))
      const y0 = Math.floor(sy), y1 = Math.min(bitmap.height - 1, y0 + 1)
      const fy = Math.round((sy - y0) * 2048)
      const pixels = context.getImageData(0, y0, bitmap.width, y1 - y0 + 1).data
      const nextRow = (y1 - y0) * bitmap.width * 4
      for (let x = 0; x < scaledWidth; x++) {
        const sx = Math.max(0, Math.min(bitmap.width - 1, Math.fround((x + 0.5) * bitmap.width / scaledWidth - 0.5)))
        const x0 = Math.floor(sx), x1 = Math.min(bitmap.width - 1, x0 + 1)
        const fx = Math.round((sx - x0) * 2048)
        const at = (y + top) * inputWidth + x + left
        for (let c = 0; c < 3; c++) {
          const upper = pixels[x0 * 4 + c] * (2048 - fx) + pixels[x1 * 4 + c] * fx
          const lower = pixels[nextRow + x0 * 4 + c] * (2048 - fx) + pixels[nextRow + x1 * 4 + c] * fx
          // Match OpenCV's uchar vertical pass, including its integer rounding.
          rgb[at + c * plane] = ((((2048 - fy) * (upper >> 4) >> 16) + (fy * (lower >> 4) >> 16) + 2) >> 2) / 255
        }
      }
    }
    const input = new ort.Tensor('float32', rgb, [1, 3, inputHeight, inputWidth])
    let outputs: ort.InferenceSession.ReturnType | undefined
    try {
      try { outputs = await session!.run({ [manifest!.input.name]: input }) }
      catch (reason) {
        if (provider !== 'WebGPU') throw reason
        await initialize(options.device, true)
        outputs = await session!.run({ [manifest!.input.name]: input })
      }
      const output = outputs[manifest!.output.name]
      const rows = decodeDetections(output.data as Float32Array, output.dims, bitmap.width, bitmap.height,
        options.resolution, options.confidence, manifest!.classes)
      self.postMessage({ id, result: { rows, summary: summarize(rows), width: bitmap.width, height: bitmap.height,
        device: provider, elapsed_ms: Math.round((performance.now() - started) * 100) / 100 } })
    } finally {
      input.dispose()
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose()
      canvas.width = canvas.height = 1
    }
  } catch (error) {
    console.error('ONNX inference:', error)
    const message = (error as Error).message || ''
    self.postMessage({ id, error: /^(Manifest|Model|Berkas|Format|Nilai)/.test(message) ? message : 'Inferensi browser gagal. Coba CPU WebAssembly, resolusi lebih kecil, atau browser lain.' })
  }
  finally { bitmap?.close() }
}
