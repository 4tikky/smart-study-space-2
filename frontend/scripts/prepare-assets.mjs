import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('public/models/manifest.json', root), 'utf8'))
if (!manifest.validated) throw new Error('Export and validate weights.pt before building.')
const model = await readFile(new URL('public/models/' + manifest.file, root))
if (createHash('sha256').update(model).digest('hex') !== manifest.sha256 || model.length !== manifest.bytes) throw new Error('ONNX does not match the validated manifest; export and validate again.')
const ort = new URL('node_modules/onnxruntime-web/dist/', root)
const output = new URL('public/ort/', root)
await mkdir(output, { recursive: true })
for (const name of await readdir(ort)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(new URL(name, ort), new URL(name, output))
}
console.log('ONNX Runtime assets prepared:', fileURLToPath(output))
