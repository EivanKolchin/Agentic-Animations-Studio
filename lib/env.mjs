/**
 * Where things are, and what the run is allowed to spend.
 *
 * The studio reads its own .env rather than the host project's, because
 * it is a separate repository with a separate key and a separate budget.
 * Nothing here reaches outside STUDIO except through STUDIO_DELIVER_TO,
 * which is the one path the engine is told about - that single arrow is
 * the whole of its relationship with whatever project is driving it.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PRODUCTIONS = join(STUDIO, 'productions')
export const BIBLE = join(STUDIO, 'bible')
export const CANON = join(STUDIO, 'canon')
export const CACHE = join(STUDIO, '.cache')

let loaded = null

/** Parse .env once. Deliberately tiny: KEY=VALUE, # comments, no
    interpolation - a dotenv dependency to read six lines is a dependency
    to audit for the rest of the repo's life. */
export function env() {
  if (loaded) return loaded
  loaded = { ...process.env }
  const f = join(STUDIO, '.env')
  if (existsSync(f)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      loaded[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1')
    }
  }
  return loaded
}

/** The API key, or a refusal that says exactly what to do about it. */
export function apiKey() {
  const k = env().GEMINI_API_KEY
  if (!k) {
    throw new Error(
      'No GEMINI_API_KEY. Copy .env.example to .env and paste a key from\n' +
        'aistudio.google.com/apikey. That is an API key, not the Gemini app\n' +
        'subscription: they are billed separately and only the key works here.',
    )
  }
  return k
}

/** Hard ceiling on image generations per production. The cap exists so a
    loop bug costs a number someone chose rather than a number nobody
    watched; --force is the only way past it and it is recorded. */
export function creditCap() {
  return Number(env().STUDIO_CREDIT_CAP || 40)
}

/** Absolute path of the project folder deliveries land in. */
export function deliverTo() {
  return resolve(STUDIO, env().STUDIO_DELIVER_TO || '../site/assets')
}

export function ensure(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolve a production by slug or by suffix - `node run.mjs validate fox`
    should find `2026-08-29-fox-canon` without the date being typed. */
export function production(name) {
  if (!name) throw new Error('Which production? Try: node run.mjs status')
  const dirs = existsSync(PRODUCTIONS)
    ? readdirSync(PRODUCTIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  const hit = dirs.filter((d) => d === name || d.endsWith('-' + name) || d.includes(name))
  if (hit.length === 1) return join(PRODUCTIONS, hit[0])
  if (hit.length > 1) throw new Error(`"${name}" matches ${hit.length} productions:\n  ` + hit.join('\n  '))
  throw new Error(`No production matching "${name}". Try: node run.mjs status`)
}

/**
 * Where ffmpeg is.
 *
 * `STUDIO_FFMPEG` if set, otherwise the bare name and whatever PATH says.
 * The setting exists because PATH is a machine's business rather than a
 * project's, and because putting a binary on PATH to make one optional
 * export step work is a bigger change than the step is worth. A studio
 * that cannot find it writes frame stacks and says so; frames are the
 * deliverable that always works.
 */
export function ffmpeg() {
  return env().STUDIO_FFMPEG || 'ffmpeg'
}
