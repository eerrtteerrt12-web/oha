import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import wabtFactory from 'wabt'

const root = new URL('../', import.meta.url)
const wabt = await wabtFactory()
const source = await readFile(new URL('src/engine/solver.wat', root), 'utf8')
const module = wabt.parseWat('solver.wat', source)
module.resolveNames()
module.validate()
const { buffer } = module.toBinary({ log: false, write_debug_names: true })
await mkdir(new URL('public/', root), { recursive: true })
await writeFile(new URL('public/solver.wasm', root), buffer)
module.destroy()
console.log(
  `Built ${fileURLToPath(new URL('public/solver.wasm', root))} (${buffer.length} bytes)`,
)
